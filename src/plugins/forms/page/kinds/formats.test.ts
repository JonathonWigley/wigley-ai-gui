import { describe, expect, it } from 'vitest';
import { BUILT_IN_PAGE_KINDS, itemLabel } from './formats';
import { pageKindTable } from './page-kinds';

describe('itemLabel', () => {
  const kinds = pageKindTable(BUILT_IN_PAGE_KINDS);

  it('labels each kind by its rail prefix', () => {
    expect(itemLabel(kinds, { kind: 'finding', index: 1 })).toBe('F1');
    expect(itemLabel(kinds, { kind: 'notice', index: 2 })).toBe('N2');
    expect(itemLabel(kinds, { kind: 'question', index: 3 })).toBe('3');
  });

  it('throws for a kind with no registration', () => {
    expect(() => itemLabel(kinds, { kind: 'poll', index: 1 })).toThrow(
      'no page kind poll',
    );
  });
});
