import { describe, expect, it } from 'vitest';
import {
  CHECKLIST_WORKFLOW,
  type DeclaredWorkflow,
  type PlanProgress,
  type PlanState,
  type SessionFlow,
  type WorkflowSignal,
} from '../contract';
import { newFlow } from '../flow';
import { createPlanFold, sameProgress } from './plan-fold';
import {
  PLAN_WORKFLOW_ID,
  planWorkflowFixture,
} from './plan-fixtures.test-support';

const NO_PLAN: PlanState = {
  dir: null,
  reported: false,
  unreportedDir: null,
  progress: null,
  snapshots: {},
};

function planWith(fields: Partial<PlanState>): PlanState {
  return { ...NO_PLAN, ...fields };
}

// A flow of the plan workflow in `stage` holding `plan`.
function flowWith(plan: PlanState | null, stage = 'c'): SessionFlow {
  return {
    ...newFlow('s1', '/r'),
    workflow: PLAN_WORKFLOW_ID,
    stage,
    plan,
  };
}

function skill(name: string, argsPath: string | null): WorkflowSignal {
  return { type: 'skillStarted', skill: name, args: argsPath ?? '', argsPath };
}

const PROGRESS: PlanProgress = {
  title: 'Plan A',
  checked: 1,
  total: 3,
  wave: 2,
  counters: { reviewRounds: 1 },
  tasks: [
    {
      group: 1,
      text: 'first',
      done: true,
      file: null,
      status: null,
      verification: false,
    },
    {
      group: 2,
      text: 'second',
      done: false,
      file: null,
      status: null,
      verification: false,
    },
    {
      group: 2,
      text: 'third',
      done: false,
      file: null,
      status: null,
      verification: false,
    },
  ],
};

function withTask(fields: Partial<PlanProgress['tasks'][number]>) {
  return {
    ...PROGRESS,
    tasks: [
      PROGRESS.tasks[0],
      { ...PROGRESS.tasks[1], ...fields },
      PROGRESS.tasks[2],
    ],
  };
}

const PROGRESS_RETITLED_TASK = withTask({ text: 'renamed' });
const PROGRESS_TASK_RUNNING = withTask({ status: 'in progress' });
const PROGRESS_TASK_LINKED = withTask({ file: '02-second.md' });

const PLAN_X = '/r/docs/features/x/plan-a';
// One plan in the repo and its copy in a worktree.
const PLAN_IN_REPO = '/r/p/plan-a';
const PLAN_IN_WORKTREE = '/w/p/plan-a';
const PLAN_IN_WORKTREE_2 = '/w2/p/plan-a';
const PLAN_B_IN_WORKTREE = '/w/p/plan-b';
const PLAN_A_OTHER_FEATURE = '/w/q/plan-a';
const UNCHANGED = 'unchanged';

const planChanged = (progress: PlanProgress): WorkflowSignal => ({
  type: 'planChanged',
  progress,
});
const planReported = (planDir: string): WorkflowSignal => ({
  type: 'planReported',
  planDir,
});

const FOLD_ROWS: {
  name: string;
  flow: SessionFlow;
  signal: WorkflowSignal;
  planFromArgs?: boolean;
  expected: PlanState | typeof UNCHANGED;
}[] = [
  {
    name: 'fileWritten of a new plan moves dir and drops progress and snapshots',
    flow: flowWith(
      planWith({
        dir: PLAN_X,
        progress: PROGRESS,
        snapshots: { reviewRounds: 1 },
      }),
    ),
    signal: { type: 'fileWritten', path: '/r/docs/features/y/plan-b/plan.md' },
    expected: planWith({ dir: '/r/docs/features/y/plan-b' }),
  },
  {
    name: 'fileWritten of the same plan keeps progress',
    flow: flowWith(planWith({ dir: PLAN_X, progress: PROGRESS })),
    signal: { type: 'fileWritten', path: `${PLAN_X}/plan.md` },
    expected: UNCHANGED,
  },
  {
    name: 'fileWritten of a non-plan file changes nothing',
    flow: flowWith(planWith({ dir: PLAN_X, progress: PROGRESS })),
    signal: { type: 'fileWritten', path: '/r/src/a.ts' },
    expected: UNCHANGED,
  },
  {
    name: 'fileWritten with backslash separators',
    flow: flowWith(null),
    signal: { type: 'fileWritten', path: 'C:\\r\\plan-a\\plan.md' },
    expected: planWith({ dir: 'C:\\r\\plan-a' }),
  },
  {
    name: 'a planFromArgs skill of a plan folder moves dir and drops progress',
    flow: flowWith(planWith({ dir: '/r/plan-z', progress: PROGRESS })),
    signal: skill('test:make', '/r/plan-a'),
    planFromArgs: true,
    expected: planWith({ dir: '/r/plan-a' }),
  },
  {
    name: 'a planFromArgs skill of a plan folder with a trailing separator',
    flow: flowWith(planWith({ dir: '/r/plan-z', progress: PROGRESS })),
    signal: skill('test:make', '/r/plan-a/'),
    planFromArgs: true,
    expected: planWith({ dir: '/r/plan-a' }),
  },
  {
    name: 'a planFromArgs skill of a plan.md',
    flow: flowWith(planWith({ dir: '/r/plan-z', progress: PROGRESS })),
    signal: skill('test:make', '/r/plan-a/plan.md'),
    planFromArgs: true,
    expected: planWith({ dir: '/r/plan-a' }),
  },
  {
    name: 'a planFromArgs skill of a folder that is no plan changes nothing',
    flow: flowWith(
      planWith({
        dir: '/r/plan-z',
        progress: PROGRESS,
        snapshots: { reviewRounds: 1 },
      }),
      'make',
    ),
    signal: skill('test:make', '/r/docs/x'),
    planFromArgs: true,
    expected: UNCHANGED,
  },
  {
    name: 'a planFromArgs skill reads argsPath, never args',
    flow: flowWith(planWith({ dir: '/r/plan-z', progress: PROGRESS }), 'make'),
    signal: {
      type: 'skillStarted',
      skill: 'test:make',
      args: 'plan-a',
      argsPath: null,
    },
    planFromArgs: true,
    expected: UNCHANGED,
  },
  {
    name: 'a planFromArgs skill with no argument keeps the plan the flow holds',
    flow: flowWith(planWith({ dir: PLAN_X, progress: PROGRESS })),
    signal: skill('test:make', null),
    planFromArgs: true,
    expected: UNCHANGED,
  },
  {
    name: 'another skill naming a plan changes nothing',
    flow: flowWith(planWith({ dir: '/r/plan-z', progress: PROGRESS })),
    signal: skill('other:skill', '/r/plan-a'),
    planFromArgs: false,
    expected: UNCHANGED,
  },
  {
    name: 'planChanged sets progress',
    flow: flowWith(planWith({ dir: PLAN_X, snapshots: { reviewRounds: 0 } })),
    signal: planChanged(PROGRESS),
    expected: planWith({
      dir: PLAN_X,
      progress: PROGRESS,
      snapshots: { reviewRounds: 0 },
    }),
  },
  {
    name: 'planChanged with a changed task line replaces progress',
    flow: flowWith(planWith({ dir: PLAN_X, progress: PROGRESS })),
    signal: planChanged(PROGRESS_RETITLED_TASK),
    expected: planWith({ dir: PLAN_X, progress: PROGRESS_RETITLED_TASK }),
  },
  {
    name: 'planChanged with a changed task status replaces progress',
    flow: flowWith(planWith({ dir: PLAN_X, progress: PROGRESS })),
    signal: planChanged(PROGRESS_TASK_RUNNING),
    expected: planWith({ dir: PLAN_X, progress: PROGRESS_TASK_RUNNING }),
  },
  {
    name: 'planChanged with a changed task file replaces progress',
    flow: flowWith(planWith({ dir: PLAN_X, progress: PROGRESS })),
    signal: planChanged(PROGRESS_TASK_LINKED),
    expected: planWith({ dir: PLAN_X, progress: PROGRESS_TASK_LINKED }),
  },
  {
    name: 'planChanged with a changed counter replaces progress',
    flow: flowWith(planWith({ dir: PLAN_X, progress: PROGRESS })),
    signal: planChanged({ ...PROGRESS, counters: { reviewRounds: 2 } }),
    expected: planWith({
      dir: PLAN_X,
      progress: { ...PROGRESS, counters: { reviewRounds: 2 } },
    }),
  },
  {
    name: 'planChanged with an equal progress changes nothing',
    flow: flowWith(planWith({ dir: PLAN_X, progress: PROGRESS })),
    signal: planChanged(structuredClone(PROGRESS)),
    expected: UNCHANGED,
  },
  {
    name: 'planChanged in a records stage fills an absent snapshot',
    flow: flowWith(planWith({ dir: PLAN_X }), 'make'),
    signal: planChanged(PROGRESS),
    expected: planWith({
      dir: PLAN_X,
      progress: PROGRESS,
      snapshots: { reviewRounds: 1 },
    }),
  },
  {
    name: 'planChanged in a records stage keeps a recorded snapshot',
    flow: flowWith(
      planWith({
        dir: PLAN_X,
        progress: PROGRESS,
        snapshots: { reviewRounds: 0 },
      }),
      'make',
    ),
    signal: planChanged(PROGRESS_RETITLED_TASK),
    expected: planWith({
      dir: PLAN_X,
      progress: PROGRESS_RETITLED_TASK,
      snapshots: { reviewRounds: 0 },
    }),
  },
  {
    name: 'planChanged outside a records stage records no snapshot',
    flow: flowWith(planWith({ dir: PLAN_X })),
    signal: planChanged(PROGRESS),
    expected: planWith({ dir: PLAN_X, progress: PROGRESS }),
  },
  {
    name: 'planReported of another folder moves dir, marks it and drops progress',
    flow: flowWith(
      planWith({
        dir: PLAN_IN_REPO,
        progress: PROGRESS,
        snapshots: { reviewRounds: 1 },
      }),
      'make',
    ),
    signal: planReported(PLAN_IN_WORKTREE),
    expected: planWith({
      dir: PLAN_IN_WORKTREE,
      reported: true,
      unreportedDir: PLAN_IN_REPO,
    }),
  },
  {
    name: 'planReported of another folder after a report keeps the unreported folder',
    flow: flowWith(
      planWith({
        dir: PLAN_IN_WORKTREE,
        reported: true,
        unreportedDir: PLAN_IN_REPO,
        progress: PROGRESS,
      }),
    ),
    signal: planReported(PLAN_IN_WORKTREE_2),
    expected: planWith({
      dir: PLAN_IN_WORKTREE_2,
      reported: true,
      unreportedDir: PLAN_IN_REPO,
    }),
  },
  {
    name: 'planReported of a folder named otherwise keeps no unreported folder',
    flow: flowWith(planWith({ dir: PLAN_IN_REPO, progress: PROGRESS })),
    signal: planReported(PLAN_B_IN_WORKTREE),
    expected: planWith({ dir: PLAN_B_IN_WORKTREE, reported: true }),
  },
  {
    name: 'planReported of the same plan name under another feature keeps no unreported folder',
    flow: flowWith(planWith({ dir: PLAN_IN_REPO, progress: PROGRESS })),
    signal: planReported(PLAN_A_OTHER_FEATURE),
    expected: planWith({ dir: PLAN_A_OTHER_FEATURE, reported: true }),
  },
  {
    name: 'planReported of a folder named otherwise after a report drops the unreported folder',
    flow: flowWith(
      planWith({
        dir: PLAN_IN_WORKTREE,
        reported: true,
        unreportedDir: PLAN_IN_REPO,
        progress: PROGRESS,
      }),
    ),
    signal: planReported(PLAN_B_IN_WORKTREE),
    expected: planWith({ dir: PLAN_B_IN_WORKTREE, reported: true }),
  },
  {
    name: 'planReported of the held folder marks it and keeps progress',
    flow: flowWith(planWith({ dir: PLAN_IN_WORKTREE, progress: PROGRESS })),
    signal: planReported(PLAN_IN_WORKTREE),
    expected: planWith({
      dir: PLAN_IN_WORKTREE,
      reported: true,
      progress: PROGRESS,
    }),
  },
  {
    name: 'planReported of the held, marked folder changes nothing',
    flow: flowWith(
      planWith({ dir: PLAN_IN_WORKTREE, reported: true, progress: PROGRESS }),
    ),
    signal: planReported(PLAN_IN_WORKTREE),
    expected: UNCHANGED,
  },
  {
    name: 'a planFromArgs skill of another folder after a report moves dir and drops the mark',
    flow: flowWith(
      planWith({
        dir: PLAN_IN_WORKTREE,
        reported: true,
        unreportedDir: PLAN_X,
        progress: PROGRESS,
      }),
      'make',
    ),
    signal: skill('test:make', PLAN_IN_REPO),
    planFromArgs: true,
    expected: planWith({ dir: PLAN_IN_REPO }),
  },
  {
    name: 'fileWritten of another plan after a report moves dir and drops the mark',
    flow: flowWith(
      planWith({
        dir: PLAN_IN_WORKTREE,
        reported: true,
        unreportedDir: PLAN_X,
        progress: PROGRESS,
      }),
    ),
    signal: { type: 'fileWritten', path: `${PLAN_IN_REPO}/plan.md` },
    expected: planWith({ dir: PLAN_IN_REPO }),
  },
  {
    name: 'fileWritten of the reported plan changes nothing',
    flow: flowWith(
      planWith({
        dir: PLAN_IN_WORKTREE,
        reported: true,
        unreportedDir: PLAN_IN_REPO,
        progress: PROGRESS,
      }),
    ),
    signal: { type: 'fileWritten', path: `${PLAN_IN_WORKTREE}/plan.md` },
    expected: UNCHANGED,
  },
  {
    name: 'a signal nothing answers changes nothing',
    flow: flowWith(planWith({ dir: PLAN_X, progress: PROGRESS })),
    signal: { type: 'turnEnded' },
    expected: UNCHANGED,
  },
  {
    name: 'a null plan a signal leaves unread stays null',
    flow: flowWith(null),
    signal: { type: 'fileWritten', path: '/r/src/a.ts' },
    expected: UNCHANGED,
  },
];

describe('createPlanFold', () => {
  it.each(FOLD_ROWS)(
    '$name',
    ({ flow, signal, planFromArgs = false, expected }) => {
      const before = structuredClone(flow);

      const plan = createPlanFold().fold(
        flow,
        signal,
        planWorkflowFixture(),
        planFromArgs,
      );

      if (expected === UNCHANGED) {
        expect(plan).toBe(flow.plan);
      } else {
        expect(plan).toEqual(expected);
      }
      expect(flow).toEqual(before);
    },
  );

  it('fold_NoFolderKnob_WritesAndArgsSetNothing', () => {
    const workflow: DeclaredWorkflow = {
      ...planWorkflowFixture(),
      planFormat: { file: 'plan.md' },
    };
    const fold = createPlanFold();
    const flow = flowWith(null);

    expect(
      fold.fold(
        flow,
        { type: 'fileWritten', path: '/r/plan-a/plan.md' },
        workflow,
        false,
      ),
    ).toBeNull();
    expect(
      fold.fold(flow, skill('test:make', '/r/plan-a'), workflow, true),
    ).toBeNull();
  });

  it('fold_GlobNeedsACharacterAfterStar', () => {
    const flow = flowWith(null);

    expect(
      createPlanFold().fold(
        flow,
        { type: 'fileWritten', path: '/r/docs/plan-/plan.md' },
        planWorkflowFixture(),
        false,
      ),
    ).toBeNull();
  });

  it('fold_FirstRead_FillsTheRecordedSnapshotOnce', () => {
    const fold = createPlanFold();
    const workflow = planWorkflowFixture();
    const first = fold.fold(
      flowWith(planWith({ dir: PLAN_X }), 'make'),
      planChanged({ ...PROGRESS, counters: { reviewRounds: 2 } }),
      workflow,
      false,
    );

    const second = fold.fold(
      flowWith(first, 'make'),
      planChanged({ ...PROGRESS, counters: { reviewRounds: 3 } }),
      workflow,
      false,
    );

    expect(first?.snapshots).toEqual({ reviewRounds: 2 });
    expect(second?.snapshots).toEqual({ reviewRounds: 2 });
    expect(second?.progress?.counters).toEqual({ reviewRounds: 3 });
  });

  it('fold_SameProgress_KeepsThePlanByReference', () => {
    const flow = flowWith(planWith({ dir: PLAN_X, progress: PROGRESS }));

    const plan = createPlanFold().fold(
      flow,
      planChanged(structuredClone(PROGRESS)),
      planWorkflowFixture(),
      false,
    );

    expect(plan).toBe(flow.plan);
  });

  it('fold_WorkflowKeepingNoPlan_LeavesThePlan', () => {
    const workflow: DeclaredWorkflow = {
      id: 'checklist',
      pluginName: '',
      decl: CHECKLIST_WORKFLOW,
      planFormat: planWorkflowFixture().planFormat,
    };
    const flow = flowWith(null);

    expect(
      createPlanFold().fold(
        flow,
        { type: 'fileWritten', path: '/r/plan-a/plan.md' },
        workflow,
        false,
      ),
    ).toBeNull();
  });
});

describe('sameProgress', () => {
  it.each<{ name: string; incoming: PlanProgress; expected: boolean }>([
    { name: 'equal values', incoming: PROGRESS, expected: true },
    {
      name: 'an equal progress in another object',
      incoming: structuredClone(PROGRESS),
      expected: true,
    },
    {
      name: 'other counters',
      incoming: { ...PROGRESS, counters: { reviewRounds: 2 } },
      expected: false,
    },
    {
      name: 'an added counter',
      incoming: { ...PROGRESS, counters: { reviewRounds: 1, other: 0 } },
      expected: false,
    },
    {
      name: 'another title',
      incoming: { ...PROGRESS, title: 'B' },
      expected: false,
    },
    {
      name: 'another wave',
      incoming: { ...PROGRESS, wave: 1 },
      expected: false,
    },
    {
      name: 'another task group',
      incoming: withTask({ group: 1 }),
      expected: false,
    },
    {
      name: 'the verification task moved',
      incoming: withTask({ verification: true }),
      expected: false,
    },
  ])('sameProgress_ByValue ($name)', ({ incoming, expected }) => {
    expect(sameProgress(PROGRESS, incoming)).toBe(expected);
  });

  it('sameProgress_NoCurrent_IsFalse', () => {
    expect(sameProgress(null, PROGRESS)).toBe(false);
  });
});
