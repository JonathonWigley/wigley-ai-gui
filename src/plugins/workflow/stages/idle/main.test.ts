import { describe, expect, it } from 'vitest';
import type { SessionFlow, WorkflowSignal } from '../../contract';
import { foldFlow, newFlow } from '../../flow';
import { BUILT_IN_MAIN_STAGES } from '../index';

function flowIn(stage: string): SessionFlow {
  return { ...newFlow('s1', '/r'), stage, hasLeftIdle: true };
}

describe('idleMainStage', () => {
  it.each<{
    name: string;
    from: string;
    signal: WorkflowSignal;
    stage: string;
  }>([
    {
      name: 'handedOff from make',
      from: 'make',
      signal: { type: 'handedOff' },
      stage: 'idle',
    },
    {
      name: 'handedOff from planReady',
      from: 'planReady',
      signal: { type: 'handedOff' },
      stage: 'idle',
    },
    {
      name: 'dismissed from closed',
      from: 'closed',
      signal: { type: 'dismissed' },
      stage: 'idle',
    },
    {
      name: 'dismissed from make',
      from: 'make',
      signal: { type: 'dismissed' },
      stage: 'make',
    },
  ])('$name', ({ from, signal, stage }) => {
    expect(foldFlow(flowIn(from), signal, BUILT_IN_MAIN_STAGES).stage).toBe(
      stage,
    );
  });
});
