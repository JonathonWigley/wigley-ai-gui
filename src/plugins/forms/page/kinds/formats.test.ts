import { describe, expect, it } from 'vitest';
import { itemLabel } from './formats';

describe('itemLabel', () => {
  it('labels one index apart for each kind and ends each label in the index', () => {
    const labels = (['finding', 'notice', 'question'] as const).map((kind) =>
      itemLabel({ kind, index: 4 }),
    );

    expect(new Set(labels).size).toBe(3);
    for (const label of labels) {
      expect(label.endsWith('4')).toBe(true);
    }
  });
});
