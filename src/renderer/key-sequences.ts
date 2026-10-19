import type { PageBind, ViewScope } from '../contracts/keymap';

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

export interface SequenceMatcher {
  feed(key: string, scope: ViewScope, now: number): SequenceResult;
  reset(): void;
}

function firesIn(bind: PageBind, scope: ViewScope): boolean {
  return bind.scope === 'any' || bind.scope === scope;
}

function scopesOverlap(a: ViewScope, b: ViewScope): boolean {
  return a === 'any' || b === 'any' || a === b;
}

function startsWith(keys: string[], prefix: string[]): boolean {
  return (
    prefix.length <= keys.length &&
    prefix.every((key, index) => keys[index] === key)
  );
}

function describeBind(bind: PageBind): string {
  return `"${bind.keys.join(' ')}" [${bind.scope}] ${bind.command}`;
}

// Throws on a bind with no keys, or on two binds sharing a scope where one's
// keys equal or begin the other's.
export function requireUnambiguousBinds(binds: PageBind[]): void {
  for (const bind of binds) {
    if (bind.keys.length === 0) {
      throw new Error(`Page bind for ${bind.command} has no keys`);
    }
  }
  binds.forEach((bind, index) => {
    for (const other of binds.slice(index + 1)) {
      const sharesAScope = scopesOverlap(bind.scope, other.scope);
      const keysCollide =
        startsWith(bind.keys, other.keys) || startsWith(other.keys, bind.keys);
      if (sharesAScope && keysCollide) {
        throw new Error(
          `Page binds ${describeBind(bind)} and ${describeBind(other)} share a scope, and one's keys begin the other's`,
        );
      }
    }
  });
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
// sequence whose next key comes after the timeout is dropped, as its keys
// have no meaning of their own. The caller feeds a result's `replay` keys
// back one at a time, after running its bind, in the scope that bind left.
export function createSequenceMatcher(
  binds: PageBind[],
  timeoutMs: number,
): SequenceMatcher {
  requireUnambiguousBinds(binds);
  let pending: string[] = [];
  let lastKeyAt = 0;

  return {
    feed(key, scope, now) {
      const isContinuing = pending.length > 0 && now - lastKeyAt <= timeoutMs;
      const keys = isContinuing ? [...pending, key] : [key];
      lastKeyAt = now;
      const { ran, replay, pendingKeys } = consumeKeys(binds, keys, scope);
      pending = pendingKeys;
      return { ran, replay, pending: pendingKeys.length > 0 };
    },
    reset() {
      pending = [];
    },
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

const CHORD_NOTATION = /^<(C-)?(A-)?(S-)?(D-)?([a-z0-9])>$/;

function isChordToken(key: string): boolean {
  return key.length > 1 && key.startsWith('<') && key.endsWith('>');
}

// A letter matches its `Key` code and a digit its top-row `Digit` code.
function parseChord(bind: PageBind, token: string): ParsedChord {
  const parts = CHORD_NOTATION.exec(token);
  const hasNonShiftModifier =
    parts !== null &&
    (parts[1] !== undefined ||
      parts[2] !== undefined ||
      parts[4] !== undefined);
  if (!parts || !hasNonShiftModifier) {
    throw new Error(
      `Page bind for ${bind.command} has a malformed chord ${token}: write modifiers C-, A-, S-, D- in that order, at least one of C-, A-, D-, then one lowercase letter or digit`,
    );
  }
  const key = parts[5];
  const isDigit = key >= '0' && key <= '9';
  return {
    bind,
    code: isDigit ? `Digit${key}` : `Key${key.toUpperCase()}`,
    ctrlKey: parts[1] !== undefined,
    altKey: parts[2] !== undefined,
    shiftKey: parts[3] !== undefined,
    metaKey: parts[4] !== undefined,
  };
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
  const chords: ParsedChord[] = [];
  for (const bind of binds) {
    const tokens = bind.keys.filter(isChordToken);
    if (tokens.length > 0 && bind.keys.length > 1) {
      throw new Error(
        `Page bind for ${bind.command} has the chord ${tokens[0]} inside the sequence "${bind.keys.join(' ')}"; a chord must be the bind's only key`,
      );
    }
    if (tokens.length === 1) {
      chords.push(parseChord(bind, tokens[0]));
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
