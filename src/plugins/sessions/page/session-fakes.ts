import type { UiState } from '../../../contracts/ui-state';
import { sessionRow } from '../contract.test-support';

// A uiState over a map holding `entries`.
export function fakeUiState(entries: [string, unknown][] = []): UiState {
  const values = new Map(entries);
  return {
    get: (key) => values.get(key),
    set: (key, value) => values.set(key, value),
  };
}

// A row whose host session id is `host-<sessionId>`.
export const hostRow = (sessionId: string) =>
  sessionRow(sessionId, { hostSessionId: `host-${sessionId}` });

// Saved panes `a` and `b` side by side, showing `s1` and `s2`.
export function savedSplit(focusedId: 'a' | 'b'): UiState {
  return fakeUiState([
    [
      'panes',
      {
        tree: {
          focusedId,
          root: {
            kind: 'split',
            axis: 'row',
            ratio: 0.5,
            first: { kind: 'leaf', id: 'a' },
            second: { kind: 'leaf', id: 'b' },
          },
        },
        sessions: { a: 'host-s1', b: 'host-s2' },
      },
    ],
  ]);
}
