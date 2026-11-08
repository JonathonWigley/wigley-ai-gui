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

// The session `step` rows away from the selected one, wrapping, over the rows
// not in `skip` (the selected row is never skipped); with none selected, the
// first such row for `1` and the last for `-1`. Null with no such rows, or
// with one that is selected.
export function stepSession(
  state: SessionsState,
  step: 1 | -1,
  skip: ReadonlySet<string>,
): string | null {
  const ids = state.rows
    .map((row) => row.sessionId)
    .filter((id) => id === state.selectedSessionId || !skip.has(id));
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

// Whether a session step over the rows not in `skip` moves anywhere, so its
// edge prompts show.
export function hasOtherSession(
  state: SessionsState,
  skip: ReadonlySet<string>,
): boolean {
  return stepSession(state, 1, skip) !== null;
}

// Whether a tab step moves anywhere, so its edge prompts show.
export function hasOtherTab(
  tabIds: readonly string[],
  selectedTabId: string | null,
): boolean {
  return stepTab(tabIds, selectedTabId, 1) !== null;
}

// A session's tab ids in strip order, and the selected one's id.
export interface TabsState {
  tabIds: readonly string[];
  selectedTabId: string | null;
}

export const NO_TABS: TabsState = {
  tabIds: [],
  selectedTabId: null,
};

// What a tab with no `order` sorts as: after every tab with one.
const NO_ORDER = Number.MAX_SAFE_INTEGER;

// The tabs with `tabId` added in strip order: by `orderOf` each id's `order`, lowest
// first, then the ids with none, a tie keeping add order. The first tab added selects
// itself. Throws when the session already has a tab with that id.
export function tabsAfterAdd(
  tabs: TabsState,
  sessionId: string,
  tabId: string,
  orderOf: (tabId: string) => number | undefined,
): TabsState {
  if (tabs.tabIds.includes(tabId)) {
    throw new Error(`Session ${sessionId} already has a tab "${tabId}"`);
  }
  const rank = (id: string) => orderOf(id) ?? NO_ORDER;
  return {
    ...tabs,
    tabIds: [...tabs.tabIds, tabId].sort((a, b) => rank(a) - rank(b)),
    selectedTabId: tabs.selectedTabId ?? tabId,
  };
}

// The tabs without `tabId`; removing the selected tab selects its right
// neighbour, else its left, else none.
export function tabsAfterRemove(tabs: TabsState, tabId: string): TabsState {
  const position = tabs.tabIds.indexOf(tabId);
  const tabIds = tabs.tabIds.filter((id) => id !== tabId);
  const selectedTabId =
    tabs.selectedTabId === tabId
      ? (tabIds[position] ?? tabIds[position - 1] ?? null)
      : tabs.selectedTabId;
  return { ...tabs, tabIds, selectedTabId };
}

// The tabs with `tabId` selected; the same value when that tab is absent or
// already selected.
export function tabsAfterSelect(tabs: TabsState, tabId: string): TabsState {
  const isUnchanged =
    !tabs.tabIds.includes(tabId) || tabs.selectedTabId === tabId;
  return isUnchanged ? tabs : { ...tabs, selectedTabId: tabId };
}

// A sidebar row's second line: the last non-empty status among its session's
// statuses, its tabs' in strip order then its popups', or null.
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

// The rows `after` holds that `before` did not, in `after`'s order; the ids
// of the rows `before` held that `after` does not, in `before`'s order; and
// the rows both hold whose `hostSessionId` differs, in `after`'s order.
export function rowChanges(
  before: readonly SessionRow[],
  after: readonly SessionRow[],
): { added: SessionRow[]; removed: string[]; changed: SessionRow[] } {
  const beforeHostIds = new Map(
    before.map((row) => [row.sessionId, row.hostSessionId]),
  );
  const afterIds = new Set(after.map((row) => row.sessionId));
  return {
    added: after.filter((row) => !beforeHostIds.has(row.sessionId)),
    removed: before
      .map((row) => row.sessionId)
      .filter((sessionId) => !afterIds.has(sessionId)),
    changed: after.filter(
      (row) =>
        beforeHostIds.has(row.sessionId) &&
        beforeHostIds.get(row.sessionId) !== row.hostSessionId,
    ),
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

// Asks each of the session's views whether it may close, stopping at the
// first that says no. `viewsNow` is read again after each answer, so a view
// added while one was asking (a form popup a round adds under chat's confirm)
// is asked too; each view is asked once.
export async function mayClose(
  viewsNow: () => readonly Pick<SessionTabView, 'beforeClose'>[],
): Promise<boolean> {
  const asked = new Set<Pick<SessionTabView, 'beforeClose'>>();
  for (
    let view = viewsNow().find((next) => !asked.has(next));
    view !== undefined;
    view = viewsNow().find((next) => !asked.has(next))
  ) {
    asked.add(view);
    if (!(await view.beforeClose())) {
      return false;
    }
  }
  return true;
}

// What Sessions mode shows: the top open popup of the focused pane's session,
// else that session's selected tab; `'none'` while the mode shows neither;
// null while the mode is hidden.
export type VisibleTab =
  | { kind: 'tab'; sessionId: string; tabId: string }
  | { kind: 'popup'; sessionId: string; popupId: string }
  | 'none'
  | null;

// `popupId` is the session's top open popup, null for none; it wins over the
// selected tab.
export function visibleTab(
  isModeShown: boolean,
  sessionId: string | null,
  tabId: string | null,
  popupId: string | null,
): VisibleTab {
  if (!isModeShown) {
    return null;
  }
  if (sessionId !== null && popupId !== null) {
    return { kind: 'popup', sessionId, popupId };
  }
  return sessionId !== null && tabId !== null
    ? { kind: 'tab', sessionId, tabId }
    : 'none';
}

export function isSameVisibleTab(a: VisibleTab, b: VisibleTab): boolean {
  if (
    typeof a === 'object' &&
    a !== null &&
    typeof b === 'object' &&
    b !== null
  ) {
    return a.sessionId === b.sessionId && surfaceId(a) === surfaceId(b);
  }
  return a === b;
}

// The visible surface's kind and id, so a tab and a popup sharing an id differ.
function surfaceId(visible: Exclude<VisibleTab, 'none' | null>): string {
  return visible.kind === 'tab'
    ? `tab:${visible.tabId}`
    : `popup:${visible.popupId}`;
}
