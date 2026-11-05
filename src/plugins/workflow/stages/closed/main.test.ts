import { describe, expect, it } from 'vitest';
import type { SessionFlow, WorkflowSignal } from '../../contract';
import { foldFlow, newFlow } from '../../flow';
import type { PlanProgress } from '../../plan-reader';
import {
  HEAVY_WORKFLOW_ID,
  heavySignal,
  withHeavyState,
} from '../heavy-contract';
import { heavyMainWorkflow } from '../heavy-workflow';
import { closedMainStage } from './main';

const PROGRESS: PlanProgress = {
  checked: 2,
  total: 5,
  wave: 1,
  reviewRounds: 0,
  title: 'F',
  tasks: [],
};

// A flow in `stage` whose plan folder was read.
function flowIn(stage: string): SessionFlow {
  return withHeavyState(
    { ...newFlow('s1', '/r'), workflow: HEAVY_WORKFLOW_ID, stage },
    { planDir: '/r/plan-f', progress: PROGRESS },
  );
}

const PLAN_GONE = heavySignal({ type: 'planGone' });
const PLAN_CHANGED = heavySignal({ type: 'planChanged', progress: PROGRESS });
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
    (current, signal) => foldFlow(current, signal, [heavyMainWorkflow]),
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
    signals: readonly WorkflowSignal[];
    stage: string;
  }>([
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
  ])('$name', ({ from, signals, stage }) => {
    expect(foldAll(flowIn(from), signals).stage).toBe(stage);
  });
});
