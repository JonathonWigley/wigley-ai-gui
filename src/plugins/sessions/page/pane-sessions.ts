import type { SessionRow } from '../contract';

// Each chat pane's id and the app session id it shows, null for an empty pane.
export type PaneSessions = ReadonlyMap<string, string | null>;

// Where picking a session acts: focus the pane already showing it, or load it
// into the focused pane.
export type ActivationTarget =
  | { kind: 'focus'; paneId: string }
  | { kind: 'load'; paneId: string };

// The first pane, in map order, that shows `sessionId`; null when none does.
export function paneOf(panes: PaneSessions, sessionId: string): string | null {
  for (const [paneId, paneSessionId] of panes) {
    if (paneSessionId === sessionId) {
      return paneId;
    }
  }
  return null;
}

// Focus on the pane showing `sessionId`, the focused pane included; else load
// it into the focused pane.
export function activationTarget(
  panes: PaneSessions,
  focusedPaneId: string,
  sessionId: string,
): ActivationTarget {
  const paneId = paneOf(panes, sessionId);
  return paneId === null
    ? { kind: 'load', paneId: focusedPaneId }
    : { kind: 'focus', paneId };
}

// The sessions every pane but the focused one shows.
export function shownElsewhere(
  panes: PaneSessions,
  focusedPaneId: string,
): Set<string> {
  const shown = new Set<string>();
  for (const [paneId, sessionId] of panes) {
    if (paneId !== focusedPaneId && sessionId !== null) {
      shown.add(sessionId);
    }
  }
  return shown;
}

// The panes, in map order, whose session is among `removedSessionIds`.
export function panesToClose(
  panes: PaneSessions,
  removedSessionIds: readonly string[],
): string[] {
  const removed = new Set(removedSessionIds);
  return [...panes]
    .filter(([, sessionId]) => sessionId !== null && removed.has(sessionId))
    .map(([paneId]) => paneId);
}

// The rows, in row order, whose session no pane shows.
export function pickerRows(
  rows: readonly SessionRow[],
  panes: PaneSessions,
): SessionRow[] {
  const shown = new Set(panes.values());
  return rows.filter((row) => !shown.has(row.sessionId));
}

// Each saved pane (pane id to host session id) with the app session id of the
// first row holding that host session id; null when no row does or none was
// saved.
export function restorePanes(
  saved: ReadonlyMap<string, string | null>,
  rows: readonly SessionRow[],
): Map<string, string | null> {
  const sessionIdByHostId = new Map<string, string>();
  for (const row of rows) {
    const { hostSessionId } = row;
    if (hostSessionId !== null && !sessionIdByHostId.has(hostSessionId)) {
      sessionIdByHostId.set(hostSessionId, row.sessionId);
    }
  }
  return new Map(
    [...saved].map(([paneId, hostSessionId]) => [
      paneId,
      hostSessionId === null
        ? null
        : (sessionIdByHostId.get(hostSessionId) ?? null),
    ]),
  );
}
