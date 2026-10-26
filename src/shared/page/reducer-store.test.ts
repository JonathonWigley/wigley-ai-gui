import { describe, expect, it } from 'vitest';
import { createReducerStore } from './reducer-store';

// A step of 0 changes nothing.
const apply = (count: number, step: number) => count + step;

describe('createReducerStore', () => {
  it('holds the state an action produced and tells its listeners', () => {
    const store = createReducerStore(0, apply);
    let calls = 0;
    store.subscribe(() => calls++);

    store.dispatch(1);

    expect(store.get()).toBe(1);
    expect(calls).toBe(1);
  });

  it('tells no one about an action that changes nothing', () => {
    const store = createReducerStore(0, apply);
    let calls = 0;
    store.subscribe(() => calls++);

    store.dispatch(0);

    expect(calls).toBe(0);
  });

  it('lets a listener dispatch and every listener read the newest state', () => {
    const store = createReducerStore(0, apply);
    const seen: number[] = [];
    store.subscribe(() => {
      if (store.get() === 1) {
        store.dispatch(-1);
      }
    });
    store.subscribe(() => seen.push(store.get()));

    store.dispatch(1);

    expect(store.get()).toBe(0);
    expect(seen.at(-1)).toBe(0);
  });
});
