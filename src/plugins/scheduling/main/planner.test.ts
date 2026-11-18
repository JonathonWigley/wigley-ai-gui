import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RunHistoryEntry, ScheduledTask } from '../contract';
import { planRuns, type PlannedRun } from './planner';

// UTC, so every `daily` time reads directly as the ISO time beside it.
let savedZone: string | undefined;

beforeAll(() => {
  savedZone = process.env.TZ;
  process.env.TZ = 'UTC';
});

afterAll(() => {
  if (savedZone === undefined) {
    delete process.env.TZ;
  } else {
    process.env.TZ = savedZone;
  }
});

const TASK_ID = '3f9a01bc';

const THREE_DAYS_AGO_08 = Date.parse('2026-11-14T08:00:00Z');
const TWO_DAYS_AGO_09 = Date.parse('2026-11-15T09:00:00Z');
const YESTERDAY_09 = Date.parse('2026-11-16T09:00:00Z');
const YESTERDAY_10 = Date.parse('2026-11-16T10:00:00Z');
const TODAY_08 = Date.parse('2026-11-17T08:00:00Z');
const TODAY_0830 = Date.parse('2026-11-17T08:30:00Z');
const TODAY_09 = Date.parse('2026-11-17T09:00:00Z');
const TODAY_10 = Date.parse('2026-11-17T10:00:00Z');
const TODAY_12 = Date.parse('2026-11-17T12:00:00Z');
const TOMORROW_08 = Date.parse('2026-11-18T08:00:00Z');
const TOMORROW_09 = Date.parse('2026-11-18T09:00:00Z');
const TOMORROW_1430 = Date.parse('2026-11-18T14:30:00Z');

// A daily 09:00 task edited yesterday at 10:00, with `change` laid over it.
function dailyTask(change: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    id: TASK_ID,
    name: 'Morning triage',
    target: { projectDir: '~/dev/a' },
    profile: 'work',
    prompt: 'Triage the follow-ups.',
    schedule: { kind: 'daily', time: '09:00' },
    controls: {},
    paused: false,
    updatedAt: YESTERDAY_10,
    ...change,
  };
}

// A finished run of the task, started at its occurrence, with `change` laid over it.
function entry(
  occurrence: number,
  change: Partial<RunHistoryEntry> = {},
): RunHistoryEntry {
  return {
    taskId: TASK_ID,
    occurrence,
    at: occurrence,
    outcome: 'finished',
    reason: null,
    rowId: 'row-1',
    processId: 'p-1',
    viewed: true,
    ...change,
  };
}

function planned(
  occurrence: number,
  at: number,
  skipWhileBusy: string | null = null,
): PlannedRun {
  return { taskId: TASK_ID, occurrence, at, skipWhileBusy };
}

describe('planRuns', () => {
  it.each<{
    name: string;
    task: ScheduledTask;
    history: RunHistoryEntry[];
    runNow: string[];
    now: number;
    catchUpFloor: number | null;
    expected: PlannedRun | null;
  }>([
    {
      name: 'next occurrence',
      task: dailyTask({ updatedAt: TODAY_08 }),
      history: [],
      runNow: [],
      now: TODAY_0830,
      catchUpFloor: null,
      expected: planned(TODAY_09, TODAY_09),
    },
    {
      name: 'catch-up, latest only',
      task: dailyTask({ updatedAt: THREE_DAYS_AGO_08 }),
      history: [entry(TWO_DAYS_AGO_09)],
      runNow: [],
      now: TODAY_12,
      catchUpFloor: null,
      expected: planned(TODAY_09, TODAY_12, 'p-1'),
    },
    {
      name: 'catch-up window starts at updatedAt',
      task: dailyTask({ updatedAt: TODAY_10 }),
      history: [],
      runNow: [],
      now: TODAY_12,
      catchUpFloor: null,
      expected: planned(TOMORROW_09, TOMORROW_09),
    },
    {
      name: 'already in history',
      task: dailyTask(),
      history: [entry(TODAY_09)],
      runNow: [],
      now: TODAY_12,
      catchUpFloor: null,
      expected: planned(TOMORROW_09, TOMORROW_09, 'p-1'),
    },
    {
      name: 'occurrence at now exactly, not in history',
      task: dailyTask(),
      history: [],
      runNow: [],
      now: TODAY_09,
      catchUpFloor: null,
      expected: planned(TODAY_09, TODAY_09),
    },
    {
      name: 'occurrence at now exactly, in history',
      task: dailyTask(),
      history: [entry(TODAY_09)],
      runNow: [],
      now: TODAY_09,
      catchUpFloor: null,
      expected: planned(TOMORROW_09, TOMORROW_09, 'p-1'),
    },
    {
      name: 'Run now',
      task: dailyTask(),
      history: [],
      runNow: [TASK_ID],
      now: TODAY_12,
      catchUpFloor: null,
      expected: planned(TODAY_12, TODAY_12),
    },
    {
      name: 'Run now beats catch-up',
      task: dailyTask({ updatedAt: THREE_DAYS_AGO_08 }),
      history: [entry(TWO_DAYS_AGO_09)],
      runNow: [TASK_ID],
      now: TODAY_12,
      catchUpFloor: null,
      expected: planned(TODAY_12, TODAY_12, 'p-1'),
    },
    {
      name: 'paused, Run now pressed',
      task: dailyTask({ paused: true }),
      history: [],
      runNow: [TASK_ID],
      now: TODAY_12,
      catchUpFloor: null,
      expected: null,
    },
    {
      name: 'spent one-time',
      task: dailyTask({ schedule: { kind: 'once', at: '2026-11-17T09:00' } }),
      history: [entry(TODAY_09)],
      runNow: [],
      now: TODAY_12,
      catchUpFloor: null,
      expected: null,
    },
    {
      name: 'one-time edited after its time',
      task: dailyTask({
        schedule: { kind: 'once', at: '2026-11-17T09:00' },
        updatedAt: TODAY_10,
      }),
      history: [],
      runNow: [],
      now: TODAY_12,
      catchUpFloor: null,
      expected: null,
    },
    {
      name: 'one-time in the future',
      task: dailyTask({ schedule: { kind: 'once', at: '2026-11-18T14:30' } }),
      history: [],
      runNow: [],
      now: TODAY_12,
      catchUpFloor: null,
      expected: planned(TOMORROW_1430, TOMORROW_1430),
    },
    {
      name: 'skipWhileBusy from the newest entry with a processId',
      task: dailyTask(),
      history: [
        entry(YESTERDAY_09, { processId: 'p-2' }),
        entry(TODAY_09, {
          outcome: 'skipped',
          rowId: null,
          processId: null,
        }),
        entry(TWO_DAYS_AGO_09, { processId: 'p-1' }),
      ],
      runNow: [],
      now: TODAY_12,
      catchUpFloor: null,
      expected: planned(TOMORROW_09, TOMORROW_09, 'p-2'),
    },
    {
      name: 'skipWhileBusy null with no history',
      task: dailyTask(),
      history: [],
      runNow: [],
      now: TODAY_0830,
      catchUpFloor: null,
      expected: planned(TODAY_09, TODAY_09),
    },
    {
      name: 'history of another task ignored',
      task: dailyTask(),
      history: [entry(TODAY_09, { taskId: '0c7e2d95', processId: 'p-9' })],
      runNow: [],
      now: TODAY_12,
      catchUpFloor: null,
      expected: planned(TODAY_09, TODAY_12),
    },
    {
      name: 'floor blocks the catch-up',
      task: dailyTask({ updatedAt: THREE_DAYS_AGO_08 }),
      history: [],
      runNow: [],
      now: TODAY_12,
      catchUpFloor: TODAY_10,
      expected: planned(TOMORROW_09, TOMORROW_09),
    },
    {
      name: 'floor before the missed time',
      task: dailyTask({ updatedAt: THREE_DAYS_AGO_08 }),
      history: [],
      runNow: [],
      now: TODAY_12,
      catchUpFloor: TODAY_08,
      expected: planned(TODAY_09, TODAY_12),
    },
    {
      name: 'hand-written stale updatedAt',
      task: dailyTask({ updatedAt: 0 }),
      history: [],
      runNow: [],
      now: TODAY_12,
      catchUpFloor: null,
      expected: planned(TODAY_09, TODAY_12),
    },
    {
      name: 'updatedAt in the future',
      task: dailyTask({ updatedAt: TOMORROW_08 }),
      history: [],
      runNow: [],
      now: TODAY_12,
      catchUpFloor: null,
      expected: planned(TOMORROW_09, TOMORROW_09),
    },
  ])(
    'planRuns_Input_PlansOneRunPerTask: $name',
    ({ task, history, runNow, now, catchUpFloor, expected }) => {
      const runs = planRuns({
        tasks: [task],
        history,
        runNow,
        now,
        catchUpFloor,
      });

      expect(runs).toEqual(expected === null ? [] : [expected]);
    },
  );

  it('planRuns_TwoTasks_KeepsTaskOrderAndOneRunEach', () => {
    // Edited today, so yesterday's 15:00 is outside its catch-up window and its run is today's 15:00.
    const late = dailyTask({
      id: 'aaaa0001',
      schedule: { kind: 'daily', time: '15:00' },
      updatedAt: TODAY_10,
    });
    const paused = dailyTask({ id: 'aaaa0002', paused: true });
    const early = dailyTask({
      id: 'aaaa0003',
      schedule: { kind: 'hourly', minute: 30 },
    });

    const runs = planRuns({
      tasks: [late, paused, early],
      history: [entry(TODAY_09, { taskId: 'aaaa0003', processId: 'p-3' })],
      runNow: [],
      now: TODAY_12,
      catchUpFloor: null,
    });

    expect(runs).toEqual([
      {
        taskId: 'aaaa0001',
        occurrence: Date.parse('2026-11-17T15:00:00Z'),
        at: Date.parse('2026-11-17T15:00:00Z'),
        skipWhileBusy: null,
      },
      {
        taskId: 'aaaa0003',
        occurrence: Date.parse('2026-11-17T11:30:00Z'),
        at: TODAY_12,
        skipWhileBusy: 'p-3',
      },
    ]);
  });
});
