import type { ViewScope } from '../contracts/keymap';

// The scope page keys fire in: the base a plugin's view sets, under the scopes
// modal views push over it. `current` is the scope pushed last and not yet
// popped, else the base. `onChange` listeners run each time `current` changes.
export interface ScopeStack {
  setBase(scope: ViewScope): void;
  // The handle's `pop` removes this entry wherever it sits; a second `pop`
  // throws.
  push(scope: ViewScope): { pop(): void };
  current(): ViewScope;
  onChange(listener: (scope: ViewScope) => void): void;
}

export function createScopeStack(initial: ViewScope): ScopeStack {
  let base = initial;
  // Each entry is its own object, so a handle finds its entry when another
  // entry holds the same scope.
  const pushed: { scope: ViewScope }[] = [];
  const listeners: ((scope: ViewScope) => void)[] = [];
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

  return {
    setBase(scope) {
      changing(() => {
        base = scope;
      });
    },
    push(scope) {
      const entry = { scope };
      changing(() => pushed.push(entry));
      return {
        pop() {
          const index = pushed.indexOf(entry);
          if (index === -1) {
            throw new Error(`Scope ${scope} was already popped`);
          }
          changing(() => pushed.splice(index, 1));
        },
      };
    },
    current,
    onChange(listener) {
      listeners.push(listener);
    },
  };
}
