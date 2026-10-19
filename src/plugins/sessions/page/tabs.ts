import type { SessionsState, SessionView } from '../contract';

// The session `step` tabs away from the active one, wrapping at both ends, as
// vim's `gt` does; null with no active tab or fewer than two tabs.
export function stepTab(state: SessionsState, step: 1 | -1): string | null {
  const { tabs } = state;
  const position = tabs.findIndex(
    (tab) => tab.sessionId === state.activeSessionId,
  );
  if (position < 0 || tabs.length < 2) {
    return null;
  }
  return tabs[(position + step + tabs.length) % tabs.length].sessionId;
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

// Asks each view in order whether its tab may close, stopping at the first
// that says no.
export function mayClose(
  views: readonly Pick<SessionView, 'beforeClose'>[],
): boolean {
  return views.every((view) => view.beforeClose());
}
