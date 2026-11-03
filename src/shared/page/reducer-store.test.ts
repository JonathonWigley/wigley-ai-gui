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

  it.each([
    {
      when: 'before the dispatch',
      disposedBy: 'test',
      disposedCalls: 0,
    },
    {
      when: 'by an earlier listener in the same dispatch',
      disposedBy: 'other',
      disposedCalls: 0,
    },
    {
      when: 'by itself in the same dispatch',
      disposedBy: 'itself',
      disposedCalls: 1,
    },
  ])(
    'stops telling a listener whose subscription was disposed $when',
    ({ disposedBy, disposedCalls }) => {
      const store = createReducerStore(0, apply);
      let disposed = 0;
      let other = 0;
      const subscriptions: { dispose(): void }[] = [];
      if (disposedBy === 'other') {
        store.subscribe(() => {
          other++;
          subscriptions[0].dispose();
        });
        subscriptions.push(store.subscribe(() => disposed++));
      } else {
        subscriptions.push(
          store.subscribe(() => {
            disposed++;
            subscriptions[0].dispose();
          }),
        );
        store.subscribe(() => other++);
      }
      if (disposedBy === 'test') {
        subscriptions[0].dispose();
      }

      store.dispatch(1);

      expect(disposed).toBe(disposedCalls);
      expect(other).toBe(1);
      expect(() => subscriptions[0].dispose()).not.toThrow();

      store.dispatch(1);

      expect(disposed).toBe(disposedCalls);
      expect(other).toBe(2);
    },
  );

  it('disposes only its own subscription when one function is subscribed twice', () => {
    const store = createReducerStore(0, apply);
    let calls = 0;
    const listener = () => {
      calls++;
    };
    const first = store.subscribe(listener);
    store.subscribe(listener);

    first.dispose();
    first.dispose();
    store.dispatch(1);

    expect(calls).toBe(1);
  });

  it('runs a listener subscribed after a nested dispatch in the outer dispatch', () => {
    const store = createReducerStore(0, apply);
    let late = 0;
    store.subscribe(() => {
      if (store.get() === 1) {
        store.dispatch(10);
        store.subscribe(() => late++);
      }
    });

    store.dispatch(1);

    expect(late).toBe(1);
  });
});
