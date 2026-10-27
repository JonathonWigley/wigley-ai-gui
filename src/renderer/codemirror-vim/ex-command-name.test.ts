import { describe, expect, it } from 'vitest';
import { exBindName } from './ex-command-name';

describe('exBindName', () => {
  it('gives each index a distinct name of letters only', () => {
    const names = Array.from({ length: 121 }, (_, index) => exBindName(index));

    for (const name of names) {
      expect(name).toMatch(/^[a-z]+$/);
    }
    expect(new Set(names).size).toBe(names.length);
  });
});
