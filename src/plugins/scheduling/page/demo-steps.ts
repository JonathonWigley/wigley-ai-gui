import type { Timers } from '../../../contracts/ambient';
import { MODES_SHOW } from '../../../contracts/commands';
import type { DemoStage } from '../../../contracts/demo';
import type { Disposable } from '../../../contracts/disposable';
import type { PageServices, PluginCommands } from '../../../contracts/plugin';
import type { SlotReader } from '../../../contracts/state';
import { DEMO_TASK_IDS, type SchedulingState } from '../contract';

const DEMO_TASKS_WAIT_MS = 5_000;

// `selectTask` is the view's; `state` reads `scheduling.state`.
export interface SchedulingDemoPageDeps {
  commands: Pick<PluginCommands, 'run'>;
  state: SlotReader<SchedulingState>;
  timers: Pick<Timers, 'set' | 'clear'>;
  selectTask(taskId: string): void;
}

// The Scheduled tasks step: Schedules mode over the demo tasks main shows beside the real ones. It never runs, saves
// or removes a task.
export function registerDemoSteps(
  services: PageServices,
  deps: SchedulingDemoPageDeps,
): Disposable {
  return services.demoSteps.register({
    id: 'scheduling.schedules',
    section: 'modes',
    order: 50,
    title: 'Scheduled tasks',
    caption:
      'Scheduled tasks: agent prompts that run on a schedule as new sessions, headless unless a task is attended.',
    files: [
      'src/plugins/scheduling/page/schedules-view.ts',
      'src/plugins/scheduling/page/run-rows.ts',
      'src/plugins/scheduling/main/start.ts',
      'src/plugins/scheduling/main/demo-tasks.ts',
    ],
    async enter() {
      await waitForDemoTasks(deps);
      return schedulingStage(deps);
    },
  });
}

function hasDemoTasks(value: SchedulingState | undefined): boolean {
  return (
    value?.tasks.some((view) => view.task.id === DEMO_TASK_IDS.triage) === true
  );
}

// Resolves once `scheduling.state` lists the demo tasks; rejects when they have not arrived in the wait.
function waitForDemoTasks(deps: SchedulingDemoPageDeps): Promise<void> {
  if (hasDemoTasks(deps.state.get())) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    let listener: Disposable | null = null;
    const timer = deps.timers.set(() => {
      listener?.dispose();
      reject(new Error('the demo tasks never reached scheduling.state'));
    }, DEMO_TASKS_WAIT_MS);
    listener = deps.state.on((value) => {
      if (hasDemoTasks(value)) {
        deps.timers.clear(timer);
        listener?.dispose();
        resolve();
      }
    });
  });
}

function schedulingStage(deps: SchedulingDemoPageDeps): DemoStage {
  return {
    beats: [
      {
        name: 'task list',
        async show() {
          await deps.commands.run(MODES_SHOW, 'scheduling.main');
          deps.selectTask(DEMO_TASK_IDS.triage);
        },
      },
    ],
    dispose: () => undefined,
  };
}
