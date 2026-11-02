import { describe, expect, it, vi } from 'vitest';
import type { SessionPart } from '../contract';
import { createSessionPartStore } from './session-part-store';

function part(id: string): SessionPart {
  return { id, build: () => ({}) };
}

describe('createSessionPartStore', () => {
  it('add_TakenId_Throws', () => {
    const store = createSessionPartStore();
    store.add(part('p1'));

    expect(() => store.add(part('p1'))).toThrow('p1');
  });

  it('add_Dispose_RemovesPartAndNotifiesOnce', () => {
    const store = createSessionPartStore();
    const added = store.add(part('p1'));
    const listener = vi.fn();
    store.onChanged(listener);

    added.dispose();

    expect(store.parts()).toEqual([]);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('add_DisposeTwice_SecondDoesNothing', () => {
    const store = createSessionPartStore();
    const added = store.add(part('p1'));
    store.add(part('p2'));
    const listener = vi.fn();
    store.onChanged(listener);

    added.dispose();
    added.dispose();

    expect(store.parts().map((each) => each.id)).toEqual(['p2']);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
