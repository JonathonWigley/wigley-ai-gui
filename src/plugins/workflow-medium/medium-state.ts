import {
  reportsStep,
  type SessionFlow,
  startsSkill,
  type WorkflowSignal,
} from '../workflow/contract';
import type { MediumState } from './contract';

function isMediumState(state: unknown): state is MediumState {
  return (
    typeof state === 'object' &&
    state !== null &&
    'fixCycles' in state &&
    typeof state.fixCycles === 'number'
  );
}

// The flow's state when it has Medium's shape, else a count of 0: the store does not
// check `state`.
export function mediumStateOf(flow: SessionFlow): MediumState {
  return isMediumState(flow.state) ? flow.state : { fixCycles: 0 };
}

// A second Medium ask counts from 0; entering `fix` from another stage counts one
// cycle. The fold runs this ahead of the stage rules, so `flow.stage` is the stage
// being left.
export function foldMediumState(
  flow: SessionFlow,
  signal: WorkflowSignal,
): unknown {
  if (startsSkill(signal, 'wigley:medium')) {
    return null;
  }
  const entersFix = reportsStep(signal, 'fix') && flow.stage !== 'fix';
  return entersFix
    ? { fixCycles: mediumStateOf(flow).fixCycles + 1 }
    : flow.state;
}

export function mediumFixCycles(flow: SessionFlow): number {
  return mediumStateOf(flow).fixCycles;
}
