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
    expect(parseChord('<A-;>')?.key).toBe(';');
    expect(parseChord("<A-'>")?.key).toBe("'");
  });

  it.each(['<A-C-h>', '<C-H>', '<C-,>', '<C-F1>', '<S-h>', '<h>', 'h'])(
    'rejects %s',
    (token) => {
      expect(parseChord(token)).toBeNull();
    },
  );

  it('parseChord_EnterKey', () => {
    expect(parseChord('<D-Enter>')).toEqual({
      ctrl: false,
      alt: false,
      shift: false,
      meta: true,
      key: 'Enter',
    });
    expect(parseChord('<S-Enter>')).toEqual({
      ctrl: false,
      alt: false,
      shift: true,
      meta: false,
      key: 'Enter',
    });
  });

  it.each([
    ['<Tab>', false],
    ['<S-Tab>', true],
  ])('parseChord_TabKey_ChordWithOrWithoutShift %s', (token, shift) => {
    expect(parseChord(token)).toEqual({
      ctrl: false,
      alt: false,
      shift,
      meta: false,
      key: 'Tab',
    });
  });

  it.each(['<D-enter>', '<tab>', '<D-Esc>'])(
    'parseChord_OtherNamedKeys_Rejected %s',
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
