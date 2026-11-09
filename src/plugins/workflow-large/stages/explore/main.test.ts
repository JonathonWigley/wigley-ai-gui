import { describe, expect, it } from 'vitest';
import type { SessionFlow, WorkflowSignal } from '../../../workflow/contract';
import { foldFlow, newFlow } from '../../../workflow/flow';
import { LARGE_WORKFLOW_ID } from '../../contract';
import { largeMainWorkflow } from '../../large-workflow';

function flowIn(stage: string): SessionFlow {
  return { ...newFlow('s1', '/r'), workflow: LARGE_WORKFLOW_ID, stage };
}

function skillStarted(skill: string): WorkflowSignal {
  return { type: 'skillStarted', skill, args: '', argsPath: null };
}

describe('exploreMainStage', () => {
  it.each([
    {
      name: 'wigley:feature from idle',
      from: 'idle',
      skill: 'wigley:feature',
      stage: 'explore',
    },
    {
      name: 'wigley:feature from primer',
      from: 'primer',
      skill: 'wigley:feature',
      stage: 'explore',
    },
    {
      name: 'wigley:feature from closed',
      from: 'closed',
      skill: 'wigley:feature',
      stage: 'explore',
    },
    {
      name: 'wigley:featurex keeps the stage',
      from: 'primer',
      skill: 'wigley:featurex',
      stage: 'primer',
    },
  ])('$name', ({ from, skill, stage }) => {
    expect(
      foldFlow(flowIn(from), skillStarted(skill), [largeMainWorkflow]).stage,
    ).toBe(stage);
  });
});
