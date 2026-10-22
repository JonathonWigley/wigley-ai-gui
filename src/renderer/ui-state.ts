import type { UiState } from '../contracts/ui-state';

// The page's copy of the ui state main saved, read once at start. Each
// `scoped(prefix)` reads and writes the keys `<prefix>.<key>`; a set changes
// the page's copy at once and hands the qualified key to `write`, which saves
// it in main.
export function createPageUiState(
  snapshot: Record<string, unknown>,
  write: (key: string, value: unknown) => void,
): { scoped(prefix: string): UiState } {
  const values = new Map(Object.entries(snapshot));
  return {
    scoped: (prefix) => ({
      get: (key) => values.get(`${prefix}.${key}`),
      set(key, value) {
        const qualified = `${prefix}.${key}`;
        if (value === undefined) {
          values.delete(qualified);
        } else {
          values.set(qualified, value);
        }
        write(qualified, value);
      },
    }),
  };
}
