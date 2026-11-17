import type { PageBind, ViewScope } from '../contracts/keymap';
import type { PlatformKeys } from '../contracts/platform';
import { type Chord, chordToken, isChordToken } from '../shared/chord-notation';
import {
  firesIn,
  requireUnambiguousBinds,
  requireWellFormedChords,
  startsWith,
} from '../shared/keymap-checks';

type MatchResult =
  | { kind: 'run'; bind: PageBind }
  | { kind: 'pending' }
  | { kind: 'none' };

// What one key did: the bind it ran, if any; the keys typed after that bind,
// to be fed again once its command has run; and whether keys wait for more.
export interface SequenceResult {
  ran: PageBind | undefined;
  replay: string[];
  pending: boolean;
}

// `pendingKeys` are the keys waiting for more, `[]` when none. `hold` keeps
// them past the timeout until no keys are pending: a bind runs, a break leaves
// nothing waiting, or `reset`. `isHeld` reads whether a hold is in force.
export interface SequenceMatcher {
  feed(key: string, scope: ViewScope, now: number): SequenceResult;
  reset(): void;
  pendingKeys(): string[];
  hold(): void;
  isHeld(): boolean;
}

function matchKeys(
  binds: PageBind[],
  keys: string[],
  scope: ViewScope,
): MatchResult {
  const inScope = binds.filter((bind) => firesIn(bind, scope));
  const complete = inScope.find(
    (bind) => bind.keys.length === keys.length && startsWith(bind.keys, keys),
  );
  if (complete) {
    return { kind: 'run', bind: complete };
  }
  const continues = inScope.some((bind) => startsWith(bind.keys, keys));
  return continues ? { kind: 'pending' } : { kind: 'none' };
}

// Matches `keys` from the front as vim does: keys that begin a bind wait; a
// sequence the next key breaks runs its first key's own meaning — none, since
// a key that begins a longer bind cannot be bound alone — and the keys after
// it are matched again. Stops at the first bind that runs, since its command
// may change the scope or focus that the keys after it reach.
function consumeKeys(
  binds: PageBind[],
  keys: string[],
  scope: ViewScope,
): { ran: PageBind | undefined; replay: string[]; pendingKeys: string[] } {
  let unmatched = keys;
  let length = 1;
  while (length <= unmatched.length) {
    const result = matchKeys(binds, unmatched.slice(0, length), scope);
    if (result.kind === 'run') {
      return {
        ran: result.bind,
        replay: unmatched.slice(length),
        pendingKeys: [],
      };
    }
    if (result.kind === 'pending') {
      length++;
    } else {
      unmatched = unmatched.slice(1);
      length = 1;
    }
  }
  return { ran: undefined, replay: [], pendingKeys: unmatched };
}

// Unambiguous binds make a complete sequence never the start of a longer one,
// so a match runs at once and only an incomplete sequence waits. A pending
// sequence whose next key comes after the timeout is dropped, unless held, as
// its keys have no meaning of their own. The caller feeds a result's `replay`
// keys back one at a time, after running its bind, in the scope that bind
// left.
export function createSequenceMatcher(
  binds: PageBind[],
  timeoutMs: number,
): SequenceMatcher {
  requireUnambiguousBinds(binds);
  let pending: string[] = [];
  let lastKeyAt = 0;
  let isHeld = false;

  return {
    feed(key, scope, now) {
      const isInTime = isHeld || now - lastKeyAt <= timeoutMs;
      const isContinuing = pending.length > 0 && isInTime;
      const keys = isContinuing ? [...pending, key] : [key];
      lastKeyAt = now;
      const { ran, replay, pendingKeys } = consumeKeys(binds, keys, scope);
      pending = pendingKeys;
      isHeld &&= pendingKeys.length > 0;
      return { ran, replay, pending: pendingKeys.length > 0 };
    },
    reset() {
      pending = [];
      isHeld = false;
    },
    pendingKeys: () => [...pending],
    hold() {
      isHeld = pending.length > 0;
    },
    isHeld: () => isHeld,
  };
}

// The parts of a key event a chord matches on, as plain data.
export interface ChordPress {
  key: string;
  code: string;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
  altGraph: boolean;
}

export interface ChordMatcher {
  match(press: ChordPress, scope: ViewScope): PageBind | undefined;
}

// Each US-layout code a chord falls back to that types a character other than
// a letter, with the character it types without Shift and with it.
const US_CHARACTERS_BY_CODE: Partial<
  Record<string, readonly [string, string]>
> = {
  Backquote: ['`', '~'],
  ...Object.fromEntries(
    [...'1234567890'].map((digit, index) => [
      `Digit${digit}`,
      [digit, '!@#$%^&*()'[index]] as const,
    ]),
  ),
  Minus: ['-', '_'],
  Equal: ['=', '+'],
  BracketLeft: ['[', '{'],
  BracketRight: [']', '}'],
  Backslash: ['\\', '|'],
  Semicolon: [';', ':'],
  Quote: ["'", '"'],
  Comma: [',', '<'],
  Period: ['.', '>'],
  Slash: ['/', '?'],
  Space: [' ', ' '],
};

// Whether a chord's notation can hold `key`, read through `chordToken` so the
// notation keeps the one list of chord keys.
function isChordKey(key: string): boolean {
  return (
    chordToken({ ctrl: true, alt: false, shift: false, meta: false, key }) !==
    null
  );
}

// The chord `press`'s physical key names on a US layout; null for a code
// outside it.
function chordByCode(
  press: ChordPress,
  held: Omit<Chord, 'key' | 'shift'>,
): Chord | null {
  const letter = /^Key([A-Z])$/.exec(press.code);
  if (letter !== null) {
    return { ...held, shift: press.shift, key: letter[1].toLowerCase() };
  }
  const characters = US_CHARACTERS_BY_CODE[press.code];
  if (characters === undefined) {
    return null;
  }
  const [unshifted, shifted] = characters;
  return { ...held, shift: false, key: press.shift ? shifted : unshifted };
}

// The chord `press` names, or null when it names none:
// an AltGr press where AltGr types is typing, so no chord;
// a named key (Enter, Tab, an F key, an arrow, Home, End, PageUp, PageDown,
// Backspace, Delete) is itself, Shift held as typed;
// an Option press where Option chords match by code goes by its physical key;
// an ASCII letter is its lowercase, Shift held as typed;
// a digit, space or ASCII symbol is the character, Shift being in it;
// any other press goes by its physical key on a US layout.
function pressedChord(press: ChordPress, keys: PlatformKeys): Chord | null {
  if (press.altGraph && keys.altGraphTypes) {
    return null;
  }
  const held = { ctrl: press.ctrl, alt: press.alt, meta: press.meta };
  const isNamedKey = press.key.length > 1 && isChordKey(press.key);
  if (isNamedKey) {
    return { ...held, shift: press.shift, key: press.key };
  }
  const isOptionByCode = press.alt && keys.optionMatchesByCode;
  if (isOptionByCode) {
    return chordByCode(press, held);
  }
  if (/^[A-Za-z]$/.test(press.key)) {
    return { ...held, shift: press.shift, key: press.key.toLowerCase() };
  }
  const isTypedCharacter = press.key.length === 1 && isChordKey(press.key);
  if (isTypedCharacter) {
    return { ...held, shift: false, key: press.key };
  }
  return chordByCode(press, held);
}

// The chord token a bind writes to match `press`, as `createChordMatcher`
// reads it: `<C-t>` for Control+t, `<C-?>` for Control+Shift+/ on a US layout,
// `<A-o>` for Option+o on macOS whatever character it types. Null when the
// press names no chord: AltGr typing, a key the notation has no name for, or
// no modifier that makes a chord.
export function chordTokenFor(
  press: ChordPress,
  keys: PlatformKeys,
): string | null {
  const chord = pressedChord(press, keys);
  return chord === null ? null : chordToken(chord);
}

// Takes every page bind and keeps its chord binds: a bind whose only key is a
// chord token such as `<C-h>`. Throws on a chord inside a longer sequence or a
// chord that does not fit the notation. A press matches the bind written as
// the chord it names, through `pressedChord`'s steps with the exact modifiers
// held; a token spells one chord alone, so equal tokens are equal chords.
export function createChordMatcher(
  binds: PageBind[],
  keys: PlatformKeys,
): ChordMatcher {
  requireWellFormedChords(binds);
  const chordBinds = binds.filter(
    (bind) => bind.keys.length === 1 && isChordToken(bind.keys[0]),
  );

  return {
    match(press, scope) {
      const token = chordTokenFor(press, keys);
      return token === null
        ? undefined
        : chordBinds.find(
            (bind) => bind.keys[0] === token && firesIn(bind, scope),
          );
    },
  };
}
