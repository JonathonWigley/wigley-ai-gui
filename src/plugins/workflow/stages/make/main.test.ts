import { describe, expect, it } from 'vitest';
import type { SessionFlow, WorkflowSignal } from '../../contract';
import { foldFlow, newFlow } from '../../flow';
import { BUILT_IN_MAIN_STAGES } from '../index';

function flowIn(stage: string): SessionFlow {
  return { ...newFlow('s1', '/r'), stage };
}

const MAKE_STARTED: WorkflowSignal = {
  type: 'skillStarted',
  skill: 'wigley:make',
  args: '',
  argsPath: null,
};

describe('makeMainStage', () => {
  it.each([
    { name: 'wigley:make from planReady', from: 'planReady', stage: 'make' },
    { name: 'wigley:make from idle', from: 'idle', stage: 'make' },
    { name: 'wigley:make from review', from: 'review', stage: 'make' },
    { name: 'wigley:make from fix', from: 'fix', stage: 'make' },
    { name: 'wigley:make from closed', from: 'closed', stage: 'make' },
  ])('$name', ({ from, stage }) => {
    expect(
      foldFlow(flowIn(from), MAKE_STARTED, BUILT_IN_MAIN_STAGES).stage,
    ).toBe(stage);
  });
});
