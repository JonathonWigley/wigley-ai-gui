import type { UiState } from '../../../contracts/ui-state';

// A uiState over a map holding `entries`.
export function fakeUiState(entries: [string, unknown][] = []): UiState {
  const values = new Map(entries);
  return {
    get: (key) => values.get(key),
    set: (key, value) => values.set(key, value),
  };
}
