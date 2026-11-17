import { describe, expect, it } from 'vitest';
import type { AlertNoun } from '../../contracts/alerts';
import {
  createOpenCounts,
  describeOpenCounts,
  type OpenCountPart,
} from './open-counts';

const F: AlertNoun = {
  singular: 'open agent form',
  plural: 'open agent forms',
};
const P: AlertNoun = {
  singular: 'open feature primer',
  plural: 'open feature primers',
};

describe('createOpenCounts', () => {
  it('sums the latest count of every source', () => {
    const counts = createOpenCounts();

    expect(counts.set('forms', 2, F).total).toBe(2);
    expect(counts.set('primer', 1, P).total).toBe(3);
  });

  it("replaces a source's earlier count", () => {
    const counts = createOpenCounts();
    counts.set('forms', 2, F);

    expect(counts.set('forms', 5, F).total).toBe(5);
  });

  it('returns zero once every source is back to zero', () => {
    const counts = createOpenCounts();
    counts.set('forms', 2, F);
    counts.set('primer', 1, P);

    expect(counts.set('forms', 0, F).total).toBe(1);
    expect(counts.set('primer', 0, P).total).toBe(0);
  });

  it.each<{
    calls: string;
    sets: [string, number, AlertNoun][];
    expected: [number, AlertNoun][];
  }>([
    {
      calls: 'forms 2, primer 1',
      sets: [
        ['forms', 2, F],
        ['primer', 1, P],
      ],
      expected: [
        [2, F],
        [1, P],
      ],
    },
    {
      calls: 'primer 1, forms 2',
      sets: [
        ['primer', 1, P],
        ['forms', 2, F],
      ],
      expected: [
        [1, P],
        [2, F],
      ],
    },
    {
      calls: 'forms 2, primer 1, forms 0',
      sets: [
        ['forms', 2, F],
        ['primer', 1, P],
        ['forms', 0, F],
      ],
      expected: [[1, P]],
    },
    {
      calls: 'forms 2, primer 1, forms 0, forms 3',
      sets: [
        ['forms', 2, F],
        ['primer', 1, P],
        ['forms', 0, F],
        ['forms', 3, F],
      ],
      expected: [
        [3, F],
        [1, P],
      ],
    },
    {
      calls: 'forms 0, primer 1, forms 2',
      sets: [
        ['forms', 0, F],
        ['primer', 1, P],
        ['forms', 2, F],
      ],
      expected: [
        [1, P],
        [2, F],
      ],
    },
  ])('parts after $calls are $expected', ({ sets, expected }) => {
    const counts = createOpenCounts();
    let parts: readonly OpenCountPart[] = [];

    for (const [source, count, noun] of sets) {
      parts = counts.set(source, count, noun).parts;
    }

    expect(parts.map(({ count, noun }) => [count, noun])).toEqual(expected);
  });
});

describe('describeOpenCounts', () => {
  it.each<{ parts: OpenCountPart[]; text: string }>([
    { parts: [], text: '' },
    { parts: [{ count: 1, noun: F }], text: '1 open agent form' },
    { parts: [{ count: 2, noun: F }], text: '2 open agent forms' },
    {
      parts: [
        { count: 2, noun: F },
        { count: 1, noun: P },
      ],
      text: '2 open agent forms, 1 open feature primer',
    },
    {
      parts: [
        { count: 3, noun: P },
        { count: 1, noun: F },
      ],
      text: '3 open feature primers, 1 open agent form',
    },
  ])('describes $parts as $text', ({ parts, text }) => {
    expect(describeOpenCounts(parts)).toBe(text);
  });
});
