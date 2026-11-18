import './schedules.css';
import type { ModeHandle, PageApi, PagePart } from '../../../contracts/plugin';
import { coreModeSlot } from '../../../contracts/core-state';
import {
  keyRunner,
  kitCommandsOf,
} from '../../../shared/page/layout-host/base-kit';
import { callEach } from '../../../shared/call-each';
import { sessionsPageKey } from '../../sessions/contract';
import {
  type SchedulingChannel,
  type SchedulingState,
  schedulingStateSlot,
} from '../contract';
import defaultLayout from '../layouts/default/layout.js';
import defaultStylesheet from '../layouts/default/layout.css?url';
import type { SchedulingLayout } from '../layouts/layout';
import { schedulingManifest } from '../manifest';
import { registerDemoSteps } from './demo-steps';
import { readSchedulingLayout } from './layout/read-scheduling-layout';
import { startRunRows } from './run-rows';
import { createSchedulesView } from './schedules-view';

type SchedulingApi = PageApi<typeof schedulingManifest, SchedulingChannel>;

const SESSIONS_MODE = 'sessions.sessions';

// Schedules mode: the scheduled task list in the side bar, and the selected task's details and history, or the task
// editor in their place, in the sheet, drawn with the layout the `layout` setting names. `showMode` shows the mode,
// or toggles its side bar while it shows. The page draws each value of `scheduling.state` main publishes, and keeps no
// place: a page load selects the first task with the editor closed. A history row opens its run's row through
// sessions' `activate`. The page may not stop while the editor's draft changed. In Sessions mode's side bar, the
// Scheduled runs section claims the open run rows and marks the unviewed ones done, while the slot holds a value.
// Registers the Scheduled tasks demo step's page half.
export const schedulingPagePart: PagePart<typeof schedulingManifest> = {
  manifest: schedulingManifest,
  start(api: SchedulingApi) {
    const { services } = api;
    const sessions = api.dependency(sessionsPageKey);
    const modeSlot = api.state.read(coreModeSlot);
    let isShown = false;
    // The mode, once added. A reload while the mode shows can show it during `add`, before this is assigned, and the
    // view sets the title bar's context then with no handle: the last context waits here for the handle.
    let mode: ModeHandle | null = null;
    const pending: { context: Parameters<ModeHandle['setContext']>[0] } = {
      context: null,
    };
    const view = createSchedulesView({
      channel: api.channel,
      log: services.log,
      toast: services.toast,
      keys: api.keys,
      kitServices: {
        markdown: services.markdown,
        keys: api.keys,
        commands: kitCommandsOf(api),
        platform: api.platform.os,
        state: api.state.forLayouts,
      },
      editor: services.editor,
      picker: services.picker.create({ filter: true }),
      setScope: (scope) => api.keys.setScope(scope),
      setFocusTarget: (target) => api.panes.setFocusTarget(target),
      setResizeTarget: (target) => api.panes.setResizeTarget(target),
      pushScope: (scope) => api.keys.pushScope(scope),
      isShown: () => isShown,
      setContext: (context) => {
        if (mode === null) {
          pending.context = context;
          return;
        }
        mode.setContext(context);
      },
      runKey: keyRunner(api.commands, services.log),
      run: (command) => void api.commands.run(command),
      addOverlay: (element) => api.areas.overlay.contribute(element),
      tilde: (path) => services.paths.tilde(path, services.homeDir),
      activateRow: (rowId) => sessions.activate(rowId),
      isSessionsShown: () => modeSlot.get() === SESSIONS_MODE,
    });

    mode = api.modes.add({
      id: 'main',
      title: 'Schedules',
      icon: 'calendar',
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
    if (pending.context !== null) {
      mode.setContext(pending.context);
    }

    api.layouts.show<SchedulingLayout>({
      defaultLayout,
      defaultStylesheet,
      read: readSchedulingLayout,
      userLayout: () => api.settings().layout,
      setLayouts: (shown) => view.setLayouts(shown),
    });

    let runRows: ReturnType<typeof startRunRows> | null = null;
    const runRowsChanged = (value: SchedulingState | undefined) => {
      if (value === undefined) {
        runRows?.dispose();
        runRows = null;
      } else if (runRows === null) {
        runRows = startRunRows({ sessions, log: services.log }, value);
      } else {
        runRows.changed(value);
      }
    };

    const state = api.state.read(schedulingStateSlot);
    const stateListener = state.on((value) => {
      view.stateChanged(value);
      runRowsChanged(value);
    });
    view.stateChanged(state.get());
    runRowsChanged(state.get());
    registerDemoSteps(services, {
      commands: api.commands,
      state,
      timers: services.timers,
      selectTask: (taskId) => view.selectTask(taskId),
    });

    // The core logs the side bar's hiding and showing.
    const showMode = () => {
      if (mode === null) {
        return;
      }
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
        selectTask: ({ arg }) => view.selectTask(arg),
        openRunRow: ({ arg }) => view.openRunRow(arg),
      },
      mayStop: () => view.mayStop(),
      dispose() {
        callEach<() => void>(
          [
            () => stateListener.dispose(),
            () => runRows?.dispose(),
            () => view.dispose(),
          ],
          (step) => step(),
        );
      },
    };
  },
};
