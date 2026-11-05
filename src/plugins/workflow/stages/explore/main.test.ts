import { describe, expect, it } from 'vitest';
import type { SessionFlow, WorkflowSignal } from '../../contract';
import { foldFlow, newFlow } from '../../flow';
import { BUILT_IN_MAIN_STAGES } from '../index';

function flowIn(stage: string): SessionFlow {
  return { ...newFlow('s1', '/r'), stage };
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
      foldFlow(flowIn(from), skillStarted(skill), BUILT_IN_MAIN_STAGES).stage,
    ).toBe(stage);
  });
});
