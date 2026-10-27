import '../../../shared/page/markdown.css';
import './backlog.css';
import type { PageApi, PagePart } from '../../../contracts/plugin';
import type { DocsPageExports } from '../../docs/contract';
import type { KeysPageExports } from '../../keys/contract';
import type { BacklogChannel } from '../contract';
import { backlogManifest } from '../manifest';
import { createBacklogView } from './backlog-view';

type BacklogApi = PageApi<typeof backlogManifest, BacklogChannel>;

const TITLE = 'Backlog';

// Backlog mode: the repos and their features homes in the side bar, the open
// home's follow-ups, plans and features beside a detail pane in the sheet.
// `showMode` shows the mode, or toggles its side bar while it shows. Each
// `changed` message reads the homes again, keeping the selection and any
// open editor's draft.
export const backlogPagePart: PagePart<typeof backlogManifest> = {
  manifest: backlogManifest,
  start(api: BacklogApi) {
    const { services } = api;
    const keys = api.dependency<KeysPageExports>('keys');
    const docs = api.dependency<DocsPageExports>('docs');
    let isShown = false;
    const view = createBacklogView({
      channel: api.channel,
      editor: services.editor,
      markdown: services.markdown,
      paths: services.paths,
      homeDir: services.homeDir,
      uiState: services.uiState,
      log: services.log,
      toast: services.toast,
      platform: api.platform,
      keys,
      tags: () => api.settings().tags,
      openDoc: (path, line) => docs.openDoc(path, line),
      setScope: (scope) => api.keys.setScope(scope),
      pushScope: (scope) => api.keys.pushScope(scope),
      addOverlay: (element) => api.areas.overlay.contribute(element),
      run: (command) => api.commands.run(command),
      isShown: () => isShown,
      revealSideBar: () => {
        if (!mode.sideBarShown()) {
          mode.toggleSideBar();
        }
      },
      homePicked: () => mode.picked(),
      homeShown: (home) =>
        mode.setContext(
          home === null
            ? null
            : {
                title: TITLE,
                detail: `${home.repo} ${services.paths.tilde(home.root, services.homeDir)}`,
              },
        ),
    });
    keys.onChanged(() => view.keysChanged());

    // The view reads `mode` only once a key runs or a load lands, after
    // `add`: Backlog mode is never the first mode added. Focus leaves the
    // side bar as it hides and moves to it as it opens over the sheet.
    const mode = api.modes.add({
      id: 'main',
      title: TITLE,
      icon: 'checklist',
      element: view.sheet,
      sideBar: view.sideBar,
      shown() {
        isShown = true;
        view.shown();
      },
      hidden() {
        isShown = false;
      },
      sideBarHidden: () => view.sideBarHidden(),
      sideBarOpenedOver: () => view.sideBarOpenedOver(),
    });

    api.channel.on('changed', () => view.reload());
    view.load();

    // The core logs the side bar's hiding and showing.
    const showMode = () => {
      if (!mode.isShown()) {
        mode.show();
        return;
      }
      mode.toggleSideBar();
    };

    return {
      commands: { showMode, ...view.commands },
    };
  },
};
