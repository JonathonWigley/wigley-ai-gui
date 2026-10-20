import type {
  Harness,
  SessionRow,
  SessionsState,
  SessionTabView,
} from '../contract';

// The id `step` places away from `selectedId` in `ids`, wrapping at both
// ends, as vim's `gt` does; with none selected, the first for `1` and the
// last for `-1`.
function stepFrom(
  ids: readonly string[],
  selectedId: string | null,
  step: 1 | -1,
): string | null {
  const position = ids.findIndex((id) => id === selectedId);
  if (position < 0) {
    return (step === 1 ? ids[0] : ids.at(-1)) ?? null;
  }
  return ids[(position + step + ids.length) % ids.length];
}

// The session `step` rows away from the selected one, wrapping; with none
// selected, the first row for `1` and the last for `-1`. Null with no rows,
// or with one row that is selected.
export function stepSession(state: SessionsState, step: 1 | -1): string | null {
  const ids = state.rows.map((row) => row.sessionId);
  const isOnlyRowSelected =
    ids.length === 1 && ids[0] === state.selectedSessionId;
  return isOnlyRowSelected
    ? null
    : stepFrom(ids, state.selectedSessionId, step);
}

// The tab `step` places away from the selected one, wrapping; with none
// selected, the first for `1` and the last for `-1`. Null under two tabs.
export function stepTab(
  tabIds: readonly string[],
  selectedTabId: string | null,
  step: 1 | -1,
): string | null {
  return tabIds.length < 2 ? null : stepFrom(tabIds, selectedTabId, step);
}

// A sidebar row's second line: the last non-empty status among its session's
// tabs, in tab-add order, or null.
export function rowStatus(statuses: readonly string[]): string | null {
  return statuses.findLast((status) => status !== '') ?? null;
}

// The harness as a row shows it; nothing when the relay did not say.
export function harnessText(harness: Harness | null): string {
  switch (harness) {
    case 'claude':
      return 'Claude';
    case 'codex':
      return 'Codex';
    case null:
      return '';
  }
}

// The toast for a round that arrived while Sessions mode is hidden; `keys`
// are the keys that show the mode, null when none are bound.
export function roundToastText(label: string, keys: string | null): string {
  return keys === null
    ? `Round from ${label}`
    : `Round from ${label} — ${keys} to answer`;
}

// The rows `after` holds that `before` did not, in `after`'s order, and the
// ids of the rows `before` held that `after` does not, in `before`'s order.
export function rowChanges(
  before: readonly SessionRow[],
  after: readonly SessionRow[],
): { added: SessionRow[]; removed: string[] } {
  const beforeIds = new Set(before.map((row) => row.sessionId));
  const afterIds = new Set(after.map((row) => row.sessionId));
  return {
    added: after.filter((row) => !beforeIds.has(row.sessionId)),
    removed: before
      .map((row) => row.sessionId)
      .filter((sessionId) => !afterIds.has(sessionId)),
  };
}

// Whether a selection change gets the round toast. Main selects a session on
// its own only through a round arriving with none selected, so only a move
// from none (`null`; `undefined` marks the first state) to a session, while
// Sessions mode is hidden, toasts.
export function isRoundToast(
  before: string | null | undefined,
  after: string | null,
  isModeShown: boolean,
): boolean {
  return before === null && after !== null && !isModeShown;
}

// Whether the page shows its "No sessions" text: only once main's state has
// arrived (null until then) and it holds no row.
export function showsEmptyText(state: SessionsState | null): boolean {
  return state !== null && state.rows.length === 0;
}

// Whether the page shows its "No session selected" text: once main's state
// has arrived, it holds rows and none is selected.
export function showsNoSelectionText(state: SessionsState | null): boolean {
  return (
    state !== null && state.rows.length > 0 && state.selectedSessionId === null
  );
}

// Asks each view in order whether its session may close, stopping at the
// first that says no.
export function mayClose(
  views: readonly Pick<SessionTabView, 'beforeClose'>[],
): boolean {
  return views.every((view) => view.beforeClose());
}

// What Sessions mode shows: the selected tab of the selected session; `'none'`
// while the mode shows no tab; null while the mode is hidden.
export type VisibleTab = { sessionId: string; tabId: string } | 'none' | null;

export function visibleTab(
  isModeShown: boolean,
  selectedSessionId: string | null,
  selectedTabId: string | null,
): VisibleTab {
  if (!isModeShown) {
    return null;
  }
  return selectedSessionId !== null && selectedTabId !== null
    ? { sessionId: selectedSessionId, tabId: selectedTabId }
    : 'none';
}

export function isSameVisibleTab(a: VisibleTab, b: VisibleTab): boolean {
  if (
    typeof a === 'object' &&
    a !== null &&
    typeof b === 'object' &&
    b !== null
  ) {
    return a.sessionId === b.sessionId && a.tabId === b.tabId;
  }
  return a === b;
}

// The sidebar's page-local state: hidden by the user while the window is
// wide, and open over the content while it is narrow (below 680 px).
export interface SidebarState {
  isHiddenWide: boolean;
  isOverlayOpen: boolean;
}

export type SidebarLayout = 'beside' | 'over' | 'hidden';

export const SIDEBAR_START: SidebarState = {
  isHiddenWide: false,
  isOverlayOpen: false,
};

export function sidebarLayout(
  state: SidebarState,
  isNarrow: boolean,
): SidebarLayout {
  if (isNarrow) {
    return state.isOverlayOpen ? 'over' : 'hidden';
  }
  return state.isHiddenWide ? 'hidden' : 'beside';
}

// The toggle key flips the hidden choice while wide and the overlay while
// narrow; the other field stays.
export function toggledSidebar(
  state: SidebarState,
  isNarrow: boolean,
): SidebarState {
  return isNarrow
    ? { ...state, isOverlayOpen: !state.isOverlayOpen }
    : { ...state, isHiddenWide: !state.isHiddenWide };
}

// The window widening ends the overlay; the user's hidden choice always
// stays.
export function sidebarAfterResize(
  state: SidebarState,
  isNarrow: boolean,
): SidebarState {
  return isNarrow ? state : { ...state, isOverlayOpen: false };
}
