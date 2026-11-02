import { describe, expect, it } from 'vitest';
import type { SessionFlow, WorkflowSignal } from '../../contract';
import { foldFlow, newFlow } from '../../flow';
import { BUILT_IN_MAIN_STAGES } from '../index';

function flowIn(stage: string): SessionFlow {
  return { ...newFlow('s1', '/r'), stage, planDir: '/r/plan-f' };
}

const PLAN_GONE: WorkflowSignal = { type: 'planGone' };

describe('closedMainStage', () => {
  it.each([
    { name: 'planGone in make', from: 'make', stage: 'closed' },
    { name: 'planGone in review', from: 'review', stage: 'closed' },
    { name: 'planGone in feature', from: 'feature', stage: 'feature' },
    { name: 'planGone in planReady', from: 'planReady', stage: 'planReady' },
  ])('$name', ({ from, stage }) => {
    expect(foldFlow(flowIn(from), PLAN_GONE, BUILT_IN_MAIN_STAGES).stage).toBe(
      stage,
    );
  });
});
