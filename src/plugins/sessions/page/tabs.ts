import type { SessionsState, SessionView } from '../contract';

// The session `step` rows away from the selected one, wrapping at both ends,
// as vim's `gt` does; null with no selected row or fewer than two rows.
export function stepTab(state: SessionsState, step: 1 | -1): string | null {
  const { rows } = state;
  const position = rows.findIndex(
    (row) => row.sessionId === state.selectedSessionId,
  );
  if (position < 0 || rows.length < 2) {
    return null;
  }
  return rows[(position + step + rows.length) % rows.length].sessionId;
}

// A tab's text: its label, then the title of what fills it, when there is one.
export function tabText(label: string, title: string | null): string {
  return title === null || title === '' ? label : `${label} · ${title}`;
}

// A tab's title: the last non-empty title among its session's fills, in fill
// order, or null.
export function tabTitle(fillTitles: readonly string[]): string | null {
  return fillTitles.findLast((title) => title !== '') ?? null;
}

// Whether a session's pane stays: it does while the session has a tab or a
// fill, so a fill that arrives before its tab already has its pane.
export function keepsPane(hasTab: boolean, fillCount: number): boolean {
  return hasTab || fillCount > 0;
}

// Whether a session's pane shows its idle text: only while nothing fills it.
export function showsIdleText(fillCount: number): boolean {
  return fillCount === 0;
}

// Whether the page shows its "No sessions" text: only once main's state has
// arrived (null until then) and it holds no row.
export function showsEmptyText(state: SessionsState | null): boolean {
  return state !== null && state.rows.length === 0;
}

// Asks each view in order whether its tab may close, stopping at the first
// that says no.
export function mayClose(
  views: readonly Pick<SessionView, 'beforeClose'>[],
): boolean {
  return views.every((view) => view.beforeClose());
}
