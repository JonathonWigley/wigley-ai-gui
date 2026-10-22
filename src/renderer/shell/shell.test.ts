import { describe, expect, it } from 'vitest';
import { comparePlacements, type Placement, placementOf } from './shell';

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
