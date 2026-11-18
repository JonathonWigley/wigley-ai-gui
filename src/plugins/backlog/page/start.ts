import '../../../shared/page/markdown.css';
import './backlog.css';
import type { ModeHandle, PageApi, PagePart } from '../../../contracts/plugin';
import { docsPageKey } from '../../docs/contract';
import { scopedAgentsPageKey } from '../../scoped-agents/contract';
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

// Backlog mode: the table of every repo's follow-ups beside the review pane,
// over the chunk strip, with the Backlog assistant's pane at the right, drawn
// with the layout the `layout` setting names. `showMode` shows the mode, and
// does nothing while it shows. Each `changed` message reads the homes again,
// keeping the selection; `stalenessRead` and `chunksChanged` carry main's
// staleness and chunks to the view. The title bar's detail is the repo
// filter. The place (selection, repo, filter, marks, toggles, assistant
// shown) goes to `backlog.place` on each change, and a page load puts the
// last page's back.
export const backlogPagePart: PagePart<typeof backlogManifest> = {
  manifest: backlogManifest,
  start(api: BacklogApi) {
    const { services } = api;
    const docs = api.dependency(docsPageKey);
    const scopedAgents = api.dependency(scopedAgentsPageKey);
    let isShown = false;
    // The mode, once added; the view sets the title bar's detail as it is
    // made, before the mode is.
    let modeHandle: ModeHandle | null = null;
    let contextDetail: string | null = null;
    const showContext = () => {
      if (contextDetail !== null) {
        modeHandle?.setContext({ title: TITLE, detail: contextDetail });
      }
    };
    const placeWriter = api.state.publish(backlogPlaceSlot);
    const place = placeWrites<BacklogPlace>((value) => placeWriter.set(value));
    const view = createBacklogView({
      channel: api.channel,
      markdown: services.markdown,
      matcher: services.fuzzy,
      paths: services.paths,
      homeDir: services.homeDir,
      uiState: services.uiState,
      timers: services.timers,
      log: services.log,
      toast: services.toast,
      keys: api.keys,
      platform: api.platform.os,
      state: api.state.forLayouts,
      commands: kitCommandsOf(api),
      openDoc: (path, line) => docs.openDoc(path, line),
      setScope: (scope) => api.keys.setScope(scope),
      setResizeTarget: (target) => api.panes.setResizeTarget(target),
      setFocusTarget: (target) => api.panes.setFocusTarget(target),
      setOuterPanes: (panes) => api.panes.setOuterPanes(panes),
      pushScope: (scope) => api.keys.pushScope(scope),
      picker: services.picker,
      run: (command) => api.commands.run(command),
      runKey: keyRunner(api.commands, services.log),
      isShown: () => isShown,
      addAgentPane: (spec) => scopedAgents.addAgentPane(spec),
      setContext(detail) {
        contextDetail = detail;
        showContext();
      },
      savedPlace: placeWriter.get() ?? null,
      placeChanged: (value) => place.write(value),
    });

    // The view reads `mode` only once a key runs or a load lands, after
    // `add`: Backlog mode is never the first mode added.
    const mode = api.modes.add({
      id: 'main',
      title: TITLE,
      icon: 'checklist',
      element: view.sheet,
      shown() {
        isShown = true;
        view.shown();
      },
      hidden() {
        isShown = false;
        view.hidden();
      },
      focusMain: () => view.focusMain(),
    });
    modeHandle = mode;
    showContext();

    api.layouts.show<BacklogLayout>({
      defaultLayout,
      defaultStylesheet,
      read: readBacklogLayout,
      userLayout: () => api.settings().layout,
      setLayouts: (shown) => view.setLayouts(shown),
    });

    api.channel.on('changed', () => view.reload());
    api.channel.on('stalenessRead', ({ entries }) =>
      view.stalenessRead(entries),
    );
    api.channel.on('chunksChanged', ({ chunks }) => view.chunksChanged(chunks));
    view.load();

    return {
      commands: {
        showMode() {
          if (!mode.isShown()) {
            mode.show();
          }
        },
        ...view.commands,
        selectRow: ({ arg }) => view.selectRow(arg),
        selectChunk: ({ arg }) => view.selectChunk(arg),
      },
      dispose: () => view.dispose(),
    };
  },
};
