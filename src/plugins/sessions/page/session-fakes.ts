import type { UiState } from '../../../contracts/ui-state';
import type { SessionRow } from '../contract';

export function sessionRow(sessionId: string): SessionRow {
  return {
    sessionId,
    label: `label ${sessionId}`,
    project: 'project',
    harness: 'claude',
    marked: false,
    markToast: null,
    projectDir: null,
    hostSessionId: null,
    titles: { user: null, agent: null, firstMessage: null },
  };
}

// A uiState over a map holding `entries`.
export function fakeUiState(entries: [string, unknown][] = []): UiState {
  const values = new Map(entries);
  return {
    get: (key) => values.get(key),
    set: (key, value) => values.set(key, value),
  };
}
