import { describe, expect, it } from 'vitest';
import type { SessionFlow, WorkflowSignal } from '../../../workflow/contract';
import { foldFlow, newFlow } from '../../../workflow/flow';
import { HEAVY_WORKFLOW_ID } from '../../contract';
import { heavyMainWorkflow } from '../../heavy-workflow';

function flowIn(stage: string): SessionFlow {
  return { ...newFlow('s1', '/r'), workflow: HEAVY_WORKFLOW_ID, stage };
}

const PRIMER_STARTED: WorkflowSignal = {
  type: 'skillStarted',
  skill: 'wigley:feature-primer',
  args: '',
  argsPath: null,
};

describe('primerMainStage', () => {
  it.each([
    {
      name: 'skillStarted wigley:feature-primer from idle',
      from: 'idle',
      stage: 'primer',
    },
    {
      name: 'skillStarted wigley:feature-primer from closed',
      from: 'closed',
      stage: 'primer',
    },
  ])('$name', ({ from, stage }) => {
    expect(
      foldFlow(flowIn(from), PRIMER_STARTED, [heavyMainWorkflow]).stage,
    ).toBe(stage);
  });
});
