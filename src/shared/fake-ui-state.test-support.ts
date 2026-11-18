import type { UiState } from '../contracts/ui-state';
import { callEach } from './call-each';

// A uiState over `values`, notifying `on` listeners as the page store does:
// `set(key, undefined)` deletes the key, and `onSet` runs after each set,
// before the key's listeners.
export function uiStateOver(
  values: Map<string, unknown>,
  onSet?: (key: string, value: unknown) => void,
): UiState {
  const listeners = new Map<string, Set<() => void>>();
  return {
    get: (key) => values.get(key),
    set(key, value) {
      if (value === undefined) {
        values.delete(key);
      } else {
        values.set(key, value);
      }
      onSet?.(key, value);
      callEach([...(listeners.get(key) ?? [])], (listener) => listener());
    },
    on(key, listener) {
      const keyListeners = listeners.get(key) ?? new Set();
      listeners.set(key, keyListeners);
      keyListeners.add(listener);
      return {
        dispose() {
          keyListeners.delete(listener);
        },
      };
    },
  };
}
