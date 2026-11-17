// The page keymap's chord notation, in vim's style: `<C-h>`, `<A-o>`, `<D-w>`.
// The page key engine matches binds with it and the self-test driver presses
// steps with it, so both read a token the same way.

// The modifiers a chord holds, and its key: the KeyboardEvent.key value the
// chord's key types or names (`h`, `?`, `' '`, `ArrowUp`, `F5`).
export interface Chord {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
  key: string;
}

export const CHORD_NOTATION_RULE =
  'write modifiers C-, A-, S-, D- in that order, then the key: a lowercase letter (S- allowed), a digit or a symbol written as the character it types (no S-; lt, Bslash, Bar, Space for <, \\, |, space), each with at least one of C-, A-, D-; Enter with one of C-, A-, D- or S- alone; Tab or F1 to F12 with any modifiers or none; Up, Down, Left, Right, Home, End, PageUp, PageDown, BS or Del with at least one of C-, A-, D-';

const CHORD_NOTATION = /^<(C-)?(A-)?(S-)?(D-)?(.+)>$/u;

// What each kind of chord key needs held: a letter takes Shift as a variant; a
// character has Shift in it already; Enter takes Shift alone; Tab and the F
// keys need nothing; a navigation key needs Ctrl, Alt or Cmd, since Shift alone
// on it extends a text selection.
type KeyKind = 'letter' | 'character' | 'enter' | 'free' | 'navigation';

interface ChordKey {
  key: string;
  kind: KeyKind;
}

// The 29 ASCII symbols a token writes raw; `<`, `\`, `|` and space go by name.
const SYMBOLS = new Set('!"#$%&\'()*+,-./:;=>?@[]^_`{}~');

const F_KEYS = Array.from({ length: 12 }, (_, index) => `F${index + 1}`);

// Each named chord key, by the name a token writes it with.
const NAMED_KEYS = new Map<string, ChordKey>([
  ['lt', { key: '<', kind: 'character' }],
  ['Bslash', { key: '\\', kind: 'character' }],
  ['Bar', { key: '|', kind: 'character' }],
  ['Space', { key: ' ', kind: 'character' }],
  ['Enter', { key: 'Enter', kind: 'enter' }],
  ['Tab', { key: 'Tab', kind: 'free' }],
  ...F_KEYS.map((name): [string, ChordKey] => [
    name,
    { key: name, kind: 'free' },
  ]),
  ['Up', { key: 'ArrowUp', kind: 'navigation' }],
  ['Down', { key: 'ArrowDown', kind: 'navigation' }],
  ['Left', { key: 'ArrowLeft', kind: 'navigation' }],
  ['Right', { key: 'ArrowRight', kind: 'navigation' }],
  ['Home', { key: 'Home', kind: 'navigation' }],
  ['End', { key: 'End', kind: 'navigation' }],
  ['PageUp', { key: 'PageUp', kind: 'navigation' }],
  ['PageDown', { key: 'PageDown', kind: 'navigation' }],
  ['BS', { key: 'Backspace', kind: 'navigation' }],
  ['Del', { key: 'Delete', kind: 'navigation' }],
]);

// The name a token writes each named key with, by its `Chord.key`.
const NAME_BY_KEY = new Map(
  [...NAMED_KEYS].map(([name, { key }]) => [key, name] as const),
);

function chordKeyOf(written: string): ChordKey | null {
  const named = NAMED_KEYS.get(written);
  if (named !== undefined) {
    return named;
  }
  if (/^[a-z]$/.test(written)) {
    return { key: written, kind: 'letter' };
  }
  const isCharacter = /^[0-9]$/.test(written) || SYMBOLS.has(written);
  return isCharacter ? { key: written, kind: 'character' } : null;
}

function holdsWhatItsKeyNeeds(kind: KeyKind, chord: Chord): boolean {
  const hasNonShiftModifier = chord.ctrl || chord.alt || chord.meta;
  switch (kind) {
    case 'letter':
    case 'navigation':
      return hasNonShiftModifier;
    case 'character':
      return hasNonShiftModifier && !chord.shift;
    case 'enter':
      return hasNonShiftModifier || chord.shift;
    case 'free':
      return true;
  }
}

// A key written in angle brackets claims to be a chord; a lone `<` or `>` is a
// plain key.
export function isChordToken(key: string): boolean {
  return key.length > 1 && key.startsWith('<') && key.endsWith('>');
}

// The chord `token` writes, or null when it does not fit `CHORD_NOTATION_RULE`.
// Tab is a chord on its own, so `<Tab>` and `<S-Tab>` fire ahead of a box's vim
// in every mode.
export function parseChord(token: string): Chord | null {
  const parts = CHORD_NOTATION.exec(token);
  const chordKey = parts === null ? null : chordKeyOf(parts[5]);
  if (parts === null || chordKey === null) {
    return null;
  }
  const chord: Chord = {
    ctrl: parts[1] !== undefined,
    alt: parts[2] !== undefined,
    shift: parts[3] !== undefined,
    meta: parts[4] !== undefined,
    key: chordKey.key,
  };
  return holdsWhatItsKeyNeeds(chordKey.kind, chord) ? chord : null;
}

function isSameChord(a: Chord, b: Chord): boolean {
  return (
    a.key === b.key &&
    a.ctrl === b.ctrl &&
    a.alt === b.alt &&
    a.shift === b.shift &&
    a.meta === b.meta
  );
}

// The token `parseChord` reads back as `chord`, or null when no token writes
// it: `<C-?>` for Ctrl and `?`, null for Ctrl+Shift and `/`.
export function chordToken(chord: Chord): string | null {
  const modifiers =
    (chord.ctrl ? 'C-' : '') +
    (chord.alt ? 'A-' : '') +
    (chord.shift ? 'S-' : '') +
    (chord.meta ? 'D-' : '');
  const token = `<${modifiers}${NAME_BY_KEY.get(chord.key) ?? chord.key}>`;
  const parsed = parseChord(token);
  return parsed !== null && isSameChord(parsed, chord) ? token : null;
}
