import { describe, expect, it } from 'vitest';
import { nextTransparency } from './transparency-toggle';

describe('nextTransparency', () => {
  it('goes to reduced from no override', () => {
    expect(nextTransparency(null)).toBe('reduced');
  });

  it('goes to full from reduced', () => {
    expect(nextTransparency('reduced')).toBe('full');
  });

  it('goes to reduced from full', () => {
    expect(nextTransparency('full')).toBe('reduced');
  });
});
