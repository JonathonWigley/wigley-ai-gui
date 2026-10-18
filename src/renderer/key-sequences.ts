import type { CommandId } from '../contracts/commands';
import type { PageBind, ViewScope } from '../contracts/keymap';

export type SequenceResult =
  | { kind: 'run'; command: CommandId }
  | { kind: 'pending' }
  | { kind: 'none' };

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
): SequenceResult {
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

// Unambiguous binds make a complete sequence never the start of a longer one,
// so a match runs at once and only an incomplete sequence waits.
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
    // As in vim, a key that breaks a pending sequence is dropped with it.
    feed(key, scope, now) {
      const isContinuing = pending.length > 0 && now - lastKeyAt <= timeoutMs;
      const keys = isContinuing ? [...pending, key] : [key];
      lastKeyAt = now;
      const result = matchKeys(binds, keys, scope);
      pending = result.kind === 'pending' ? keys : [];
      return result;
    },
    reset() {
      pending = [];
    },
  };
}
