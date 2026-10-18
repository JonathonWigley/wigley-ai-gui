import type { CommandId } from '../contracts/commands';
import type { PageBind, ViewScope } from '../contracts/keymap';

type MatchResult =
  | { kind: 'run'; command: CommandId }
  | { kind: 'pending' }
  | { kind: 'none' };

// What one key did: the commands it ran, in order, and whether keys now wait
// for more. A key that breaks a pending sequence can run several commands.
export interface SequenceResult {
  run: CommandId[];
  pending: boolean;
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
    return { kind: 'run', command: complete.command };
  }
  const continues = inScope.some((bind) => startsWith(bind.keys, keys));
  return continues ? { kind: 'pending' } : { kind: 'none' };
}

// Matches `keys` from the front as vim does: a bind runs and its keys are
// used up; keys that begin a bind wait; a sequence the next key breaks runs
// its first key's own meaning — none, since a key that begins a longer bind
// cannot be bound alone — and the keys after it are matched again.
function consumeKeys(
  binds: PageBind[],
  keys: string[],
  scope: ViewScope,
): { run: CommandId[]; pendingKeys: string[] } {
  const run: CommandId[] = [];
  let unmatched = keys;
  let length = 1;
  while (length <= unmatched.length) {
    const result = matchKeys(binds, unmatched.slice(0, length), scope);
    if (result.kind === 'run') {
      run.push(result.command);
      unmatched = unmatched.slice(length);
      length = 1;
    } else if (result.kind === 'pending') {
      length++;
    } else {
      unmatched = unmatched.slice(1);
      length = 1;
    }
  }
  return { run, pendingKeys: unmatched };
}

// Unambiguous binds make a complete sequence never the start of a longer one,
// so a match runs at once and only an incomplete sequence waits. A pending
// sequence whose next key comes after the timeout is dropped, as its keys
// have no meaning of their own.
export function createSequenceMatcher(
  binds: PageBind[],
  timeoutMs: number,
): {
  feed(key: string, scope: ViewScope, now: number): SequenceResult;
  reset(): void;
} {
  requireUnambiguousBinds(binds);
  let pending: string[] = [];
  let lastKeyAt = 0;

  return {
    feed(key, scope, now) {
      const isContinuing = pending.length > 0 && now - lastKeyAt <= timeoutMs;
      const keys = isContinuing ? [...pending, key] : [key];
      lastKeyAt = now;
      const { run, pendingKeys } = consumeKeys(binds, keys, scope);
      pending = pendingKeys;
      return { run, pending: pendingKeys.length > 0 };
    },
    reset() {
      pending = [];
    },
  };
}
