import type { SessionRow } from './contract';

// A row of session `sessionId`, with `overrides` over its fields.
export function sessionRow(
  sessionId: string,
  overrides: Partial<SessionRow> = {},
): SessionRow {
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
    profileDir: null,
    ...overrides,
  };
}
