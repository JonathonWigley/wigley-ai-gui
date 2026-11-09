import { describe, expect, it } from 'vitest';
import type { SessionFlow, WorkflowSignal } from '../workflow/contract';
import { foldFlow, newFlow } from '../workflow/flow';
import type { PlanProgress } from '../../shared/plan-progress';
import {
  EMPTY_LARGE_STATE,
  LARGE_WORKFLOW_ID,
  largeEventOf,
  largeSignal,
  type LargeState,
  largeStateOf,
  withLargeState,
} from './contract';
import {
  foldLargeState,
  largeFixCycles,
  isPlanFile,
  sameLargeState,
} from './large-state';
import { largeMainWorkflow } from './large-workflow';

type FlowFields = Partial<SessionFlow & LargeState>;

function flowWith(fields: FlowFields): SessionFlow {
  const {
    planDir,
    planReported,
    unreportedPlanDir,
    progress,
    reviewRoundsAtMake,
    countdownEndsAt,
    ...flow
  } = fields;
  return {
    ...newFlow('s1', '/r'),
    workflow: LARGE_WORKFLOW_ID,
    ...flow,
    state: {
      planDir: planDir ?? null,
      planReported: planReported ?? false,
      unreportedPlanDir: unreportedPlanDir ?? null,
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
  return { ...EMPTY_LARGE_STATE, progress: { ...PROGRESS, tasks: [task] } };
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
// One plan in the repo and its copy in a worktree.
const PLAN_IN_REPO = '/r/p/plan-a';
const PLAN_IN_WORKTREE = '/w/p/plan-a';
const PLAN_IN_WORKTREE_2 = '/w2/p/plan-a';
const PLAN_B_IN_WORKTREE = '/w/p/plan-b';
const PLAN_A_OTHER_FEATURE = '/w/q/plan-a';
const UNCHANGED = 'unchanged';
// A stage no Large rule names, so only the bookkeeping moves.
const IN_C = { stage: 'c' } as const;

function planChanged(progress: PlanProgress): WorkflowSignal {
  return largeSignal({ type: 'planChanged', progress });
}

function planReported(planDir: string): WorkflowSignal {
  return largeSignal({ type: 'planReported', planDir });
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
    signal: largeSignal({ type: 'handedOff' }),
    expected: flowWith({ reviewRoundsAtMake: 1 }),
  },
  {
    name: 'planReported of another folder moves planDir, marks it and drops progress',
    flow: flowWith({
      stage: 'make',
      planDir: PLAN_IN_REPO,
      progress: PROGRESS,
      reviewRoundsAtMake: 1,
    }),
    signal: planReported(PLAN_IN_WORKTREE),
    expected: flowWith({
      stage: 'make',
      planDir: PLAN_IN_WORKTREE,
      planReported: true,
      unreportedPlanDir: PLAN_IN_REPO,
    }),
  },
  {
    name: 'planReported of another folder after a report keeps the unreported folder',
    flow: flowWith({
      ...IN_C,
      planDir: PLAN_IN_WORKTREE,
      planReported: true,
      unreportedPlanDir: PLAN_IN_REPO,
      progress: PROGRESS,
    }),
    signal: planReported(PLAN_IN_WORKTREE_2),
    expected: flowWith({
      ...IN_C,
      planDir: PLAN_IN_WORKTREE_2,
      planReported: true,
      unreportedPlanDir: PLAN_IN_REPO,
    }),
  },
  {
    name: 'planReported of a folder named otherwise keeps no unreported folder',
    flow: flowWith({
      stage: 'make',
      planDir: PLAN_IN_REPO,
      progress: PROGRESS,
    }),
    signal: planReported(PLAN_B_IN_WORKTREE),
    expected: flowWith({
      stage: 'make',
      planDir: PLAN_B_IN_WORKTREE,
      planReported: true,
    }),
  },
  {
    name: 'planReported of the same plan name under another feature keeps no unreported folder',
    flow: flowWith({
      stage: 'make',
      planDir: PLAN_IN_REPO,
      progress: PROGRESS,
    }),
    signal: planReported(PLAN_A_OTHER_FEATURE),
    expected: flowWith({
      stage: 'make',
      planDir: PLAN_A_OTHER_FEATURE,
      planReported: true,
    }),
  },
  {
    name: 'planReported of a folder named otherwise after a report drops the unreported folder',
    flow: flowWith({
      ...IN_C,
      planDir: PLAN_IN_WORKTREE,
      planReported: true,
      unreportedPlanDir: PLAN_IN_REPO,
      progress: PROGRESS,
    }),
    signal: planReported(PLAN_B_IN_WORKTREE),
    expected: flowWith({
      ...IN_C,
      planDir: PLAN_B_IN_WORKTREE,
      planReported: true,
    }),
  },
  {
    name: 'planReported of the held folder marks it and keeps progress',
    flow: flowWith({ ...IN_C, planDir: PLAN_IN_WORKTREE, progress: PROGRESS }),
    signal: planReported(PLAN_IN_WORKTREE),
    expected: flowWith({
      ...IN_C,
      planDir: PLAN_IN_WORKTREE,
      planReported: true,
      progress: PROGRESS,
    }),
  },
  {
    name: 'planReported of the held, marked folder changes nothing',
    flow: flowWith({
      ...IN_C,
      planDir: PLAN_IN_WORKTREE,
      planReported: true,
      progress: PROGRESS,
    }),
    signal: planReported(PLAN_IN_WORKTREE),
    expected: UNCHANGED,
  },
  {
    name: 'wigley:make of another folder after a report moves planDir and drops the mark',
    flow: flowWith({
      stage: 'make',
      planDir: PLAN_IN_WORKTREE,
      planReported: true,
      unreportedPlanDir: PLAN_X,
      progress: PROGRESS,
    }),
    signal: skill('wigley:make', PLAN_IN_REPO),
    expected: flowWith({ stage: 'make', planDir: PLAN_IN_REPO }),
  },
  {
    name: 'dropping the plan drops the mark',
    flow: flowWith({
      ...IN_C,
      planDir: PLAN_IN_WORKTREE,
      planReported: true,
      unreportedPlanDir: PLAN_IN_REPO,
      progress: PROGRESS,
    }),
    signal: skill('wigley:feature', null),
    expected: flowWith({ stage: 'explore' }),
  },
  {
    name: 'fileWritten of another plan after a report moves planDir and drops the mark',
    flow: flowWith({
      ...IN_C,
      planDir: PLAN_IN_WORKTREE,
      planReported: true,
      unreportedPlanDir: PLAN_X,
      progress: PROGRESS,
    }),
    signal: { type: 'fileWritten', path: `${PLAN_IN_REPO}/plan.md` },
    expected: flowWith({ ...IN_C, planDir: PLAN_IN_REPO }),
  },
  {
    name: 'fileWritten of the reported plan changes nothing',
    flow: flowWith({
      ...IN_C,
      planDir: PLAN_IN_WORKTREE,
      planReported: true,
      unreportedPlanDir: PLAN_IN_REPO,
      progress: PROGRESS,
    }),
    signal: { type: 'fileWritten', path: `${PLAN_IN_WORKTREE}/plan.md` },
    expected: UNCHANGED,
  },
  {
    name: 'a signal nothing answers changes nothing',
    flow: flowWith({ ...IN_C, planDir: PLAN_X, progress: PROGRESS }),
    signal: largeSignal({ type: 'planGone' }),
    expected: UNCHANGED,
  },
];

describe('foldFlow over Large', () => {
  it.each(FOLD_ROWS)('$name', ({ flow, signal, expected }) => {
    const before = structuredClone(flow);

    const folded = foldFlow(flow, signal, [largeMainWorkflow]);

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

describe('largeStateOf', () => {
  it.each([
    { name: 'a null state', state: null },
    { name: 'a planDir not a string', state: { planDir: 3 } },
    {
      name: 'a progress of the wrong shape',
      state: { ...EMPTY_LARGE_STATE, progress: { checked: 1 } },
    },
    {
      name: 'a task line with a status not a task status',
      state: stateWithTask({ ...PROGRESS.tasks[0], status: 'paused' }),
    },
    {
      name: 'a task line with file but no status',
      state: stateWithTask({ wave: 1, text: 'first', done: true, file: null }),
    },
    {
      name: 'a task line with neither file nor status',
      state: stateWithTask({ wave: 1, text: 'first', done: true }),
    },
    {
      name: 'a planReported not a boolean',
      state: { ...EMPTY_LARGE_STATE, planReported: 'yes' },
    },
    {
      name: 'an unreportedPlanDir not a string',
      state: { ...EMPTY_LARGE_STATE, unreportedPlanDir: 3 },
    },
  ])('largeStateOf_BadShape_ReadsEmpty ($name)', ({ state }) => {
    expect(largeStateOf({ ...newFlow('s1', '/r'), state })).toBe(
      EMPTY_LARGE_STATE,
    );
  });

  it.each([
    {
      name: 'a state with progress',
      state: { ...EMPTY_LARGE_STATE, progress: PROGRESS },
    },
  ])('largeStateOf_ValidState_ReadsThatObject ($name)', ({ state }) => {
    expect(largeStateOf({ ...newFlow('s1', '/r'), state })).toBe(state);
  });

  it('largeStateOf_SavedBeforeReports_ReadsUnreported', () => {
    const state = {
      planDir: PLAN_X,
      progress: PROGRESS,
      reviewRoundsAtMake: 1,
      countdownEndsAt: null,
    };

    expect(largeStateOf({ ...newFlow('s1', '/r'), state })).toEqual({
      ...state,
      planReported: false,
      unreportedPlanDir: null,
    });
  });

  it('withLargeState patches the state and keeps the rest of the flow', () => {
    const flow = { ...newFlow('s1', '/r'), stage: 'make' };

    expect(withLargeState(flow, { planDir: PLAN_X })).toEqual({
      ...flow,
      state: { ...EMPTY_LARGE_STATE, planDir: PLAN_X },
    });
  });
});

describe('foldLargeState', () => {
  it.each([
    { name: 'a null state', state: null },
    {
      name: 'a valid state',
      state: { ...EMPTY_LARGE_STATE, planDir: PLAN_X } as LargeState,
    },
  ])('foldLargeState_NoChange_ReturnsFlowState ($name)', ({ state }) => {
    const flow = { ...flowWith(IN_C), state };

    expect(foldLargeState(flow, { type: 'turnEnded' })).toBe(state);
  });
});

describe('sameLargeState', () => {
  it.each([
    {
      name: 'equal values',
      a: { ...EMPTY_LARGE_STATE },
      b: { ...EMPTY_LARGE_STATE },
      same: true,
    },
    {
      name: 'null and the empty state',
      a: null,
      b: { ...EMPTY_LARGE_STATE },
      same: true,
    },
    {
      name: 'another planDir',
      a: EMPTY_LARGE_STATE,
      b: { ...EMPTY_LARGE_STATE, planDir: PLAN_X },
      same: false,
    },
    {
      name: 'an equal progress in another object',
      a: { ...EMPTY_LARGE_STATE, progress: PROGRESS },
      b: { ...EMPTY_LARGE_STATE, progress: structuredClone(PROGRESS) },
      same: false,
    },
    {
      name: 'another planReported',
      a: EMPTY_LARGE_STATE,
      b: { ...EMPTY_LARGE_STATE, planReported: true },
      same: false,
    },
    {
      name: 'another unreportedPlanDir',
      a: EMPTY_LARGE_STATE,
      b: { ...EMPTY_LARGE_STATE, unreportedPlanDir: PLAN_X },
      same: false,
    },
    {
      name: 'other review rounds',
      a: EMPTY_LARGE_STATE,
      b: { ...EMPTY_LARGE_STATE, reviewRoundsAtMake: 1 },
      same: false,
    },
    {
      name: 'another countdown',
      a: EMPTY_LARGE_STATE,
      b: { ...EMPTY_LARGE_STATE, countdownEndsAt: 1 },
      same: false,
    },
  ])('$name → $same', ({ a, b, same }) => {
    expect(sameLargeState(a, b)).toBe(same);
  });
});

describe('largeFixCycles', () => {
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
        largeSignal({ type: 'planGone' }),
        [largeMainWorkflow],
      ),
      cycles: 2,
    },
  ])('largeFixCycles_ReadsTheRounds ($name)', ({ flow, cycles }) => {
    expect(largeFixCycles(flow)).toBe(cycles);
  });
});

describe('largeEventOf', () => {
  it.each<{ name: string; signal: WorkflowSignal; event: unknown }>([
    {
      name: 'a Large event',
      signal: largeSignal({ type: 'planGone' }),
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
    expect(largeEventOf(signal)).toEqual(event);
  });
});
