import '../../../shared/page/markdown.css';
import './backlog.css';
import type { PageApi, PagePart } from '../../../contracts/plugin';
import { docsPageKey } from '../../docs/contract';
import { placeWrites } from '../../../shared/page/place-slot';
import {
  type BacklogChannel,
  type BacklogPlace,
  backlogPlaceSlot,
} from '../contract';
import defaultLayout from '../layouts/default/layout.js';
import defaultStylesheet from '../layouts/default/layout.css?url';
import type { BacklogLayout } from '../layouts/layout';
import { backlogManifest } from '../manifest';
import { createBacklogView } from './backlog-view';
import { readBacklogLayout } from './layout/read-layout';
import {
  keyRunner,
  kitCommandsOf,
} from '../../../shared/page/layout-host/base-kit';

type BacklogApi = PageApi<typeof backlogManifest, BacklogChannel>;

const TITLE = 'Backlog';

// Backlog mode: the repos and their features homes in the side bar, the open
// home's follow-ups, plans and features beside a detail pane in the sheet,
// drawn with the layout the `layout` setting names. `showMode` shows the mode,
// or toggles its side bar while it shows. Each `changed` message reads the
// homes again, keeping the selection and any open editor's draft, and a
// changed draft refuses a switch-off. The place
// (focus, cursors, open home, selection, expansion, filter) goes to
// `backlog.place` on each change, and a page load puts the last page's back.
export const backlogPagePart: PagePart<typeof backlogManifest> = {
  manifest: backlogManifest,
  start(api: BacklogApi) {
    const { services } = api;
    const docs = api.dependency(docsPageKey);
    let isShown = false;
    const placeWriter = api.state.publish(backlogPlaceSlot);
    const place = placeWrites<BacklogPlace>((value) => placeWriter.set(value));
    const view = createBacklogView({
      channel: api.channel,
      editor: services.editor,
      markdown: services.markdown,
      matcher: services.fuzzy,
      paths: services.paths,
      homeDir: services.homeDir,
      uiState: services.uiState,
      timers: services.timers,
      log: services.log,
      toast: services.toast,
      drops: api.drops,
      keys: api.keys,
      platform: api.platform.os,
      state: api.state.forLayouts,
      commands: kitCommandsOf(api),
      tags: () => api.settings().tags,
      openDoc: (path, line) => docs.openDoc(path, line),
      setScope: (scope) => api.keys.setScope(scope),
      setResizeTarget: (target) => api.panes.setResizeTarget(target),
      setFocusTarget: (target) => api.panes.setFocusTarget(target),
      pushScope: (scope) => api.keys.pushScope(scope),
      picker: services.picker,
      addOverlay: (element) => api.areas.overlay.contribute(element),
      run: (command) => api.commands.run(command),
      isShown: () => isShown,
      revealSideBar: () => {
        if (!mode.sideBarShown()) {
          mode.toggleSideBar();
        }
      },
      homePicked: () => mode.picked(),
      runKey: keyRunner(api.commands, services.log),
      homeShown: (home) =>
        mode.setContext(
          home === null
            ? null
            : {
                title: TITLE,
                detail: `${home.repo} ${services.paths.tilde(home.root, services.homeDir)}`,
              },
        ),
      savedPlace: placeWriter.get() ?? null,
      placeChanged: (value) => place.write(value),
    });

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

    api.layouts.show<BacklogLayout>({
      defaultLayout,
      defaultStylesheet,
      read: readBacklogLayout,
      userLayout: () => api.settings().layout,
      setLayouts: (shown) => view.setLayouts(shown),
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
      commands: {
        showMode,
        ...view.commands,
        openHomeRow: ({ arg }) => view.openHomeRow(arg),
        selectRow: ({ arg }) => view.selectRow(arg),
      },
      mayStop: () => view.mayStop(),
      dispose: () => view.dispose(),
    };
  },
};
