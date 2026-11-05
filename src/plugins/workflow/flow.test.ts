import { describe, expect, it } from 'vitest';
import {
  IDLE_STAGE,
  isBusy,
  type MainStage,
  type SessionFlow,
  type StageId,
  type WorkflowSignal,
} from './contract';
import { foldFlow, isPlanFile, newFlow } from './flow';
import type { PlanProgress } from './plan-reader';

function flowWith(fields: Partial<SessionFlow>): SessionFlow {
  return { ...newFlow('s1', '/r'), ...fields };
}

function fake(
  id: StageId,
  order: number,
  enter: MainStage['enter'],
  flags: Pick<MainStage, 'clearsPlan' | 'recordsReviewRounds'> = {},
): MainStage {
  return { id, order, enter, ...flags };
}

function skill(name: string, argsPath: string | null): WorkflowSignal {
  return {
    type: 'skillStarted',
    skill: name,
    args: argsPath ?? '',
    argsPath,
  };
}

const STAGES: readonly MainStage[] = [
  fake(IDLE_STAGE, 0, (_f, s) => (s.type === 'handedOff' ? IDLE_STAGE : null)),
  fake('a', 10, (_f, s) => (s.type === 'dismissed' ? 'a' : null)),
  fake('b', 20, (_f, s) =>
    s.type === 'skillStarted' && s.skill === 'x:b' ? 'b' : null,
  ),
  fake('c', 30, (f, s) => {
    const startedB = s.type === 'skillStarted' && s.skill === 'x:b';
    const endedWithPlan = s.type === 'turnEnded' && f.planDir !== null;
    return startedB || endedWithPlan ? 'c' : null;
  }),
  fake(
    'e',
    40,
    (_f, s) => {
      const startedE = s.type === 'skillStarted' && s.skill === 'x:e';
      const reportedE = s.type === 'stepReported' && s.step === 'e';
      return startedE || reportedE ? 'e' : null;
    },
    { clearsPlan: true },
  ),
  fake(
    'm',
    50,
    (_f, s) => (s.type === 'skillStarted' && s.skill === 'x:m' ? 'm' : null),
    { recordsReviewRounds: true },
  ),
];

const WITH_PLAN_WATCHER: readonly MainStage[] = [
  fake('d', 5, (f, s) =>
    s.type === 'fileWritten' && f.planDir !== null ? 'd' : null,
  ),
  ...STAGES,
];

const PROGRESS: PlanProgress = {
  checked: 1,
  total: 3,
  wave: 2,
  reviewRounds: 1,
  title: 'Plan A',
  tasks: [
    { wave: 1, text: 'first', done: true },
    { wave: 2, text: 'second', done: false },
    { wave: 2, text: 'third', done: false },
  ],
};
const PROGRESS_RETITLED_TASK: PlanProgress = {
  ...PROGRESS,
  tasks: [
    PROGRESS.tasks[0],
    { ...PROGRESS.tasks[1], text: 'renamed' },
    PROGRESS.tasks[2],
  ],
};

const PLAN_X = '/r/docs/features/x/plan-a';
const UNCHANGED = 'unchanged';

interface FoldRow {
  name: string;
  flow: SessionFlow;
  signal: WorkflowSignal;
  expected: SessionFlow | typeof UNCHANGED;
  stages?: readonly MainStage[];
}

const IN_C = { stage: 'c' } as const;

const FOLD_ROWS: FoldRow[] = [
  {
    name: 'turnStarted sets turnRunning and stops the countdown',
    flow: flowWith({ ...IN_C, countdownEndsAt: 5000 }),
    signal: { type: 'turnStarted' },
    expected: flowWith({ ...IN_C, turnRunning: true }),
  },
  {
    name: 'turnEnded clears turnRunning and keeps running subagents',
    flow: flowWith({ turnRunning: true, runningSubagents: ['a1'] }),
    signal: { type: 'turnEnded' },
    expected: flowWith({ runningSubagents: ['a1'] }),
  },
  {
    name: 'subagentStarted adds the agent',
    flow: flowWith({}),
    signal: { type: 'subagentStarted', agentId: 'a1' },
    expected: flowWith({ runningSubagents: ['a1'] }),
  },
  {
    name: 'subagentStarted for a listed agent changes nothing',
    flow: flowWith({ runningSubagents: ['a1'] }),
    signal: { type: 'subagentStarted', agentId: 'a1' },
    expected: UNCHANGED,
  },
  {
    name: 'subagentFinished removes the agent',
    flow: flowWith({ runningSubagents: ['a1', 'a2'] }),
    signal: { type: 'subagentFinished', agentId: 'a1' },
    expected: flowWith({ runningSubagents: ['a2'] }),
  },
  {
    name: 'subagentFinished for an unlisted agent changes nothing',
    flow: flowWith({ runningSubagents: ['a1', 'a2'] }),
    signal: { type: 'subagentFinished', agentId: 'a9' },
    expected: UNCHANGED,
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
    expected: flowWith({ planDir: '/r/plan-a', reviewRoundsAtMake: null }),
  },
  {
    name: 'make typed by its bare name moves planDir too',
    flow: flowWith({ planDir: '/r/plan-z', progress: PROGRESS }),
    signal: skill('make', '/r/plan-a/plan.md'),
    expected: flowWith({ planDir: '/r/plan-a', reviewRoundsAtMake: null }),
  },
  {
    name: 'wigley:make of a plan folder with a trailing separator',
    flow: flowWith({ planDir: '/r/plan-z', progress: PROGRESS }),
    signal: skill('wigley:make', '/r/plan-a/'),
    expected: flowWith({ planDir: '/r/plan-a', reviewRoundsAtMake: null }),
  },
  {
    name: 'wigley:make of a plan.md',
    flow: flowWith({ planDir: '/r/plan-z', progress: PROGRESS }),
    signal: skill('wigley:make', '/r/plan-a/plan.md'),
    expected: flowWith({ planDir: '/r/plan-a', reviewRoundsAtMake: null }),
  },
  {
    name: 'wigley:make of a folder that is no plan changes nothing',
    flow: flowWith({ planDir: '/r/plan-z', progress: PROGRESS }),
    signal: skill('wigley:make', '/r/docs/x'),
    expected: UNCHANGED,
  },
  {
    name: 'wigley:make reads argsPath, never args',
    flow: flowWith({ planDir: '/r/plan-z', progress: PROGRESS }),
    signal: {
      type: 'skillStarted',
      skill: 'wigley:make',
      args: 'plan-a',
      argsPath: null,
    },
    expected: UNCHANGED,
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
    signal: { type: 'planChanged', progress: PROGRESS },
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
    signal: { type: 'planChanged', progress: PROGRESS_RETITLED_TASK },
    expected: flowWith({
      planDir: PLAN_X,
      progress: PROGRESS_RETITLED_TASK,
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
    signal: { type: 'planChanged', progress: structuredClone(PROGRESS) },
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
    name: 'the first stage rule in order wins',
    flow: flowWith({}),
    signal: skill('x:b', null),
    expected: flowWith({ stage: 'b' }),
  },
  {
    name: 'no rule answering keeps the stage',
    flow: flowWith({ stage: 'b', turnRunning: true }),
    signal: { type: 'turnEnded' },
    expected: flowWith({ stage: 'b' }),
  },
  {
    name: 'a rule answering moves the stage',
    flow: flowWith({
      stage: 'b',
      turnRunning: true,
      planDir: PLAN_X,
    }),
    signal: { type: 'turnEnded' },
    expected: flowWith({ ...IN_C, planDir: PLAN_X }),
  },
  {
    name: 'the rules see the flow after bookkeeping',
    flow: flowWith({}),
    signal: { type: 'fileWritten', path: `${PLAN_X}/plan.md` },
    stages: WITH_PLAN_WATCHER,
    expected: flowWith({
      stage: 'd',
      planDir: PLAN_X,
      reviewRoundsAtMake: null,
    }),
  },
  {
    name: 'a stage change stops the countdown',
    flow: flowWith({
      stage: 'b',
      planDir: PLAN_X,
      countdownEndsAt: 5000,
    }),
    signal: { type: 'turnEnded' },
    expected: flowWith({ ...IN_C, planDir: PLAN_X }),
  },
  {
    name: 'entering a clearsPlan stage drops the plan',
    flow: flowWith({ ...IN_C, planDir: PLAN_X, progress: PROGRESS }),
    signal: skill('x:e', null),
    expected: flowWith({ stage: 'e' }),
  },
  {
    name: 'a report entering a clearsPlan stage keeps the plan',
    flow: flowWith({ ...IN_C, planDir: PLAN_X, progress: PROGRESS }),
    signal: { type: 'stepReported', step: 'e' },
    expected: flowWith({ stage: 'e', planDir: PLAN_X, progress: PROGRESS }),
  },
  {
    name: 're-entering a clearsPlan stage drops the plan',
    flow: flowWith({
      stage: 'e',
      planDir: PLAN_X,
      progress: PROGRESS,
    }),
    signal: skill('x:e', null),
    expected: flowWith({ stage: 'e' }),
  },
  {
    name: "entering a recordsReviewRounds stage records the plan's review rounds",
    flow: flowWith({ ...IN_C, planDir: PLAN_X, progress: PROGRESS }),
    signal: skill('x:m', null),
    expected: flowWith({
      stage: 'm',
      planDir: PLAN_X,
      progress: PROGRESS,
      reviewRoundsAtMake: 1,
    }),
  },
  {
    name: 're-entering a recordsReviewRounds stage records the rounds again',
    flow: flowWith({
      stage: 'm',
      planDir: PLAN_X,
      progress: PROGRESS,
      reviewRoundsAtMake: 0,
    }),
    signal: skill('x:m', null),
    expected: flowWith({
      stage: 'm',
      planDir: PLAN_X,
      progress: PROGRESS,
      reviewRoundsAtMake: 1,
    }),
  },
  {
    name: 'entering a recordsReviewRounds stage with the plan unread records null',
    flow: flowWith({ ...IN_C, planDir: PLAN_X }),
    signal: skill('x:m', null),
    expected: flowWith({
      stage: 'm',
      planDir: PLAN_X,
      reviewRoundsAtMake: null,
    }),
  },
  {
    name: 'planChanged fills a null reviewRoundsAtMake',
    flow: flowWith({ planDir: PLAN_X, reviewRoundsAtMake: null }),
    signal: { type: 'planChanged', progress: PROGRESS },
    expected: flowWith({
      planDir: PLAN_X,
      progress: PROGRESS,
      reviewRoundsAtMake: 1,
    }),
  },
  {
    name: 'planChanged fills a reviewRoundsAtMake left out (a flow saved before the field)',
    flow: flowWith({ planDir: PLAN_X }),
    signal: { type: 'planChanged', progress: PROGRESS },
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
    signal: { type: 'planChanged', progress: PROGRESS_RETITLED_TASK },
    expected: flowWith({
      planDir: PLAN_X,
      progress: PROGRESS_RETITLED_TASK,
      reviewRoundsAtMake: 0,
    }),
  },
  {
    name: 'returning to idle drops the plan',
    flow: flowWith({ ...IN_C, planDir: PLAN_X, progress: PROGRESS }),
    signal: { type: 'handedOff' },
    expected: flowWith({}),
  },
  {
    name: 'a signal nothing answers changes nothing',
    flow: flowWith({ ...IN_C, planDir: PLAN_X, progress: PROGRESS }),
    signal: { type: 'planGone' },
    expected: UNCHANGED,
  },
];

describe('foldFlow', () => {
  it.each(FOLD_ROWS)('$name', ({ flow, signal, expected, stages }) => {
    const before = structuredClone(flow);

    const folded = foldFlow(flow, signal, stages ?? STAGES);

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

describe('isBusy', () => {
  it.each([
    { name: 'no turn and no subagent', fields: {}, expected: false },
    { name: 'a turn', fields: { turnRunning: true }, expected: true },
    {
      name: 'a subagent',
      fields: { runningSubagents: ['a1'] },
      expected: true,
    },
  ])('$name → $expected', ({ fields, expected }) => {
    expect(isBusy(flowWith(fields))).toBe(expected);
  });
});
