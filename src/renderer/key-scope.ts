import type { ViewScope } from '../contracts/keymap';
import type { PushedScope } from '../contracts/plugin';

// The scope page keys fire in: the base a plugin's view sets, under the scopes
// modal views push over it. `current` is the scope pushed last and not yet
// popped, else the base. `anyPushed` is true while any pushed scope is not
// yet popped. `onChange` listeners run each time `current` changes;
// a pushed scope's `onBaseChanged` listeners run each time the base changes
// while it is pushed, after the `onChange` listeners. `onBaseChange` listeners
// run each time `setBase` moves the base to another scope, after both; a push
// or a pop runs none.
export interface ScopeStack {
  setBase(scope: ViewScope): void;
  push(scope: ViewScope): PushedScope;
  current(): ViewScope;
  anyPushed(): boolean;
  onChange(listener: (scope: ViewScope) => void): void;
  onBaseChange(listener: (base: ViewScope) => void): void;
}

interface PushedEntry {
  scope: ViewScope;
  baseListeners: ((base: ViewScope) => void)[];
}

export function createScopeStack(initial: ViewScope): ScopeStack {
  let base = initial;
  // Each entry is its own object, so a handle finds its entry when another
  // entry holds the same scope.
  const pushed: PushedEntry[] = [];
  const listeners: ((scope: ViewScope) => void)[] = [];
  const baseListeners: ((base: ViewScope) => void)[] = [];
  const current = () => pushed.at(-1)?.scope ?? base;

  // Runs `change`, then tells the listeners when it moved `current`.
  const changing = (change: () => void) => {
    const before = current();
    change();
    const after = current();
    if (after === before) {
      return;
    }
    for (const listener of listeners) {
      listener(after);
    }
  };

  // A listener may pop its own or another entry, so each entry is checked
  // still pushed before its listeners run.
  const tellPushedOfBase = () => {
    for (const entry of pushed.slice()) {
      if (!pushed.includes(entry)) {
        continue;
      }
      for (const listener of entry.baseListeners) {
        listener(base);
      }
    }
  };

  return {
    setBase(scope) {
      if (scope === base) {
        return;
      }
      changing(() => {
        base = scope;
      });
      tellPushedOfBase();
      for (const listener of baseListeners) {
        listener(base);
      }
    },
    push(scope) {
      const entry: PushedEntry = { scope, baseListeners: [] };
      changing(() => pushed.push(entry));
      return {
        pop() {
          const index = pushed.indexOf(entry);
          if (index === -1) {
            throw new Error(`Scope ${scope} was already popped`);
          }
          changing(() => pushed.splice(index, 1));
        },
        onBaseChanged(listener) {
          entry.baseListeners.push(listener);
        },
      };
    },
    current,
    anyPushed: () => pushed.length > 0,
    onChange(listener) {
      listeners.push(listener);
    },
    onBaseChange(listener) {
      baseListeners.push(listener);
    },
  };
}
