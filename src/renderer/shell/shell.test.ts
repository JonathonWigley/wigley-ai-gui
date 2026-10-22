import { describe, expect, it } from 'vitest';
import {
  comparePlacements,
  insertionIndex,
  type Placement,
  placementOf,
} from './shell';

function sequencesSorted(placements: Placement[]): number[] {
  return [...placements]
    .sort(comparePlacements)
    .map((placement) => placement.sequence);
}

describe('placements', () => {
  it('placementOf fills align start and order 0', () => {
    expect(placementOf(undefined, 3)).toEqual({
      align: 'start',
      order: 0,
      sequence: 3,
    });
    expect(placementOf({ align: 'end' }, 1)).toEqual({
      align: 'end',
      order: 0,
      sequence: 1,
    });
  });

  it('comparePlacements puts start before center before end, whatever their order', () => {
    expect(
      sequencesSorted([
        { align: 'end', order: -5, sequence: 0 },
        { align: 'center', order: 0, sequence: 1 },
        { align: 'start', order: 9, sequence: 2 },
      ]),
    ).toEqual([2, 1, 0]);
  });

  it('comparePlacements orders one group by order, then by sequence', () => {
    expect(
      sequencesSorted([
        { align: 'start', order: 2, sequence: 0 },
        { align: 'start', order: -1, sequence: 1 },
        { align: 'start', order: 0, sequence: 2 },
        { align: 'start', order: 0, sequence: 3 },
      ]),
    ).toEqual([1, 2, 3, 0]);
  });
});

describe('insertionIndex', () => {
  const sorted = [
    { placement: { align: 'start', order: 0, sequence: 0 } },
    { placement: { align: 'start', order: 5, sequence: 1 } },
    { placement: { align: 'end', order: 0, sequence: 2 } },
  ] satisfies { placement: Placement }[];

  it('puts a placement before the first entry that sorts after it', () => {
    expect(
      insertionIndex(sorted, { align: 'start', order: 1, sequence: 3 }),
    ).toBe(1);
    expect(
      insertionIndex(sorted, { align: 'center', order: 9, sequence: 3 }),
    ).toBe(2);
  });

  it('puts a placement after equal ones made before it', () => {
    expect(
      insertionIndex(sorted, { align: 'start', order: 5, sequence: 3 }),
    ).toBe(2);
  });

  it('puts a placement nothing sorts after at the end', () => {
    expect(
      insertionIndex(sorted, { align: 'end', order: 0, sequence: 3 }),
    ).toBe(3);
    expect(insertionIndex([], { align: 'start', order: 0, sequence: 0 })).toBe(
      0,
    );
  });
});
