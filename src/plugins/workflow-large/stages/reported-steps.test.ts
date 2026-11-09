import { describe, expect, it } from 'vitest';
import type { SessionFlow, WorkflowSignal } from '../../workflow/contract';
import { foldFlow, newFlow } from '../../workflow/flow';
import type { PlanProgress } from '../../../shared/plan-progress';
import { LARGE_WORKFLOW_ID, largeStateOf, withLargeState } from '../contract';
import { largeMainWorkflow } from '../large-workflow';

const PROGRESS: PlanProgress = {
  checked: 2,
  total: 5,
  wave: 1,
  reviewRounds: 1,
  title: 'F',
  tasks: [],
};

// A flow in `stage` with a plan read and nothing running.
function flowIn(stage: string): SessionFlow {
  return withLargeState(
    { ...newFlow('s1', '/r'), workflow: LARGE_WORKFLOW_ID, stage },
    { planDir: '/r/plan-f', progress: PROGRESS },
  );
}

function reported(step: string): WorkflowSignal {
  return { type: 'stepReported', step };
}

describe('a reported step', () => {
  it.each([
    { from: 'explore', step: 'interview', stage: 'interview' },
    { from: 'interview', step: 'plan', stage: 'plan' },
    { from: 'plan', step: 'coldRead', stage: 'coldRead' },
    { from: 'coldRead', step: 'plan', stage: 'plan' },
    { from: 'plan', step: 'interview', stage: 'interview' },
    { from: 'interview', step: 'explore', stage: 'explore' },
    { from: 'planReady', step: 'plan', stage: 'plan' },
    { from: 'make', step: 'fix', stage: 'fix' },
    { from: 'review', step: 'fix', stage: 'fix' },
    { from: 'idle', step: 'interview', stage: 'idle' },
    { from: 'idle', step: 'explore', stage: 'idle' },
    { from: 'idle', step: 'fix', stage: 'idle' },
    { from: 'primer', step: 'plan', stage: 'primer' },
    { from: 'make', step: 'plan', stage: 'make' },
    { from: 'review', step: 'coldRead', stage: 'review' },
    { from: 'fix', step: 'interview', stage: 'fix' },
    { from: 'closed', step: 'explore', stage: 'closed' },
    { from: 'closed', step: 'fix', stage: 'closed' },
    { from: 'explore', step: 'fix', stage: 'explore' },
    { from: 'planReady', step: 'fix', stage: 'planReady' },
  ])('$step from $from leaves the flow in $stage', ({ from, step, stage }) => {
    const folded = foldFlow(flowIn(from), reported(step), [largeMainWorkflow]);

    expect(folded.stage).toBe(stage);
  });

  it.each(['explore', 'interview'])(
    'back to %s from plan keeps the plan',
    (step) => {
      const folded = foldFlow(flowIn('plan'), reported(step), [
        largeMainWorkflow,
      ]);

      expect(largeStateOf(folded)).toMatchObject({
        planDir: '/r/plan-f',
        progress: PROGRESS,
      });
    },
  );
});
