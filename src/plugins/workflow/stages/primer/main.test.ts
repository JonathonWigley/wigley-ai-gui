import { describe, expect, it } from 'vitest';
import type { SessionFlow, WorkflowSignal } from '../../contract';
import { foldFlow, newFlow } from '../../flow';
import { BUILT_IN_MAIN_STAGES } from '../index';

function flowIn(stage: string): SessionFlow {
  return { ...newFlow('s1', '/r'), stage };
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
      foldFlow(flowIn(from), PRIMER_STARTED, BUILT_IN_MAIN_STAGES).stage,
    ).toBe(stage);
  });
});
