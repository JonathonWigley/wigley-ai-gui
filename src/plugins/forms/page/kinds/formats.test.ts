import { describe, expect, it } from 'vitest';
import { BUILT_IN_PAGE_KINDS, itemLabel } from './formats';
import { pageKindTable } from './page-kinds';

describe('itemLabel', () => {
  const kinds = pageKindTable(BUILT_IN_PAGE_KINDS);

  it('gives each kind its own label for one index, each ending in the index', () => {
    const labels = (['finding', 'notice', 'question'] as const).map((kind) =>
      itemLabel(kinds, { kind, index: 4 }),
    );

    expect(new Set(labels).size).toBe(3);
    for (const label of labels) {
      expect(label.endsWith('4')).toBe(true);
    }
  });

  it('throws for a kind with no registration', () => {
    expect(() => itemLabel(kinds, { kind: 'poll', index: 1 })).toThrow(
      'no page kind poll',
    );
  });
});
