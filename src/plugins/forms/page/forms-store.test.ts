import { describe, expect, it } from 'vitest';
import { initialState } from './form-state';
import { createFormsStore } from './forms-store';
import { presentedRound } from './test-rounds';

describe('createFormsStore', () => {
  it('holds the state an action produced and tells its listeners', () => {
    const store = createFormsStore(
      initialState([presentedRound('r1')], 'r1-session'),
    );
    let calls = 0;
    store.subscribe(() => calls++);

    store.dispatch({ type: 'nextItem' });

    expect(store.get().rounds[0].focus).toBe(1);
    expect(calls).toBe(1);
  });

  it('tells no one about an action that changes nothing', () => {
    const store = createFormsStore(initialState([], null));
    let calls = 0;
    store.subscribe(() => calls++);

    store.dispatch({ type: 'nextItem' });

    expect(calls).toBe(0);
  });

  it('lets a listener dispatch and every listener read the newest state', () => {
    const store = createFormsStore(
      initialState([presentedRound('r1')], 'r1-session'),
    );
    const seen: number[] = [];
    store.subscribe(() => {
      if (store.get().rounds[0].focus === 1) {
        store.dispatch({ type: 'prevItem' });
      }
    });
    store.subscribe(() => seen.push(store.get().rounds[0].focus));

    store.dispatch({ type: 'nextItem' });

    expect(store.get().rounds[0].focus).toBe(0);
    expect(seen.at(-1)).toBe(0);
  });
});
