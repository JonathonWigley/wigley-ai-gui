import { apply, type FormsAction, type FormsState } from './form-state';

export interface FormsStore {
  get(): FormsState;
  // Applies the action; listeners run only when the state changed.
  dispatch(action: FormsAction): void;
  // Listeners read `get()`, so a dispatch made inside one stays consistent.
  subscribe(listener: () => void): void;
}

export function createFormsStore(initial: FormsState): FormsStore {
  let state = initial;
  const listeners: (() => void)[] = [];
  return {
    get: () => state,
    dispatch(action) {
      const next = apply(state, action);
      if (next === state) {
        return;
      }
      state = next;
      for (const listener of listeners) {
        listener();
      }
    },
    subscribe(listener) {
      listeners.push(listener);
    },
  };
}
