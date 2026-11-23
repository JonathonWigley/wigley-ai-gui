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
import { workStateSlot } from '../../work/contract';
import { type WorkInboxPlace, workInboxPlaceSlot } from '../contract';
import defaultLayout from '../layouts/default/layout.js';
import defaultStylesheet from '../layouts/default/layout.css?url';
import type { InboxLayout } from '../layouts/layout';
import { workInboxManifest } from '../manifest';
import { registerDemoSteps } from './demo-steps';
import { createInboxView } from './inbox-view';
import { readInboxLayout } from './layout/read-layout';

type WorkInboxApi = PageApi<typeof workInboxManifest, ChannelShape>;

// Inbox mode: the section nav in the side bar, and the head and cards of the shown section or ticket filter in the
// sheet, drawn with the layout the `layout` setting names. It draws each value of `work.state` and acts only through
// work's commands. `showMode` shows the mode, and does nothing while it shows. The place (section, filter, cursor,
// unsent drafts) goes to `work-inbox.place` on each change, and a page load puts the last page's back once the first
// state lands. Registers the Inbox demo step.
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
      timers: services.timers,
      now: () => services.clock.now(),
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
    const stateListener = state.on((value) => view.stateChanged(value));
    view.stateChanged(state.get());
    const demoStep = registerDemoSteps(services, {
      commands: api.commands,
      showSample: (sample) => view.showSample(sample),
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
            () => demoStep.dispose(),
            () => view.dispose(),
          ],
          (step) => step(),
        );
      },
    };
  },
};
