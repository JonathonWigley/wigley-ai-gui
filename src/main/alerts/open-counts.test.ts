import { describe, expect, it } from 'vitest';
import { createOpenCounts } from './open-counts';

describe('createOpenCounts', () => {
  it('sums the latest count of every source', () => {
    const counts = createOpenCounts();

    expect(counts.set('forms', 2)).toBe(2);
    expect(counts.set('primer', 1)).toBe(3);
  });

  it("replaces a source's earlier count", () => {
    const counts = createOpenCounts();
    counts.set('forms', 2);

    expect(counts.set('forms', 5)).toBe(5);
  });

  it('returns zero once every source is back to zero', () => {
    const counts = createOpenCounts();
    counts.set('forms', 2);
    counts.set('primer', 1);

    expect(counts.set('forms', 0)).toBe(1);
    expect(counts.set('primer', 0)).toBe(0);
  });
});
