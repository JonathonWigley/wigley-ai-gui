import type { SessionRow } from '../contract';

// Each chat pane's id and the app session id it shows, null for an empty pane.
export type PaneSessions = ReadonlyMap<string, string | null>;

// Where picking a session acts: focus the pane already showing it, or load it
// into a pane and focus that pane.
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

// Where a selection main made acts: an activation target, or a load into a
// waiting pane that ends its wait.
export type SelectionTarget =
  | ActivationTarget
  | { kind: 'loadEndingWait'; paneId: string };

// A waiting pane counts as occupied, so it is never a load target: the pane
// showing `sessionId` takes focus; else the session loads into the focused
// pane, or, when that pane waits, into the first pane in map order that does
// not. When every pane waits, it loads into the focused pane, ending its wait.
export function selectionTarget(
  panes: PaneSessions,
  focusedPaneId: string,
  sessionId: string,
  waiting: PaneWaits,
): SelectionTarget {
  const target = activationTarget(panes, focusedPaneId, sessionId);
  if (target.kind === 'focus' || !waiting.has(focusedPaneId)) {
    return target;
  }
  for (const paneId of panes.keys()) {
    if (!waiting.has(paneId)) {
      return { kind: 'load', paneId };
    }
  }
  return { kind: 'loadEndingWait', paneId: focusedPaneId };
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

// Each restored pane's id and the host session id it waits for: main does
// not hold that session yet, so the pane stays empty until a state brings it.
export type PaneWaits = ReadonlyMap<string, string>;

// Each saved pane (pane id to host session id) with the app session id of the
// first row holding that host session id; null when no row does or none was
// saved.
function restorePanes(
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

// What the first state does with the saved panes: one pane holding main's
// selection (`fallback`), or the saved tree with each pane's session, the
// panes that wait, and the panes saved empty, which close.
export type RestorePlan =
  | { kind: 'fallback' }
  | {
      kind: 'restore';
      sessions: Map<string, string | null>;
      waiting: Map<string, string>;
      closing: string[];
    };

// A saved pane whose session `rows` hold shows it, one whose session they lack
// waits for it, and one saved empty closes. Falls back when nothing valid was
// saved (`saved` null) or no saved pane names a session.
export function restorePlan(
  saved: ReadonlyMap<string, string | null> | null,
  rows: readonly SessionRow[],
): RestorePlan {
  if (saved === null) {
    return { kind: 'fallback' };
  }
  const sessions = restorePanes(saved, rows);
  const waiting = new Map<string, string>();
  const closing: string[] = [];
  for (const [paneId, hostId] of saved) {
    if (sessions.get(paneId) !== null) {
      continue;
    }
    if (hostId === null) {
      closing.push(paneId);
    } else {
      waiting.set(paneId, hostId);
    }
  }
  const namesASession = [...saved.values()].some((hostId) => hostId !== null);
  return namesASession
    ? { kind: 'restore', sessions, waiting, closing }
    : { kind: 'fallback' };
}

// The waits a state's `rows` settle: every waiting pane whose session arrived
// (`ended`), and those of them that load it (`loads`, pane id and session id).
// A pane whose session another pane already shows, or an earlier pane in this
// plan loads, stays empty.
export function fillPlan(
  waiting: PaneWaits,
  rows: readonly SessionRow[],
  panes: PaneSessions,
): { ended: string[]; loads: [string, string][] } {
  const shown = new Set(panes.values());
  const ended: string[] = [];
  const loads: [string, string][] = [];
  for (const [paneId, sessionId] of restorePanes(waiting, rows)) {
    if (sessionId === null) {
      continue;
    }
    ended.push(paneId);
    if (!shown.has(sessionId)) {
      shown.add(sessionId);
      loads.push([paneId, sessionId]);
    }
  }
  return { ended, loads };
}

// The waits that still hold: those of panes still open and still empty.
export function liveWaits(
  waiting: PaneWaits,
  panes: PaneSessions,
): Map<string, string> {
  return new Map([...waiting].filter(([paneId]) => panes.get(paneId) === null));
}

// What the panes save, pane id to host session id: a pane showing a session
// saves its row's host session id, a waiting pane the one it waits for, so a
// relaunch before that session comes back keeps it; null otherwise.
export function savedPaneSessions(
  panes: PaneSessions,
  waiting: PaneWaits,
  rows: readonly SessionRow[],
): Record<string, string | null> {
  const saved: Record<string, string | null> = {};
  for (const [paneId, sessionId] of panes) {
    saved[paneId] =
      sessionId === null
        ? (waiting.get(paneId) ?? null)
        : (rows.find((row) => row.sessionId === sessionId)?.hostSessionId ??
          null);
  }
  return saved;
}

// An activation the page sent main whose state has not come back yet.
export interface PendingEcho {
  sessionId: string;
}

// The echoes left once main replied to the activation that recorded `echo`,
// null when it recorded none. The reply can reach the page ahead of the state
// main sent, so only a reply saying main sent none (an unknown session) drops
// the echo.
export function echoesAfterReply(
  pendingEchoes: readonly PendingEcho[],
  echo: PendingEcho | null,
  sentState: boolean,
): PendingEcho[] {
  return sentState
    ? [...pendingEchoes]
    : pendingEchoes.filter((pending) => pending !== echo);
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

// What the page holds as a release focuses the pane its press began in.
export interface PressedPaneFacts {
  // A selection that is not collapsed is anchored in the pressed pane.
  hasSelectionInPane: boolean;
  // The element holding keyboard focus sits inside the pressed pane.
  isFocusInPane: boolean;
  // The element holding keyboard focus takes typed text.
  doesFocusTakeText: boolean;
  // The pressed pane's visible tab is a Chat tab, whose text box is its box.
  isChatTabShown: boolean;
}

// Where that release sends the keys: `keep` leaves them where the press put
// them; `toBox` has whatever holds focus let go, and the pane's Chat box, when
// its visible tab has one, take them in insert mode.
export type PressedFocusAction = 'keep' | 'toBox';

// A selection in the pane stays, and so does the focus it came with. A text
// box the press focused keeps the keys, the Chat box going through `toBox` to
// enter insert mode at its caret. Any other focus, or one outside the pane,
// lets go.
export function pressedFocusAction(
  facts: PressedPaneFacts,
): PressedFocusAction {
  const {
    hasSelectionInPane,
    isFocusInPane,
    doesFocusTakeText,
    isChatTabShown,
  } = facts;
  const isOnTextBoxInPane = isFocusInPane && doesFocusTakeText;
  return hasSelectionInPane || (isOnTextBoxInPane && !isChatTabShown)
    ? 'keep'
    : 'toBox';
}
