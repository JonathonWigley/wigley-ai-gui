import type { PageBind, ViewScope } from '../contracts/keymap';
import { type Chord, isChordToken, parseChord } from '../shared/chord-notation';
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

// The parts of a key event a chord matches on.
export type ChordPress = Pick<
  KeyboardEvent,
  'code' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'
>;

export interface ChordMatcher {
  match(press: ChordPress, scope: ViewScope): PageBind | undefined;
}

interface ParsedChord extends ChordPress {
  bind: PageBind;
}

// A letter matches its `Key` code, a digit its top-row `Digit` code, and
// `Enter` the main Enter key's code.
function toParsedChord(bind: PageBind, chord: Chord): ParsedChord {
  return {
    bind,
    code: chordCode(chord.key),
    ctrlKey: chord.ctrl,
    altKey: chord.alt,
    shiftKey: chord.shift,
    metaKey: chord.meta,
  };
}

function chordCode(key: string): string {
  if (key === 'Enter') {
    return 'Enter';
  }
  const isDigit = key >= '0' && key <= '9';
  return isDigit ? `Digit${key}` : `Key${key.toUpperCase()}`;
}

function isSameChord(a: ChordPress, b: ChordPress): boolean {
  return (
    a.code === b.code &&
    a.ctrlKey === b.ctrlKey &&
    a.altKey === b.altKey &&
    a.shiftKey === b.shiftKey &&
    a.metaKey === b.metaKey
  );
}

// Takes every page bind and keeps its chord binds: a bind whose only key is a
// chord token such as `<C-h>`. Throws on a chord inside a longer sequence or a
// chord that does not fit the notation. A chord matches on the physical key and
// the exact modifiers held, never on `KeyboardEvent.key`.
export function createChordMatcher(binds: PageBind[]): ChordMatcher {
  requireWellFormedChords(binds);
  const chords: ParsedChord[] = [];
  for (const bind of binds) {
    const isChordBind = bind.keys.length === 1 && isChordToken(bind.keys[0]);
    const chord = isChordBind ? parseChord(bind.keys[0]) : null;
    if (chord !== null) {
      chords.push(toParsedChord(bind, chord));
    }
  }

  return {
    match(press, scope) {
      return chords.find(
        (chord) => isSameChord(chord, press) && firesIn(chord.bind, scope),
      )?.bind;
    },
  };
}
