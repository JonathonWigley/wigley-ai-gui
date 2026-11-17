import { describe, expect, it } from 'vitest';
import {
  type Chord,
  chordToken,
  isChordToken,
  parseChord,
} from './chord-notation';

// A chord on `key` holding only the modifiers `held` sets.
function chord(key: string, held: Partial<Chord> = {}): Chord {
  return {
    ctrl: false,
    alt: false,
    shift: false,
    meta: false,
    key,
    ...held,
  };
}

const ACCEPTED: { token: string; expected: Chord }[] = [
  { token: '<C-/>', expected: chord('/', { ctrl: true }) },
  { token: '<C-,>', expected: chord(',', { ctrl: true }) },
  { token: '<C-?>', expected: chord('?', { ctrl: true }) },
  { token: '<C->>', expected: chord('>', { ctrl: true }) },
  { token: '<C-lt>', expected: chord('<', { ctrl: true }) },
  { token: '<C-Bslash>', expected: chord('\\', { ctrl: true }) },
  { token: '<C-Bar>', expected: chord('|', { ctrl: true }) },
  { token: '<C-Space>', expected: chord(' ', { ctrl: true }) },
  { token: '<F5>', expected: chord('F5') },
  { token: '<S-F12>', expected: chord('F12', { shift: true }) },
  { token: '<C-F1>', expected: chord('F1', { ctrl: true }) },
  { token: '<A-Up>', expected: chord('ArrowUp', { alt: true }) },
  {
    token: '<C-S-Down>',
    expected: chord('ArrowDown', { ctrl: true, shift: true }),
  },
  { token: '<D-Left>', expected: chord('ArrowLeft', { meta: true }) },
  { token: '<A-Right>', expected: chord('ArrowRight', { alt: true }) },
  { token: '<C-Home>', expected: chord('Home', { ctrl: true }) },
  { token: '<C-End>', expected: chord('End', { ctrl: true }) },
  { token: '<C-PageUp>', expected: chord('PageUp', { ctrl: true }) },
  { token: '<C-PageDown>', expected: chord('PageDown', { ctrl: true }) },
  { token: '<D-BS>', expected: chord('Backspace', { meta: true }) },
  { token: '<C-Del>', expected: chord('Delete', { ctrl: true }) },
];

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

  it.each(ACCEPTED)('reads $token', ({ token, expected }) => {
    expect(parseChord(token)).toEqual(expected);
  });

  it.each([
    '<A-C-h>',
    '<C-H>',
    '<S-h>',
    '<h>',
    'h',
    '<C-S-/>',
    '<C-S-1>',
    '<S-/>',
    '<C-<>',
    '<C-\\>',
    '<C-|>',
    '<C- >',
    '<C-é>',
    '<Up>',
    '<S-Up>',
    '<C-up>',
    '<C-space>',
    '<C-F13>',
    '<F0>',
    '<C-Insert>',
  ])('rejects %s', (token) => {
    expect(parseChord(token)).toBeNull();
  });

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

describe('chordToken', () => {
  it.each([
    ...ACCEPTED.map(({ token }) => token),
    '<C-A-S-D-h>',
    '<S-Enter>',
    '<Tab>',
    '<S-Tab>',
  ])('writes %s back as it was read', (token) => {
    expect(chordToken(parseChord(token)!)).toBe(token);
  });

  it.each([
    { held: { ctrl: true, shift: true }, key: '/' },
    { held: {}, key: 'h' },
  ])('writes no token for $key holding $held', ({ held, key }) => {
    expect(chordToken(chord(key, held))).toBeNull();
  });
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
