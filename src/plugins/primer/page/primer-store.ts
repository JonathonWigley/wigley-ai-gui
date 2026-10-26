import {
  createReducerStore,
  type ReducerStore,
} from '../../../shared/page/reducer-store';
import { apply, type PrimerAction, type PrimerState } from './primer-state';

// The primer page's store, over `apply`.
export type PrimerStore = ReducerStore<PrimerState, PrimerAction>;

export function createPrimerStore(initial: PrimerState): PrimerStore {
  return createReducerStore(initial, apply);
}
