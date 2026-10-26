export interface ReducerStore<State, Action> {
  get(): State;
  // Applies the action; listeners run only when the state changed.
  dispatch(action: Action): void;
  // Listeners read `get()`, so a dispatch made inside one stays consistent.
  subscribe(listener: () => void): void;
}

export function createReducerStore<State, Action>(
  initial: State,
  apply: (state: State, action: Action) => State,
): ReducerStore<State, Action> {
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
