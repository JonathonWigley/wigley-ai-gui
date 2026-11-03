import type { Disposable } from '../contracts/disposable';
import type { ViewScope } from '../contracts/keymap';
import type { PushedScope } from '../contracts/plugin';
import { createListeners, type Listeners } from '../shared/listeners';

// The scope page keys fire in: the base a plugin's view sets, under the scopes
// modal views push over it. `current` is the scope pushed last and not yet
// popped, else the base. `anyPushed` is true while any pushed scope is not
// yet popped. `onChange` listeners run each time `current` changes;
// a pushed scope's `onBaseChanged` listeners run each time the base changes
// while it is pushed, after the `onChange` listeners. `onBaseChange` listeners
// run each time `setBase` moves the base to another scope, after both; a push
// or a pop runs none. `onChange` and `onBaseChanged` hear until their handle's
// `dispose`. A pushed scope's `dispose` pops it through the same path as `pop`
// when it is still pushed, and otherwise does nothing.
export interface ScopeStack {
  setBase(scope: ViewScope): void;
  push(scope: ViewScope): PushedScope;
  current(): ViewScope;
  anyPushed(): boolean;
  onChange(listener: (scope: ViewScope) => void): Disposable;
  onBaseChange(listener: (base: ViewScope) => void): void;
}

interface PushedEntry {
  scope: ViewScope;
  baseListeners: Listeners<ViewScope>;
}

export function createScopeStack(initial: ViewScope): ScopeStack {
  let base = initial;
  // Each entry is its own object, so a handle finds its entry when another
  // entry holds the same scope.
  const pushed: PushedEntry[] = [];
  const listeners = createListeners<ViewScope>();
  const baseListeners: ((base: ViewScope) => void)[] = [];
  const current = () => pushed.at(-1)?.scope ?? base;

  // Runs `change`, then tells the listeners when it moved `current`.
  const changing = (change: () => void) => {
    const before = current();
    change();
    const after = current();
    if (after !== before) {
      listeners.tell(after);
    }
  };

  // A listener may pop its own or another entry, so each entry is checked
  // still pushed before its listeners run.
  const tellPushedOfBase = () => {
    for (const entry of pushed.slice()) {
      if (pushed.includes(entry)) {
        entry.baseListeners.tell(base);
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
      const entry: PushedEntry = {
        scope,
        baseListeners: createListeners<ViewScope>(),
      };
      changing(() => pushed.push(entry));
      const remove = (index: number) => {
        changing(() => pushed.splice(index, 1));
      };
      return {
        pop() {
          const index = pushed.indexOf(entry);
          if (index === -1) {
            throw new Error(`Scope ${scope} was already popped`);
          }
          remove(index);
        },
        dispose() {
          const index = pushed.indexOf(entry);
          if (index !== -1) {
            remove(index);
          }
        },
        onBaseChanged: (listener) => entry.baseListeners.add(listener),
      };
    },
    current,
    anyPushed: () => pushed.length > 0,
    onChange: (listener) => listeners.add(listener),
    onBaseChange(listener) {
      baseListeners.push(listener);
    },
  };
}
