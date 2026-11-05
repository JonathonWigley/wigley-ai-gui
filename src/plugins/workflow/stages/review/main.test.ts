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

function flowIn(stage: string): SessionFlow {
  return withHeavyState(
    { ...newFlow('s1', '/r'), workflow: HEAVY_WORKFLOW_ID, stage },
    { planDir: '/r/plan-f' },
  );
}

function planChanged(reviewRounds: number, checked = 5): WorkflowSignal {
  const progress: PlanProgress = {
    checked,
    total: 7,
    wave: 3,
    reviewRounds,
    title: 'F',
    tasks: [],
  };
  return heavySignal({ type: 'planChanged', progress });
}

const REVIEW_STARTED: WorkflowSignal = {
  type: 'skillStarted',
  skill: 'wigley:review',
  args: '',
  argsPath: null,
};

function makeStarted(argsPath: string | null): WorkflowSignal {
  return {
    type: 'skillStarted',
    skill: 'wigley:make',
    args: argsPath ?? '',
    argsPath,
  };
}

// The stage after each signal in turn.
function stagesAfter(
  flow: SessionFlow,
  signals: readonly WorkflowSignal[],
): string[] {
  const stages: string[] = [];
  let current = flow;
  for (const signal of signals) {
    current = foldFlow(current, signal, [heavyMainWorkflow]);
    stages.push(current.stage);
  }
  return stages;
}

describe('reviewMainStage', () => {
  it.each<{
    name: string;
    from: string;
    signals: readonly WorkflowSignal[];
    stages: readonly string[];
  }>([
    {
      name: 'wigley:review in make',
      from: 'make',
      signals: [REVIEW_STARTED],
      stages: ['review'],
    },
    {
      name: 'wigley:review in fix',
      from: 'fix',
      signals: [REVIEW_STARTED],
      stages: ['review'],
    },
    {
      name: 'wigley:review in explore',
      from: 'explore',
      signals: [REVIEW_STARTED],
      stages: ['explore'],
    },
    {
      name: 'a round logged in fix stays in fix',
      from: 'fix',
      signals: [planChanged(1), planChanged(2)],
      stages: ['fix', 'fix'],
    },
    {
      name: 'planChanged with no review round in make',
      from: 'make',
      signals: [planChanged(0)],
      stages: ['make'],
    },
    {
      name: 'Resume make from review waits for a round logged after it',
      from: 'planReady',
      signals: [
        planChanged(0),
        makeStarted(null),
        planChanged(1),
        makeStarted(null),
        planChanged(1, 6),
        planChanged(2, 6),
      ],
      stages: ['planReady', 'make', 'review', 'make', 'make', 'review'],
    },
    {
      name: 'make of an unread plan counts its rounds from the first read',
      from: 'idle',
      signals: [
        makeStarted('/r/plan-g'),
        planChanged(2),
        planChanged(2, 6),
        planChanged(3, 6),
      ],
      stages: ['make', 'make', 'make', 'review'],
    },
  ])('$name', ({ from, signals, stages }) => {
    expect(stagesAfter(flowIn(from), signals)).toEqual(stages);
  });
});
