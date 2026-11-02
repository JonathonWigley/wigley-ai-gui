import { describe, expect, it } from 'vitest';
import type { SessionFlow, WorkflowSignal } from '../../contract';
import { foldFlow, newFlow } from '../../flow';
import type { PlanProgress } from '../../plan-reader';
import { BUILT_IN_MAIN_STAGES } from '../index';

function flowIn(stage: string): SessionFlow {
  return { ...newFlow('s1', '/r'), stage, planDir: '/r/plan-f' };
}

function planChanged(reviewRounds: number): WorkflowSignal {
  const progress: PlanProgress = {
    checked: 5,
    total: 7,
    wave: 3,
    reviewRounds,
    title: 'F',
    tasks: [],
  };
  return { type: 'planChanged', progress };
}

const REVIEW_STARTED: WorkflowSignal = {
  type: 'skillStarted',
  skill: 'wigley:review',
  args: '',
  argsPath: null,
};

describe('reviewMainStage', () => {
  it.each<{
    name: string;
    from: string;
    signal: WorkflowSignal;
    stage: string;
  }>([
    {
      name: 'wigley:review in make',
      from: 'make',
      signal: REVIEW_STARTED,
      stage: 'review',
    },
    {
      name: 'wigley:review in feature',
      from: 'feature',
      signal: REVIEW_STARTED,
      stage: 'feature',
    },
    {
      name: 'planChanged with a review round in make',
      from: 'make',
      signal: planChanged(1),
      stage: 'review',
    },
    {
      name: 'planChanged with no review round in make',
      from: 'make',
      signal: planChanged(0),
      stage: 'make',
    },
  ])('$name', ({ from, signal, stage }) => {
    expect(foldFlow(flowIn(from), signal, BUILT_IN_MAIN_STAGES).stage).toBe(
      stage,
    );
  });
});
