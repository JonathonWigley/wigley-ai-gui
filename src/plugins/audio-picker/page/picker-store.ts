import {
  createReducerStore,
  type ReducerStore,
} from '../../../shared/page/reducer-store';
import { apply, type PickerAction, type PickerState } from './picker-state';

// The audio picker page's store, over `apply`.
export type PickerStore = ReducerStore<PickerState, PickerAction>;

export function createPickerStore(initial: PickerState): PickerStore {
  return createReducerStore(initial, apply);
}
