import './inbox.css';
import type {
  ChannelShape,
  ModeContext,
  ModeHandle,
  PageApi,
  PagePart,
} from '../../../contracts/plugin';
import { callEach } from '../../../shared/call-each';
import {
  keyRunner,
  kitCommandsOf,
} from '../../../shared/page/layout-host/base-kit';
import { placeWrites } from '../../../shared/page/place-slot';
import {
  type ThreadDetail,
  type WorkState,
  workDetailsSlot,
  workStateSlot,
} from '../../work/contract';
import { type WorkInboxPlace, workInboxPlaceSlot } from '../contract';
import defaultLayout from '../layouts/default/layout.js';
import defaultStylesheet from '../layouts/default/layout.css?url';
import type { InboxLayout } from '../layouts/layout';
import { workInboxManifest } from '../manifest';
import { registerDemoSteps } from './demo-steps';
import { sectionCounts } from './inbox-state';
import { createInboxView } from './inbox-view';
import { readInboxLayout } from './layout/read-layout';

type WorkInboxApi = PageApi<typeof workInboxManifest, ChannelShape>;

// Inbox mode: the section nav in the side bar, and the head and cards of the shown section or ticket filter in the
// sheet beside the cursor item's detail pane, drawn with the layout the `layout` setting names. It draws each value of
// `work.state` with the threads `work.details` holds, and acts only through work's commands. `showMode` shows the
// mode, and does nothing while it shows. The place (section, filter, cursor, unsent drafts, whether the pane is open)
// goes to `work-inbox.place` on each change, and a page load puts the last page's back once the first state lands.
// Registers the Inbox demo step.
export const workInboxPagePart: PagePart<typeof workInboxManifest> = {
  manifest: workInboxManifest,
  start(api: WorkInboxApi) {
    const { services } = api;
    let isShown = false;
    // The mode, once added. A reload while the mode shows can show it during `add`, before this is assigned: the last
    // context waits here for the handle.
    let mode: ModeHandle | null = null;
    const pending: { context: ModeContext | null } = { context: null };
    const placeWriter = api.state.publish(workInboxPlaceSlot);
    const place = placeWrites<WorkInboxPlace>((value) =>
      placeWriter.set(value),
    );

    const showMode = () => {
      if (mode !== null && !mode.isShown()) {
        mode.show();
      }
    };

    const details = api.state.read(workDetailsSlot);
    // A thread's record; a ticket record under the same id is not one.
    const detailOf = (id: string): ThreadDetail | null => {
      const detail = details.get(id);
      return detail?.kind === 'thread' ? detail : null;
    };

    const view = createInboxView({
      log: services.log,
      toast: services.toast,
      kitServices: {
        markdown: services.markdown,
        keys: api.keys,
        commands: kitCommandsOf(api),
        platform: api.platform.os,
        state: api.state.forLayouts,
      },
      editor: services.editor,
      uiState: services.uiState,
      timers: services.timers,
      now: () => services.clock.now(),
      detailOf,
      setScope: (scope) => api.keys.setScope(scope),
      setFocusTarget: (target) => api.panes.setFocusTarget(target),
      setResizeTarget: (target) => api.panes.setResizeTarget(target),
      isShown: () => isShown,
      showMode,
      picked: () => mode?.picked(),
      setContext(context) {
        if (mode === null) {
          pending.context = context;
          return;
        }
        mode.setContext(context);
      },
      runKey: keyRunner(api.commands, services.log),
      runFor: (id, arg, sessions) => api.commands.runFor(id, arg, sessions),
      savedPlace: placeWriter.get() ?? null,
      placeChanged: (value) => place.write(value),
      holdPlace: () => place.hold(),
    });

    mode = api.modes.add({
      id: 'main',
      title: 'Inbox',
      icon: 'inbox',
      place: { group: 1, order: 2 },
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
    });
    if (pending.context !== null) {
      mode.setContext(pending.context);
    }

    api.layouts.show<InboxLayout>({
      defaultLayout,
      defaultStylesheet,
      read: readInboxLayout,
      userLayout: () => api.settings().layout,
      setLayouts: (shown) => view.setLayouts(shown),
    });

    const state = api.state.read(workStateSlot);
    // The activity bar count: the Needs you items, none while the state is unread.
    const countNeedsYou = (value: WorkState | undefined) =>
      mode?.setCount(
        value === undefined ? null : sectionCounts(value).needs_you,
      );
    const stateListener = state.on((value) => {
      view.stateChanged(value);
      countNeedsYou(value);
    });
    view.stateChanged(state.get());
    countNeedsYou(state.get());
    const detailsListener = details.on((key) => view.detailChanged(key));
    const demoStep = registerDemoSteps(services, {
      commands: api.commands,
      showSample: (sample, sampleDetails) =>
        view.showSample(sample, sampleDetails),
      openPane: () => view.openPane(),
      selectSection: (id) => view.selectSection(id),
      now: () => services.clock.now(),
    });

    return {
      commands: {
        showMode,
        ...view.commands,
        filterTicket: ({ arg }) => view.filterTicket(arg),
        selectItem: ({ arg }) => view.selectItem(arg),
        selectSection: ({ arg }) => view.selectSection(arg),
        sendItem: ({ arg }) => view.sendItem(arg),
        openTicket: ({ arg }) => view.openTicket(arg),
        dismissItem: ({ arg }) => view.pressItem('dismiss', arg),
        restoreItem: ({ arg }) => view.pressItem('restore', arg),
        snoozeItem: ({ arg }) => view.pressItem('snooze', arg),
        addItemToBoard: ({ arg }) => view.pressItem('addToBoard', arg),
        startItemSession: ({ arg }) => view.pressItem('startSession', arg),
      },
      dispose() {
        callEach<() => void>(
          [
            () => stateListener.dispose(),
            () => detailsListener.dispose(),
            () => demoStep.dispose(),
            () => view.dispose(),
          ],
          (step) => step(),
        );
      },
    };
  },
};
