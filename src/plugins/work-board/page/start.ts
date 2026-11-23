import './board.css';
import type {
  ChannelShape,
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
import { type WorkBoardPlace, workBoardPlaceSlot } from '../contract';
import defaultLayout from '../layouts/default/layout.js';
import defaultStylesheet from '../layouts/default/layout.css?url';
import type { BoardLayout } from '../layouts/layout';
import { workBoardManifest } from '../manifest';
import { createBoardView } from './board-view';
import { registerDemoSteps } from './demo-steps';
import { readBoardLayout } from './layout/read-layout';

type WorkBoardApi = PageApi<typeof workBoardManifest, ChannelShape>;

// Board mode: the head and the columns of cards in the sheet, drawn with the layout the `layout` setting names. It
// draws each value of `work.state` and acts only through work's commands. `showMode` shows the mode, and does nothing
// while it shows. The cursor card goes to `work-board.place` on each change, and a page load puts the last page's back
// once the first state lands. Registers the Board demo step.
export const workBoardPagePart: PagePart<typeof workBoardManifest> = {
  manifest: workBoardManifest,
  start(api: WorkBoardApi) {
    const { services } = api;
    let isShown = false;
    // The mode, once added.
    let mode: ModeHandle | null = null;
    const placeWriter = api.state.publish(workBoardPlaceSlot);
    const place = placeWrites<WorkBoardPlace>((value) =>
      placeWriter.set(value),
    );

    const showMode = () => {
      if (mode !== null && !mode.isShown()) {
        mode.show();
      }
    };

    const view = createBoardView({
      log: services.log,
      toast: services.toast,
      kitServices: {
        markdown: services.markdown,
        keys: api.keys,
        commands: kitCommandsOf(api),
        platform: api.platform.os,
        state: api.state.forLayouts,
      },
      timers: services.timers,
      now: () => services.clock.now(),
      setScope: (scope) => api.keys.setScope(scope),
      setFocusTarget: (target) => api.panes.setFocusTarget(target),
      setResizeTarget: (target) => api.panes.setResizeTarget(target),
      isShown: () => isShown,
      showMode,
      runKey: keyRunner(api.commands, services.log),
      runFor: (id, arg, sessions) => api.commands.runFor(id, arg, sessions),
      savedPlace: placeWriter.get() ?? null,
      placeChanged: (value) => place.write(value),
      holdPlace: () => place.hold(),
    });

    mode = api.modes.add({
      id: 'main',
      title: 'Board',
      icon: 'project',
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
    mode.setContext({ title: 'Board', detail: 'Jira' });

    api.layouts.show<BoardLayout>({
      defaultLayout,
      defaultStylesheet,
      read: readBoardLayout,
      userLayout: () => api.settings().layout,
      setLayouts: (shown) => view.setLayouts(shown),
    });

    const state = api.state.read(workStateSlot);
    const stateListener = state.on((value) => view.stateChanged(value));
    view.stateChanged(state.get());
    const demoStep = registerDemoSteps(services, {
      commands: api.commands,
      showSample: (sample) => view.showSample(sample),
      selectCard: (id) => view.selectCard(id),
      now: () => services.clock.now(),
    });

    return {
      commands: {
        showMode,
        ...view.commands,
        showTicket: ({ arg }) => view.showTicket(arg),
        selectCard: ({ arg }) => view.selectCard(arg),
        openThreads: ({ arg }) => view.openThreads(arg),
        moveCardTo: ({ arg }) => view.moveCardTo(arg),
        acceptCard: ({ arg }) => view.pressCard('accept', arg),
        notYetCard: ({ arg }) => view.pressCard('notYet', arg),
        deleteCard: ({ arg }) => view.pressCard('deleteTask', arg),
        startCardSession: ({ arg }) => view.pressCard('startSession', arg),
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
