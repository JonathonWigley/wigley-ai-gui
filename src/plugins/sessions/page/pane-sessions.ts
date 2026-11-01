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

// An activation the page sent main whose state has not come back yet.
export interface PendingEcho {
  sessionId: string;
}

// A state's selection change, against the echoes the page still waits for.
export interface SelectionChange {
  before: string | null;
  next: string | null;
  removed: readonly string[];
  // Two panes or more showed before the removed sessions' panes closed.
  wasSplit: boolean;
  // Oldest first.
  pendingEchoes: readonly PendingEcho[];
}

// What a state's selection does to the panes: nothing, place the session, or
// tell main the focused pane's session.
export type SelectionAction =
  | { kind: 'keep' }
  | { kind: 'place'; sessionId: string }
  | { kind: 'tellFocused' };

// A selection that answers a pending echo keeps the panes and drops that echo
// with every older one, since main answers activations in order. Otherwise a
// changed selection is placed, except main's pick after the selected session
// left a split: main is told the focused pane's session instead, so the panes
// left keep theirs.
export function selectionAction(change: SelectionChange): {
  action: SelectionAction;
  echoes: PendingEcho[];
} {
  const { before, next, removed, wasSplit, pendingEchoes } = change;
  const answered = pendingEchoes.findIndex((echo) => echo.sessionId === next);
  if (next !== null && answered !== -1) {
    return {
      action: { kind: 'keep' },
      echoes: pendingEchoes.slice(answered + 1),
    };
  }
  const echoes = [...pendingEchoes];
  if (next === null || next === before) {
    return { action: { kind: 'keep' }, echoes };
  }
  const isFallbackPick = before !== null && removed.includes(before);
  if (isFallbackPick && wasSplit) {
    return { action: { kind: 'tellFocused' }, echoes };
  }
  return { action: { kind: 'place', sessionId: next }, echoes };
}
