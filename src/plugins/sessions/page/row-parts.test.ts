import { describe, expect, it, vi } from 'vitest';
import type { SessionRowPart } from '../contract';
import { createSessionRowParts } from './row-parts';

function part(id: string): SessionRowPart {
  return { id, build: () => ({}) };
}

describe('createSessionRowParts', () => {
  it('add_TakenId_Throws', () => {
    const rowParts = createSessionRowParts();
    rowParts.add(part('p1'));

    expect(() => rowParts.add(part('p1'))).toThrow('p1');
  });

  it('add_Dispose_RemovesPartAndNotifiesOnce', () => {
    const rowParts = createSessionRowParts();
    const added = rowParts.add(part('p1'));
    const listener = vi.fn();
    rowParts.onChanged(listener);

    added.dispose();

    expect(rowParts.parts()).toEqual([]);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('add_DisposeTwice_SecondDoesNothing', () => {
    const rowParts = createSessionRowParts();
    const added = rowParts.add(part('p1'));
    rowParts.add(part('p2'));
    const listener = vi.fn();
    rowParts.onChanged(listener);

    added.dispose();
    added.dispose();

    expect(rowParts.parts().map((each) => each.id)).toEqual(['p2']);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
