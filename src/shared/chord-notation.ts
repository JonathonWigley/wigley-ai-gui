// The page keymap's chord notation, in vim's style: `<C-h>`, `<A-o>`, `<D-w>`.
// The page key engine matches binds with it and the self-test driver presses
// steps with it, so both read a token the same way.

// The modifiers a chord holds, and its key: one lowercase letter, one digit,
// `;`, `'`, `Enter` or `Tab`.
export interface Chord {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
  key: string;
}

export const CHORD_NOTATION_RULE =
  "write modifiers C-, A-, S-, D- in that order, at least one of C-, A-, D- (S- alone only on Enter or Tab, and none needed on Tab), then one lowercase letter, one digit, ;, ', Enter or Tab";

const CHORD_NOTATION = /^<(C-)?(A-)?(S-)?(D-)?([a-z0-9;']|Enter|Tab)>$/;

// A key written in angle brackets claims to be a chord; a lone `<` or `>` is a
// plain key.
export function isChordToken(key: string): boolean {
  return key.length > 1 && key.startsWith('<') && key.endsWith('>');
}

// The chord `token` writes, or null when it does not fit the notation. Shift
// alone makes no chord, since it types the key's capital or symbol, except on
// Enter, which has neither. Tab is a chord on its own too, so `<Tab>` and
// `<S-Tab>` fire ahead of a box's vim in every mode.
export function parseChord(token: string): Chord | null {
  const parts = CHORD_NOTATION.exec(token);
  if (!parts) {
    return null;
  }
  const chord: Chord = {
    ctrl: parts[1] !== undefined,
    alt: parts[2] !== undefined,
    shift: parts[3] !== undefined,
    meta: parts[4] !== undefined,
    key: parts[5],
  };
  const hasNonShiftModifier = chord.ctrl || chord.alt || chord.meta;
  const isShiftEnter = chord.shift && chord.key === 'Enter';
  const isTab = chord.key === 'Tab';
  return hasNonShiftModifier || isShiftEnter || isTab ? chord : null;
}
