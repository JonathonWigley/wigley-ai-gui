import { describe, expect, it } from 'vitest';
import type { SessionFlow, WorkflowSignal } from '../../../workflow/contract';
import { foldFlow, newFlow } from '../../../workflow/flow';
import { HEAVY_WORKFLOW_ID, heavySignal } from '../../contract';
import { heavyMainWorkflow } from '../../heavy-workflow';

function flowIn(stage: string): SessionFlow {
  return { ...newFlow('s1', '/r'), workflow: HEAVY_WORKFLOW_ID, stage };
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
      signal: heavySignal({ type: 'handedOff' }),
      stage: 'idle',
    },
    {
      name: 'handedOff from planReady',
      from: 'planReady',
      signal: heavySignal({ type: 'handedOff' }),
      stage: 'idle',
    },
    {
      name: 'dismissed from closed',
      from: 'closed',
      signal: heavySignal({ type: 'dismissed' }),
      stage: 'idle',
    },
    {
      name: 'dismissed from make',
      from: 'make',
      signal: heavySignal({ type: 'dismissed' }),
      stage: 'make',
    },
  ])('$name', ({ from, signal, stage }) => {
    expect(foldFlow(flowIn(from), signal, [heavyMainWorkflow]).stage).toBe(
      stage,
    );
  });
});
