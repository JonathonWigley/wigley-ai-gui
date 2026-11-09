import { describe, expect, it } from 'vitest';
import type { SessionFlow, WorkflowSignal } from '../../../workflow/contract';
import { foldFlow, newFlow } from '../../../workflow/flow';
import { LARGE_WORKFLOW_ID, largeSignal } from '../../contract';
import { largeMainWorkflow } from '../../large-workflow';

function flowIn(stage: string): SessionFlow {
  return { ...newFlow('s1', '/r'), workflow: LARGE_WORKFLOW_ID, stage };
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
      signal: largeSignal({ type: 'handedOff' }),
      stage: 'idle',
    },
    {
      name: 'handedOff from planReady',
      from: 'planReady',
      signal: largeSignal({ type: 'handedOff' }),
      stage: 'idle',
    },
    {
      name: 'dismissed from closed',
      from: 'closed',
      signal: largeSignal({ type: 'dismissed' }),
      stage: 'idle',
    },
    {
      name: 'dismissed from make',
      from: 'make',
      signal: largeSignal({ type: 'dismissed' }),
      stage: 'make',
    },
  ])('$name', ({ from, signal, stage }) => {
    expect(foldFlow(flowIn(from), signal, [largeMainWorkflow]).stage).toBe(
      stage,
    );
  });
});
