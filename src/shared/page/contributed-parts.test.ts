import { describe, expect, it, vi } from 'vitest';
import { type ContributedPart, createPartStore } from './contributed-parts';

function part(id: string): ContributedPart {
  return { id, build: () => ({}) };
}

describe('createPartStore', () => {
  it('add_TakenId_Throws', () => {
    const store = createPartStore();
    store.add(part('p1'));

    expect(() => store.add(part('p1'))).toThrow('p1');
  });

  it('add_Dispose_RemovesPartAndNotifiesOnce', () => {
    const store = createPartStore();
    const added = store.add(part('p1'));
    const listener = vi.fn();
    store.onChanged(listener);

    added.dispose();

    expect(store.parts()).toEqual([]);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('add_DisposeTwice_SecondDoesNothing', () => {
    const store = createPartStore();
    const added = store.add(part('p1'));
    store.add(part('p2'));
    const listener = vi.fn();
    store.onChanged(listener);

    added.dispose();
    added.dispose();

    expect(store.parts().map((each) => each.id)).toEqual(['p2']);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it.each<{ name: string; added: [string, number][]; ids: string[] }>([
    {
      name: 'a lower order added later goes first',
      added: [
        ['strip', 20],
        ['line', 30],
        ['offer', 10],
      ],
      ids: ['offer', 'strip', 'line'],
    },
    {
      name: 'equal orders keep add order',
      added: [
        ['b', 5],
        ['a', 5],
        ['c', 1],
      ],
      ids: ['c', 'b', 'a'],
    },
  ])('add_WithCompare_$name', ({ added, ids }) => {
    const store = createPartStore<ContributedPart & { order: number }>(
      (a, b) => a.order - b.order,
    );
    for (const [id, order] of added) {
      store.add({ ...part(id), order });
    }

    expect(store.parts().map((each) => each.id)).toEqual(ids);
  });
});
