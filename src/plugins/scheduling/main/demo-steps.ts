import type { Clock } from '../../../contracts/ambient';
import { DEMO_PROFILE } from '../../../contracts/demo';
import type { Disposable } from '../../../contracts/disposable';
import type { MainServices } from '../../../contracts/plugin';
import { createRegistrations } from '../../../shared/registrations';
import {
  DEMO_TASK_IDS,
  type RunHistoryEntry,
  type ScheduledTask,
  type ScheduledTaskView,
  type TaskSchedule,
} from '../contract';
import { nextOccurrence } from '../schedule';
import type { DemoTasks } from './demo-tasks';

const HOUR = 3_600_000;

export interface SchedulingDemoMainDeps {
  clock: Clock;
  demoTasks: Pick<DemoTasks, 'show'>;
}

export interface DemoTaskViewsInput {
  now: number;
  projectDir: string;
}

// The three demo tasks: an active weekday one with no runs, an active nightly one whose history holds a finished
// run, a skipped run and a failed one, newest first, none with a row, and a paused weekly one.
export function demoTaskViews({
  now,
  projectDir,
}: DemoTaskViewsInput): ScheduledTaskView[] {
  const taskOf = (
    id: string,
    name: string,
    schedule: TaskSchedule,
    prompt: string,
    paused: boolean,
  ): ScheduledTask => ({
    id,
    name,
    target: { projectDir },
    profile: DEMO_PROFILE,
    prompt,
    schedule,
    controls: {},
    paused,
    updatedAt: now,
  });
  const viewOf = (
    task: ScheduledTask,
    history: RunHistoryEntry[],
  ): ScheduledTaskView => ({
    task,
    nextRun: task.paused ? null : nextOccurrence(task.schedule, now),
    history,
  });
  const sweepEntry = (
    hoursAgo: number,
    entry: Pick<
      RunHistoryEntry,
      'outcome' | 'reason' | 'rowId' | 'processId' | 'viewed'
    >,
  ): RunHistoryEntry => ({
    taskId: DEMO_TASK_IDS.sweep,
    occurrence: now - hoursAgo * HOUR,
    at: now - hoursAgo * HOUR,
    ...entry,
  });
  return [
    viewOf(
      taskOf(
        DEMO_TASK_IDS.triage,
        'Morning triage',
        { kind: 'weekdays', time: '09:00' },
        "Triage yesterday's follow-ups and list the three most urgent.",
        false,
      ),
      [],
    ),
    viewOf(
      taskOf(
        DEMO_TASK_IDS.sweep,
        'Nightly test sweep',
        { kind: 'daily', time: '22:30' },
        'Run the test suite and report each failure with its file.',
        false,
      ),
      [
        sweepEntry(1, {
          outcome: 'finished',
          reason: null,
          rowId: null,
          processId: null,
          viewed: false,
        }),
        sweepEntry(25, {
          outcome: 'skipped',
          reason: null,
          rowId: null,
          processId: null,
          viewed: true,
        }),
        sweepEntry(49, {
          outcome: 'failed',
          reason: 'spawn ENOENT',
          rowId: null,
          processId: null,
          viewed: true,
        }),
      ],
    ),
    viewOf(
      taskOf(
        DEMO_TASK_IDS.dependencies,
        'Weekly dependency check',
        { kind: 'weekly', day: 1, time: '10:00' },
        'List outdated dependencies and what each update changes.',
        true,
      ),
      [],
    ),
  ];
}

// The Scheduled tasks step's main half: the demo tasks shown beside the real ones for the stage's length.
export function registerDemoSteps(
  services: MainServices,
  deps: SchedulingDemoMainDeps,
): Disposable {
  const registrations = createRegistrations();
  registrations.track(
    services.demoSteps.register({
      id: 'scheduling.schedules',
      async enter(context) {
        const shown = deps.demoTasks.show(
          demoTaskViews({
            now: deps.clock.now(),
            projectDir: context.scratchDir,
          }),
        );
        return { sessions: {}, dispose: () => shown.dispose() };
      },
    }),
  );
  return registrations;
}
