import { describe, expect, it } from 'vitest';
import type { SessionFlow, WorkflowSignal } from '../../../workflow/contract';
import { foldFlow, newFlow } from '../../../workflow/flow';
import type { PlanProgress } from '../../../../shared/plan-progress';
import { LARGE_WORKFLOW_ID, largeSignal, withLargeState } from '../../contract';
import { largeMainWorkflow } from '../../large-workflow';
import { closedMainStage } from './main';

const PROGRESS: PlanProgress = {
  checked: 2,
  total: 5,
  wave: 1,
  reviewRounds: 0,
  title: 'F',
  tasks: [],
};

// A flow in `stage` whose plan folder was read, closed from review, with
// `running` subagents.
function flowIn(stage: string, running: readonly string[] = []): SessionFlow {
  return withLargeState(
    {
      ...newFlow('s1', '/r'),
      workflow: LARGE_WORKFLOW_ID,
      stage,
      runningSubagents: running,
    },
    { planDir: '/r/plan-f', progress: PROGRESS, closedFrom: 'review' },
  );
}

const PLAN_GONE = largeSignal({ type: 'planGone' });
const PLAN_CHANGED = largeSignal({ type: 'planChanged', progress: PROGRESS });
const MAKE_OF_A_NEW_FOLDER: WorkflowSignal = {
  type: 'skillStarted',
  skill: 'wigley:make',
  args: 'plan-g',
  argsPath: '/r/plan-g',
};

function foldAll(
  flow: SessionFlow,
  signals: readonly WorkflowSignal[],
): SessionFlow {
  return signals.reduce(
    (current, signal) => foldFlow(current, signal, [largeMainWorkflow]),
    flow,
  );
}

describe('closedMainStage', () => {
  it('finishes the run', () => {
    expect(closedMainStage.finishes).toBe(true);
  });

  it.each<{
    name: string;
    from: string;
    running?: readonly string[];
    signals: readonly WorkflowSignal[];
    stage: string;
  }>([
    {
      name: 'the plan read while closed and a subagent runs reopens it',
      from: 'closed',
      running: ['a1'],
      signals: [PLAN_CHANGED],
      stage: 'review',
    },
    {
      name: 'the plan read while closed and nothing runs keeps it closed',
      from: 'closed',
      signals: [PLAN_CHANGED],
      stage: 'closed',
    },
    {
      name: 'the plan read while closed during a turn reopens it',
      from: 'closed',
      signals: [{ type: 'turnStarted' }, PLAN_CHANGED],
      stage: 'review',
    },
    {
      name: 'planGone in make',
      from: 'make',
      signals: [PLAN_GONE],
      stage: 'closed',
    },
    {
      name: 'planGone in review',
      from: 'review',
      signals: [PLAN_GONE],
      stage: 'closed',
    },
    {
      name: 'planGone in fix',
      from: 'fix',
      signals: [PLAN_GONE],
      stage: 'closed',
    },
    {
      name: 'planGone in explore',
      from: 'explore',
      signals: [PLAN_GONE],
      stage: 'explore',
    },
    {
      name: 'planGone in planReady',
      from: 'planReady',
      signals: [PLAN_GONE],
      stage: 'planReady',
    },
    {
      name: 'make of a folder not written yet waits for it',
      from: 'idle',
      signals: [MAKE_OF_A_NEW_FOLDER, PLAN_GONE],
      stage: 'make',
    },
    {
      name: 'make of a folder written after it starts closes once it goes',
      from: 'idle',
      signals: [MAKE_OF_A_NEW_FOLDER, PLAN_GONE, PLAN_CHANGED, PLAN_GONE],
      stage: 'closed',
    },
  ])('$name', ({ from, running, signals, stage }) => {
    expect(foldAll(flowIn(from, running), signals).stage).toBe(stage);
  });
});
