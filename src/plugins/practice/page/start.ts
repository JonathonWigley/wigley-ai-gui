import '../../../shared/page/markdown.css';
import './practice.css';
import type { PageApi, PagePart } from '../../../contracts/plugin';
import {
  keyRunner,
  kitCommandsOf,
} from '../../../shared/page/layout-host/base-kit';
import { placeWrites } from '../../../shared/page/place-slot';
import {
  type PracticeChannel,
  type PracticePlace,
  practicePlaceSlot,
} from '../contract';
import defaultLayout from '../layouts/default/layout.js';
import defaultStylesheet from '../layouts/default/layout.css?url';
import type { PracticeLayout } from '../layouts/layout';
import { practiceManifest } from '../manifest';
import { readPracticeLayout } from './layout/read-layout';
import { createPracticeView } from './practice-view';

type PracticeApi = PageApi<typeof practiceManifest, PracticeChannel>;

const TITLE = 'Practice';

// Practice mode: the problem list in the side bar and the open problem's
// column in the sheet, drawn with the layout the `layout` setting names.
// `showMode` shows the mode, or toggles its side bar while it shows. Each
// `changed` message reads the list again, keeping the selection. The place
// (selection, open problem, filter) goes to `practice.place` on each change,
// and a page load puts the last page's back.
export const practicePagePart: PagePart<typeof practiceManifest> = {
  manifest: practiceManifest,
  start(api: PracticeApi) {
    const { services } = api;
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
      picked: () => mode.picked(),
      opened: (problem) =>
        mode.setContext({ title: TITLE, detail: problem.summary.title }),
      runKey: keyRunner(api.commands, services.log),
      savedPlace: placeWriter.get() ?? null,
      placeChanged: (value) => place.write(value),
    });

    // The view reads `mode` only once a key runs or a read lands, after
    // `add`: Practice mode is never the first mode added.
    const mode = api.modes.add({
      id: 'main',
      title: TITLE,
      icon: 'beaker',
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
      focusSideBar: () => view.focusSideBar(),
      focusMain: () => view.focusMain(),
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
      },
      dispose: () => view.dispose(),
    };
  },
};
