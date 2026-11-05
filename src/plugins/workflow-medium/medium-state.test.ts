import { describe, expect, it } from 'vitest';
import type { SessionFlow, WorkflowSignal } from '../workflow/contract';
import { foldFlow, newFlow } from '../workflow/flow';
import { MEDIUM_WORKFLOW_ID } from './contract';
import {
  foldMediumState,
  mediumFixCycles,
  mediumStateOf,
} from './medium-state';
import { mediumMainWorkflow } from './stages';

function flowIn(stage: string, state: unknown = null): SessionFlow {
  return {
    ...newFlow('s1', '/r'),
    workflow: MEDIUM_WORKFLOW_ID,
    stage,
    state,
  };
}

function step(name: string): WorkflowSignal {
  return { type: 'stepReported', step: name };
}

const foldAll = (flow: SessionFlow, signals: readonly WorkflowSignal[]) =>
  signals.reduce(
    (current, signal) => foldFlow(current, signal, [mediumMainWorkflow]),
    flow,
  );

describe('Medium state', () => {
  it('fixCycles_CountsEachEntryToFix', () => {
    const flow = foldAll(
      flowIn('build'),
      ['fix', 'review', 'fix', 'done'].map(step),
    );

    expect(mediumMainWorkflow.fixCycles?.(flow)).toBe(2);
  });

  it('mediumMainWorkflow_Values', () => {
    expect(mediumMainWorkflow.foldState).toBe(foldMediumState);
    expect(mediumMainWorkflow.fixCycles).toBe(mediumFixCycles);
  });

  it.each([
    {
      name: 'review then fix',
      start: flowIn('review'),
      steps: ['fix'],
      cycles: 1,
    },
    {
      name: 'fix, review, fix',
      start: flowIn('fix', { fixCycles: 1 }),
      steps: ['review', 'fix'],
      cycles: 2,
    },
    {
      name: 'fix then fix',
      start: flowIn('fix', { fixCycles: 1 }),
      steps: ['fix'],
      cycles: 1,
    },
  ])('foldMediumState: $name', ({ start, steps, cycles }) => {
    expect(mediumFixCycles(foldAll(start, steps.map(step)))).toBe(cycles);
  });

  it('foldMediumState_OtherStep_KeepsTheStateByReference', () => {
    const state = { fixCycles: 1 };

    const after = foldFlow(flowIn('interview', state), step('build'), [
      mediumMainWorkflow,
    ]);

    expect(after.stage).toBe('build');
    expect(after.state).toBe(state);
  });

  it('foldMediumState_SecondMediumAsk_CountsFromZero', () => {
    const after = foldFlow(
      flowIn('done', { fixCycles: 2 }),
      {
        type: 'skillStarted',
        skill: 'wigley:medium',
        args: '',
        argsPath: null,
      },
      [mediumMainWorkflow],
    );

    expect(after.state).toBeNull();
    expect(mediumFixCycles(after)).toBe(0);
  });

  it('mediumStateOf_WrongShape_ReadsAsZero', () => {
    expect(mediumStateOf(flowIn('fix', { fixCycles: 'x' }))).toEqual({
      fixCycles: 0,
    });
  });
});
