import { describe, expect, it } from 'vitest';
import { nextTransparency } from './transparency-toggle';

describe('nextTransparency', () => {
  it.each([
    { overridden: null, expected: 'reduced' },
    { overridden: 'reduced', expected: 'full' },
    { overridden: 'full', expected: 'reduced' },
  ] as const)(
    'goes to $expected from $overridden',
    ({ overridden, expected }) => {
      expect(nextTransparency(overridden)).toBe(expected);
    },
  );
});
