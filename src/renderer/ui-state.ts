import type { UiState } from '../contracts/ui-state';
import { callEach } from '../shared/call-each';

// The page's copy of the ui state main saved, read once at start. Each
// `scoped(prefix)` reads and writes the keys `<prefix>.<key>`; a set changes
// the page's copy at once, hands the qualified key to `write`, which saves
// it in main, and calls the key's `on` listeners. A get returns, and a set
// stores, a copy, so a caller mutating a value never changes the page's copy
// without a write.
export function createPageUiState(
  snapshot: Record<string, unknown>,
  write: (key: string, value: unknown) => void,
): { scoped(prefix: string): UiState } {
  const values = new Map(Object.entries(snapshot));
  const listeners = new Map<string, Set<() => void>>();
  return {
    scoped: (prefix) => ({
      get: (key) => structuredClone(values.get(`${prefix}.${key}`)),
      set(key, value) {
        const qualified = `${prefix}.${key}`;
        if (value === undefined) {
          values.delete(qualified);
        } else {
          values.set(qualified, structuredClone(value));
        }
        write(qualified, value);
        callEach([...(listeners.get(qualified) ?? [])], (listener) =>
          listener(),
        );
      },
      on(key, listener) {
        const qualified = `${prefix}.${key}`;
        const keyListeners = listeners.get(qualified) ?? new Set();
        listeners.set(qualified, keyListeners);
        keyListeners.add(listener);
        return {
          dispose() {
            keyListeners.delete(listener);
          },
        };
      },
    }),
  };
}
