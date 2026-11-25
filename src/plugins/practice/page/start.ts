import '../../../shared/page/markdown.css';
import './practice.css';
import type { PageApi, PagePart } from '../../../contracts/plugin';
import {
  keyRunner,
  kitCommandsOf,
} from '../../../shared/page/layout-host/base-kit';
import { placeWrites } from '../../../shared/page/place-slot';
import { scopedAgentsPageKey } from '../../scoped-agents/contract';
import {
  type PracticeChannel,
  type PracticePlace,
  practicePlaceSlot,
} from '../contract';
import defaultLayout from '../layouts/default/layout.js';
import defaultStylesheet from '../layouts/default/layout.css?url';
import type { PracticeLayout } from '../layouts/layout';
import { practiceManifest } from '../manifest';
import { registerDemoSteps } from './demo-steps';
import { readPracticeLayout } from './layout/read-layout';
import { createPracticeView } from './practice-view';

type PracticeApi = PageApi<typeof practiceManifest, PracticeChannel>;

const TITLE = 'Practice';

// Practice mode: the problem list in the side bar and the open problem's
// column in the sheet, drawn with the layout the `layout` setting names.
// `showMode` shows the mode, or toggles its side bar while it shows. Each
// `changed` message reads the list again, keeping the selection. The place
// (selection, open problem, filter, the workspace's pane and tabs) goes to
// `practice.place` on each change, and a page load puts the last page's back.
// The interviewer's pane is scoped-agents', added through `addAgentPane`, and
// the panes around the column are its while Practice shows. The page may not
// stop while a draft is unsaved.
export const practicePagePart: PagePart<typeof practiceManifest> = {
  manifest: practiceManifest,
  start(api: PracticeApi) {
    const { services } = api;
    const scopedAgents = api.dependency(scopedAgentsPageKey);
    let isShown = false;
    const placeWriter = api.state.publish(practicePlaceSlot);
    const place = placeWrites<PracticePlace>((value) => placeWriter.set(value));
    const view = createPracticeView({
      channel: api.channel,
      markdown: services.markdown,
      matcher: services.fuzzy,
      log: services.log,
      toast: services.toast,
      keys: api.keys,
      platform: api.platform.os,
      state: api.state.forLayouts,
      commands: kitCommandsOf(api),
      setScope: (scope) => api.keys.setScope(scope),
      setResizeTarget: (target) => api.panes.setResizeTarget(target),
      setFocusTarget: (target) => api.panes.setFocusTarget(target),
      pushScope: (scope) => api.keys.pushScope(scope),
      isShown: () => isShown,
      setOuterPanes: (panes) => api.panes.setOuterPanes(panes),
      addAgentPane: (spec) => scopedAgents.addAgentPane(spec),
      picked: () => mode.picked(),
      opened: (problem) =>
        mode.setContext({ title: TITLE, detail: problem.summary.title }),
      runKey: keyRunner(api.commands, services.log),
      editor: services.editor,
      uiState: services.uiState,
      timers: services.timers,
      run: (command) => api.commands.run(command),
      addOverlay: (element) => api.areas.overlay.contribute(element),
      savedPlace: placeWriter.get() ?? null,
      placeChanged: (value) => place.write(value),
    });

    // The view reads `mode` only once a key runs or a read lands, after
    // `add`: Practice mode is never the first mode added.
    const mode = api.modes.add({
      id: 'main',
      title: TITLE,
      icon: 'beaker',
      place: { group: 3, order: 1, at: 'bottom' },
      showCommand: 'showMode',
      element: view.sheet,
      sideBar: view.sideBar,
      shown() {
        isShown = true;
        view.shown();
      },
      hidden() {
        isShown = false;
        view.hidden();
      },
      sideBarHidden: () => view.sideBarHidden(),
      sideBarOpenedOver: () => view.sideBarOpenedOver(),
      focusSideBar: () => view.focusSideBar(),
      focusMain: () => view.focusMain(),
      // Alt+o and Alt+i step Practice's own tabs, never jumping to Sessions.
      stepTab(by) {
        void api.commands.run(
          by === 1 ? 'practice.nextTab' : 'practice.prevTab',
        );
        return true;
      },
    });

    api.layouts.show<PracticeLayout>({
      defaultLayout,
      defaultStylesheet,
      read: readPracticeLayout,
      userLayout: () => api.settings().layout,
      setLayouts: (shown) => view.setLayouts(shown),
    });

    api.channel.on('changed', () => view.reload());
    view.load();
    registerDemoSteps(services, {
      commands: api.commands,
      openProblemRow: (slug) => view.openProblemRow(slug),
      holdPlace: () => place.hold(),
      saveDrafts: () => view.saveDrafts(),
    });

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
        openProblemRow: ({ arg }) => view.openProblemRow(arg),
        showTab: ({ arg }) => view.showTab(arg),
        openSubmissionRow: ({ arg }) => view.openSubmissionRow(arg),
      },
      mayStop: () => view.mayStop(),
      dispose: () => view.dispose(),
    };
  },
};
