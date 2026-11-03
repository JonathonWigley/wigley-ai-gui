import type { Disposable } from '../../contracts/disposable';

export interface ReducerStore<State, Action> {
  get(): State;
  // Applies the action; listeners run only when the state changed.
  dispatch(action: Action): void;
  // Listeners read `get()`, so a dispatch made inside one stays consistent.
  // The `Disposable` removes this one subscription, and a listener it removes
  // during a dispatch does not run later in that dispatch.
  subscribe(listener: () => void): Disposable;
}

interface Subscription {
  listener: () => void;
  isActive: boolean;
}

export function createReducerStore<State, Action>(
  initial: State,
  apply: (state: State, action: Action) => State,
): ReducerStore<State, Action> {
  let state = initial;
  let subscriptions: Subscription[] = [];
  // Dispatches running now: one made inside a listener is a second.
  let runningDispatches = 0;
  return {
    get: () => state,
    dispatch(action) {
      const next = apply(state, action);
      if (next === state) {
        return;
      }
      state = next;
      runningDispatches += 1;
      try {
        for (const subscription of subscriptions) {
          if (subscription.isActive) {
            subscription.listener();
          }
        }
      } finally {
        runningDispatches -= 1;
      }
      // An outer dispatch is still walking this array, so only the last to end
      // may replace it.
      if (runningDispatches === 0) {
        subscriptions = subscriptions.filter(
          (subscription) => subscription.isActive,
        );
      }
    },
    subscribe(listener) {
      const subscription: Subscription = { listener, isActive: true };
      subscriptions.push(subscription);
      return {
        dispose() {
          subscription.isActive = false;
        },
      };
    },
  };
}
