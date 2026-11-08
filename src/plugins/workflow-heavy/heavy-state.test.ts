import { describe, expect, it } from 'vitest';
import type { SessionFlow, WorkflowSignal } from '../workflow/contract';
import { foldFlow, newFlow } from '../workflow/flow';
import type { PlanProgress } from '../../shared/plan-progress';
import {
  EMPTY_HEAVY_STATE,
  HEAVY_WORKFLOW_ID,
  heavyEventOf,
  heavySignal,
  type HeavyState,
  heavyStateOf,
  withHeavyState,
} from './contract';
import {
  foldHeavyState,
  heavyFixCycles,
  isPlanFile,
  sameHeavyState,
} from './heavy-state';
import { heavyMainWorkflow } from './heavy-workflow';

type FlowFields = Partial<SessionFlow & HeavyState>;

function flowWith(fields: FlowFields): SessionFlow {
  const { planDir, progress, reviewRoundsAtMake, countdownEndsAt, ...flow } =
    fields;
  return {
    ...newFlow('s1', '/r'),
    workflow: HEAVY_WORKFLOW_ID,
    ...flow,
    state: {
      planDir: planDir ?? null,
      progress: progress ?? null,
      reviewRoundsAtMake: reviewRoundsAtMake ?? null,
      countdownEndsAt: countdownEndsAt ?? null,
    },
  };
}

function skill(name: string, argsPath: string | null): WorkflowSignal {
  return {
    type: 'skillStarted',
    skill: name,
    args: argsPath ?? '',
    argsPath,
  };
}

const PROGRESS: PlanProgress = {
  checked: 1,
  total: 3,
  wave: 2,
  reviewRounds: 1,
  title: 'Plan A',
  tasks: [
    { wave: 1, text: 'first', done: true, file: null, status: null },
    { wave: 2, text: 'second', done: false, file: null, status: null },
    { wave: 2, text: 'third', done: false, file: null, status: null },
  ],
};
// A state whose progress holds the one task line `task`, as a saved flow may.
function stateWithTask(task: object): unknown {
  return { ...EMPTY_HEAVY_STATE, progress: { ...PROGRESS, tasks: [task] } };
}

const PROGRESS_RETITLED_TASK: PlanProgress = {
  ...PROGRESS,
  tasks: [
    PROGRESS.tasks[0],
    { ...PROGRESS.tasks[1], text: 'renamed' },
    PROGRESS.tasks[2],
  ],
};

const PROGRESS_TASK_RUNNING: PlanProgress = {
  ...PROGRESS,
  tasks: [
    PROGRESS.tasks[0],
    { ...PROGRESS.tasks[1], status: 'in progress' },
    PROGRESS.tasks[2],
  ],
};
const PROGRESS_TASK_LINKED: PlanProgress = {
  ...PROGRESS,
  tasks: [
    PROGRESS.tasks[0],
    { ...PROGRESS.tasks[1], file: '02-second.md' },
    PROGRESS.tasks[2],
  ],
};

const PLAN_X = '/r/docs/features/x/plan-a';
const UNCHANGED = 'unchanged';
// A stage no Heavy rule names, so only the bookkeeping moves.
const IN_C = { stage: 'c' } as const;

function planChanged(progress: PlanProgress): WorkflowSignal {
  return heavySignal({ type: 'planChanged', progress });
}

const FOLD_ROWS: {
  name: string;
  flow: SessionFlow;
  signal: WorkflowSignal;
  expected: SessionFlow | typeof UNCHANGED;
}[] = [
  {
    name: 'turnStarted sets turnRunning and stops the countdown',
    flow: flowWith({ ...IN_C, countdownEndsAt: 5000 }),
    signal: { type: 'turnStarted' },
    expected: flowWith({ ...IN_C, turnRunning: true }),
  },
  {
    name: 'fileWritten of a new plan moves planDir and drops progress and reviewRoundsAtMake',
    flow: flowWith({
      planDir: PLAN_X,
      progress: PROGRESS,
      reviewRoundsAtMake: 1,
    }),
    signal: { type: 'fileWritten', path: '/r/docs/features/y/plan-b/plan.md' },
    expected: flowWith({
      planDir: '/r/docs/features/y/plan-b',
      reviewRoundsAtMake: null,
    }),
  },
  {
    name: 'fileWritten of the same plan keeps progress',
    flow: flowWith({ planDir: PLAN_X, progress: PROGRESS }),
    signal: { type: 'fileWritten', path: `${PLAN_X}/plan.md` },
    expected: UNCHANGED,
  },
  {
    name: 'fileWritten of a non-plan file changes nothing',
    flow: flowWith({ planDir: PLAN_X, progress: PROGRESS }),
    signal: { type: 'fileWritten', path: '/r/src/a.ts' },
    expected: UNCHANGED,
  },
  {
    name: 'fileWritten with backslash separators',
    flow: flowWith({}),
    signal: { type: 'fileWritten', path: 'C:\\r\\plan-a\\plan.md' },
    expected: flowWith({ planDir: 'C:\\r\\plan-a', reviewRoundsAtMake: null }),
  },
  {
    name: 'wigley:make of a plan folder moves planDir and drops progress',
    flow: flowWith({ planDir: '/r/plan-z', progress: PROGRESS }),
    signal: skill('wigley:make', '/r/plan-a'),
    expected: flowWith({
      stage: 'make',
      planDir: '/r/plan-a',
      reviewRoundsAtMake: null,
    }),
  },
  {
    name: 'make typed by its bare name moves planDir too',
    flow: flowWith({ planDir: '/r/plan-z', progress: PROGRESS }),
    signal: skill('make', '/r/plan-a/plan.md'),
    expected: flowWith({
      stage: 'make',
      planDir: '/r/plan-a',
      reviewRoundsAtMake: null,
    }),
  },
  {
    name: 'wigley:make of a plan folder with a trailing separator',
    flow: flowWith({ planDir: '/r/plan-z', progress: PROGRESS }),
    signal: skill('wigley:make', '/r/plan-a/'),
    expected: flowWith({
      stage: 'make',
      planDir: '/r/plan-a',
      reviewRoundsAtMake: null,
    }),
  },
  {
    name: 'wigley:make of a plan.md',
    flow: flowWith({ planDir: '/r/plan-z', progress: PROGRESS }),
    signal: skill('wigley:make', '/r/plan-a/plan.md'),
    expected: flowWith({
      stage: 'make',
      planDir: '/r/plan-a',
      reviewRoundsAtMake: null,
    }),
  },
  {
    name: 'wigley:make of a folder that is no plan changes nothing',
    flow: flowWith({
      stage: 'make',
      planDir: '/r/plan-z',
      progress: PROGRESS,
      reviewRoundsAtMake: 1,
    }),
    signal: skill('wigley:make', '/r/docs/x'),
    expected: UNCHANGED,
  },
  {
    name: 'wigley:make reads argsPath, never args',
    flow: flowWith({
      stage: 'make',
      planDir: '/r/plan-z',
      progress: PROGRESS,
      reviewRoundsAtMake: 1,
    }),
    signal: {
      type: 'skillStarted',
      skill: 'wigley:make',
      args: 'plan-a',
      argsPath: null,
    },
    expected: UNCHANGED,
  },
  {
    name: 'wigley:make with no argument keeps the plan the flow holds',
    flow: flowWith({ ...IN_C, planDir: PLAN_X, progress: PROGRESS }),
    signal: skill('wigley:make', null),
    expected: flowWith({
      stage: 'make',
      planDir: PLAN_X,
      progress: PROGRESS,
      reviewRoundsAtMake: 1,
    }),
  },
  {
    name: 'another skill naming a plan changes nothing',
    flow: flowWith({ planDir: '/r/plan-z', progress: PROGRESS }),
    signal: skill('other:skill', '/r/plan-a'),
    expected: UNCHANGED,
  },
  {
    name: 'planChanged sets progress',
    flow: flowWith({ planDir: PLAN_X, reviewRoundsAtMake: 0 }),
    signal: planChanged(PROGRESS),
    expected: flowWith({
      planDir: PLAN_X,
      progress: PROGRESS,
      reviewRoundsAtMake: 0,
    }),
  },
  {
    name: 'planChanged with a changed task line replaces progress',
    flow: flowWith({
      planDir: PLAN_X,
      progress: PROGRESS,
      reviewRoundsAtMake: 0,
    }),
    signal: planChanged(PROGRESS_RETITLED_TASK),
    expected: flowWith({
      planDir: PLAN_X,
      progress: PROGRESS_RETITLED_TASK,
      reviewRoundsAtMake: 0,
    }),
  },
  {
    name: 'planChanged with a changed task status replaces progress',
    flow: flowWith({
      planDir: PLAN_X,
      progress: PROGRESS,
      reviewRoundsAtMake: 0,
    }),
    signal: planChanged(PROGRESS_TASK_RUNNING),
    expected: flowWith({
      planDir: PLAN_X,
      progress: PROGRESS_TASK_RUNNING,
      reviewRoundsAtMake: 0,
    }),
  },
  {
    name: 'planChanged with a changed task file replaces progress',
    flow: flowWith({
      planDir: PLAN_X,
      progress: PROGRESS,
      reviewRoundsAtMake: 0,
    }),
    signal: planChanged(PROGRESS_TASK_LINKED),
    expected: flowWith({
      planDir: PLAN_X,
      progress: PROGRESS_TASK_LINKED,
      reviewRoundsAtMake: 0,
    }),
  },
  {
    name: 'planChanged with an equal progress changes nothing',
    flow: flowWith({
      planDir: PLAN_X,
      progress: PROGRESS,
      reviewRoundsAtMake: 0,
    }),
    signal: planChanged(structuredClone(PROGRESS)),
    expected: UNCHANGED,
  },
  {
    name: 'cleared stops the turn, the subagents and the countdown',
    flow: flowWith({
      ...IN_C,
      turnRunning: true,
      runningSubagents: ['a1'],
      countdownEndsAt: 5000,
    }),
    signal: { type: 'cleared' },
    expected: flowWith(IN_C),
  },
  {
    name: 'the rules see the flow after the bookkeeping',
    flow: flowWith({ stage: 'explore', planDir: PLAN_X }),
    signal: planChanged(PROGRESS),
    expected: flowWith({
      stage: 'planReady',
      planDir: PLAN_X,
      progress: PROGRESS,
      reviewRoundsAtMake: 1,
    }),
  },
  {
    name: 'a stage change stops the countdown',
    flow: flowWith({
      stage: 'explore',
      planDir: PLAN_X,
      progress: PROGRESS,
      countdownEndsAt: 5000,
    }),
    signal: { type: 'turnEnded' },
    expected: flowWith({
      stage: 'planReady',
      planDir: PLAN_X,
      progress: PROGRESS,
    }),
  },
  {
    name: 'wigley:feature drops the plan',
    flow: flowWith({ ...IN_C, planDir: PLAN_X, progress: PROGRESS }),
    signal: skill('wigley:feature', null),
    expected: flowWith({ stage: 'explore' }),
  },
  {
    name: 'wigley:feature-primer drops the plan',
    flow: flowWith({ ...IN_C, planDir: PLAN_X, progress: PROGRESS }),
    signal: skill('wigley:feature-primer', null),
    expected: flowWith({ stage: 'primer' }),
  },
  {
    name: 'a report entering a clearsPlan stage keeps the plan',
    flow: flowWith({ stage: 'plan', planDir: PLAN_X, progress: PROGRESS }),
    signal: { type: 'stepReported', step: 'explore' },
    expected: flowWith({
      stage: 'explore',
      planDir: PLAN_X,
      progress: PROGRESS,
    }),
  },
  {
    name: 're-entering a clearsPlan stage drops the plan',
    flow: flowWith({
      stage: 'explore',
      planDir: PLAN_X,
      progress: PROGRESS,
    }),
    signal: skill('wigley:feature', null),
    expected: flowWith({ stage: 'explore' }),
  },
  {
    name: "entering make records the plan's review rounds",
    flow: flowWith({ ...IN_C, planDir: PLAN_X, progress: PROGRESS }),
    signal: skill('wigley:make', null),
    expected: flowWith({
      stage: 'make',
      planDir: PLAN_X,
      progress: PROGRESS,
      reviewRoundsAtMake: 1,
    }),
  },
  {
    name: 're-entering make records the rounds again',
    flow: flowWith({
      stage: 'make',
      planDir: PLAN_X,
      progress: PROGRESS,
      reviewRoundsAtMake: 0,
    }),
    signal: skill('wigley:make', null),
    expected: flowWith({
      stage: 'make',
      planDir: PLAN_X,
      progress: PROGRESS,
      reviewRoundsAtMake: 1,
    }),
  },
  {
    name: 'entering make with the plan unread records null',
    flow: flowWith({ ...IN_C, planDir: PLAN_X, reviewRoundsAtMake: 2 }),
    signal: skill('wigley:make', null),
    expected: flowWith({
      stage: 'make',
      planDir: PLAN_X,
      reviewRoundsAtMake: null,
    }),
  },
  {
    name: 'planChanged fills a null reviewRoundsAtMake',
    flow: flowWith({ planDir: PLAN_X, reviewRoundsAtMake: null }),
    signal: planChanged(PROGRESS),
    expected: flowWith({
      planDir: PLAN_X,
      progress: PROGRESS,
      reviewRoundsAtMake: 1,
    }),
  },
  {
    name: 'planChanged keeps a recorded reviewRoundsAtMake',
    flow: flowWith({
      planDir: PLAN_X,
      progress: PROGRESS,
      reviewRoundsAtMake: 0,
    }),
    signal: planChanged(PROGRESS_RETITLED_TASK),
    expected: flowWith({
      planDir: PLAN_X,
      progress: PROGRESS_RETITLED_TASK,
      reviewRoundsAtMake: 0,
    }),
  },
  {
    name: 'returning to idle drops the plan and leaves reviewRoundsAtMake',
    flow: flowWith({
      ...IN_C,
      planDir: PLAN_X,
      progress: PROGRESS,
      reviewRoundsAtMake: 1,
    }),
    signal: heavySignal({ type: 'handedOff' }),
    expected: flowWith({ reviewRoundsAtMake: 1 }),
  },
  {
    name: 'a signal nothing answers changes nothing',
    flow: flowWith({ ...IN_C, planDir: PLAN_X, progress: PROGRESS }),
    signal: heavySignal({ type: 'planGone' }),
    expected: UNCHANGED,
  },
];

describe('foldFlow over Heavy', () => {
  it.each(FOLD_ROWS)('$name', ({ flow, signal, expected }) => {
    const before = structuredClone(flow);

    const folded = foldFlow(flow, signal, [heavyMainWorkflow]);

    if (expected === UNCHANGED) {
      expect(folded).toBe(flow);
    } else {
      expect(folded).toEqual(expected);
    }
    expect(flow).toEqual(before);
  });
});

describe('isPlanFile', () => {
  it.each([
    { path: '/a/plan-x/plan.md', expected: true },
    { path: 'C:\\a\\plan-x\\plan.md', expected: true },
    { path: '/a/plan-/plan.md', expected: false },
    { path: '/a/x/plan.md', expected: false },
    { path: '/a/plan-x/notes.md', expected: false },
    { path: '/a/plan-x/plan.md.bak', expected: false },
  ])('$path → $expected', ({ path, expected }) => {
    expect(isPlanFile(path)).toBe(expected);
  });
});

describe('heavyStateOf', () => {
  it.each([
    { name: 'a null state', state: null },
    { name: 'a planDir not a string', state: { planDir: 3 } },
    {
      name: 'a progress of the wrong shape',
      state: { ...EMPTY_HEAVY_STATE, progress: { checked: 1 } },
    },
    {
      name: 'a task line with a status not a task status',
      state: stateWithTask({ ...PROGRESS.tasks[0], status: 'paused' }),
    },
    {
      name: 'a task line with file but no status',
      state: stateWithTask({ wave: 1, text: 'first', done: true, file: null }),
    },
  ])('heavyStateOf_BadShape_ReadsEmpty ($name)', ({ state }) => {
    expect(heavyStateOf({ ...newFlow('s1', '/r'), state })).toBe(
      EMPTY_HEAVY_STATE,
    );
  });

  it.each([
    {
      name: 'a state with progress',
      state: { ...EMPTY_HEAVY_STATE, progress: PROGRESS },
    },
    {
      name: 'a task line saved before file and status',
      state: stateWithTask({ wave: 1, text: 'first', done: true }),
    },
  ])('heavyStateOf_ValidState_ReadsThatObject ($name)', ({ state }) => {
    expect(heavyStateOf({ ...newFlow('s1', '/r'), state })).toBe(state);
  });

  it('withHeavyState patches the state and keeps the rest of the flow', () => {
    const flow = { ...newFlow('s1', '/r'), stage: 'make' };

    expect(withHeavyState(flow, { planDir: PLAN_X })).toEqual({
      ...flow,
      state: { ...EMPTY_HEAVY_STATE, planDir: PLAN_X },
    });
  });
});

describe('foldHeavyState', () => {
  it.each([
    { name: 'a null state', state: null },
    {
      name: 'a valid state',
      state: { ...EMPTY_HEAVY_STATE, planDir: PLAN_X } as HeavyState,
    },
  ])('foldHeavyState_NoChange_ReturnsFlowState ($name)', ({ state }) => {
    const flow = { ...flowWith(IN_C), state };

    expect(foldHeavyState(flow, { type: 'turnEnded' })).toBe(state);
  });
});

describe('sameHeavyState', () => {
  it.each([
    {
      name: 'equal values',
      a: { ...EMPTY_HEAVY_STATE },
      b: { ...EMPTY_HEAVY_STATE },
      same: true,
    },
    {
      name: 'null and the empty state',
      a: null,
      b: { ...EMPTY_HEAVY_STATE },
      same: true,
    },
    {
      name: 'another planDir',
      a: EMPTY_HEAVY_STATE,
      b: { ...EMPTY_HEAVY_STATE, planDir: PLAN_X },
      same: false,
    },
    {
      name: 'an equal progress in another object',
      a: { ...EMPTY_HEAVY_STATE, progress: PROGRESS },
      b: { ...EMPTY_HEAVY_STATE, progress: structuredClone(PROGRESS) },
      same: false,
    },
    {
      name: 'other review rounds',
      a: EMPTY_HEAVY_STATE,
      b: { ...EMPTY_HEAVY_STATE, reviewRoundsAtMake: 1 },
      same: false,
    },
    {
      name: 'another countdown',
      a: EMPTY_HEAVY_STATE,
      b: { ...EMPTY_HEAVY_STATE, countdownEndsAt: 1 },
      same: false,
    },
  ])('$name → $same', ({ a, b, same }) => {
    expect(sameHeavyState(a, b)).toBe(same);
  });
});

describe('heavyFixCycles', () => {
  const progress: PlanProgress = {
    checked: 2,
    total: 5,
    wave: 1,
    reviewRounds: 2,
    title: 'F',
    tasks: [],
  };

  it.each<{ name: string; flow: SessionFlow; cycles: number }>([
    {
      name: 'no progress',
      flow: flowWith({ stage: 'make' }),
      cycles: 0,
    },
    {
      name: 'two rounds',
      flow: flowWith({ stage: 'make', progress }),
      cycles: 2,
    },
    {
      name: 'two rounds after planGone',
      flow: foldFlow(
        flowWith({ stage: 'make', progress }),
        heavySignal({ type: 'planGone' }),
        [heavyMainWorkflow],
      ),
      cycles: 2,
    },
  ])('heavyFixCycles_ReadsTheRounds ($name)', ({ flow, cycles }) => {
    expect(heavyFixCycles(flow)).toBe(cycles);
  });
});

describe('heavyEventOf', () => {
  it.each<{ name: string; signal: WorkflowSignal; event: unknown }>([
    {
      name: 'a Heavy event',
      signal: heavySignal({ type: 'planGone' }),
      event: { type: 'planGone' },
    },
    {
      name: "another workflow's event",
      signal: { type: 'custom', event: { type: 'other' } },
      event: null,
    },
    {
      name: 'a signal of another type',
      signal: { type: 'turnEnded' },
      event: null,
    },
  ])('$name', ({ signal, event }) => {
    expect(heavyEventOf(signal)).toEqual(event);
  });
});
