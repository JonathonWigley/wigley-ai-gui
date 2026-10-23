import { describe, expect, it } from 'vitest';
import { capitalised } from './capitalised';

describe('capitalised', () => {
  it('raises the first letter and leaves the rest as written', () => {
    expect(capitalised('open file')).toBe('Open file');
    expect(capitalised('mixedCase')).toBe('MixedCase');
  });

  it('leaves already-capital text and the empty string unchanged', () => {
    expect(capitalised('Core')).toBe('Core');
    expect(capitalised('')).toBe('');
  });
});
