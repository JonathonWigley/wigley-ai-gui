import { describe, expect, it } from 'vitest';
import { isChordToken, parseChord } from './chord-notation';

describe('parseChord', () => {
  it('reads each modifier and the key', () => {
    expect(parseChord('<C-A-S-D-h>')).toEqual({
      ctrl: true,
      alt: true,
      shift: true,
      meta: true,
      key: 'h',
    });
    expect(parseChord('<D-7>')).toEqual({
      ctrl: false,
      alt: false,
      shift: false,
      meta: true,
      key: '7',
    });
  });

  it.each(['<A-C-h>', '<C-H>', '<C-;>', '<C-F1>', '<S-h>', '<h>', 'h'])(
    'rejects %s',
    (token) => {
      expect(parseChord(token)).toBeNull();
    },
  );
});

describe('isChordToken', () => {
  it.each([
    ['<C-h>', true],
    ['<h>', true],
    ['<', false],
    ['>', false],
    ['h', false],
  ])('%s is a chord token: %s', (key, expected) => {
    expect(isChordToken(key)).toBe(expected);
  });
});
