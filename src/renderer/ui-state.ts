import type { UiState } from '../contracts/ui-state';

// The page's copy of the ui state main saved, read once at start. Each
// `scoped(prefix)` reads and writes the keys `<prefix>.<key>`; a set changes
// the page's copy at once and hands the qualified key to `write`, which saves
// it in main. A get returns, and a set stores, a copy, so a caller mutating a
// value never changes the page's copy without a write.
export function createPageUiState(
  snapshot: Record<string, unknown>,
  write: (key: string, value: unknown) => void,
): { scoped(prefix: string): UiState } {
  const values = new Map(Object.entries(snapshot));
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
      },
    }),
  };
}
