import { describe, expect, it } from 'vitest';
import { itemLabel } from './formats';

describe('itemLabel', () => {
  it('labels each kind by its rail prefix', () => {
    expect(itemLabel({ kind: 'finding', index: 1 })).toBe('F1');
    expect(itemLabel({ kind: 'notice', index: 2 })).toBe('N2');
    expect(itemLabel({ kind: 'question', index: 3 })).toBe('3');
  });
});
