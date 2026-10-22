import { element } from '../../../shared/page/dom';
import { row } from '../../../shared/page/ui/row';
import { statusDot } from '../../../shared/page/ui/status-dot';
import type { SessionRow, SessionsState } from '../contract';
import { harnessText } from './tabs';

export interface SidebarView {
  element: HTMLElement;
  // `statusOf` reads a session's second line, null for none.
  render(
    state: SessionsState | null,
    statusOf: (sessionId: string) => string | null,
  ): void;
}

// Sessions mode's side bar: one row per session in main's order, each
// reading its label, its harness dimmed, an attention dot while a round waits
// unopened, all on a first line that never wraps, and its status on a second
// line; the selected row is marked, and clicking a row activates its session.
export function mountSidebarView(
  activate: (sessionId: string) => void,
): SidebarView {
  const sidebar = element('nav', 'session-sidebar');
  sidebar.setAttribute('aria-label', 'Sessions');
  return {
    element: sidebar,
    render(state, statusOf) {
      const selectedSessionId = state?.selectedSessionId ?? null;
      sidebar.replaceChildren(
        ...(state?.rows ?? []).map((session) =>
          buildRow(
            session,
            session.sessionId === selectedSessionId,
            statusOf(session.sessionId),
            activate,
          ),
        ),
      );
    },
  };
}

function buildRow(
  session: SessionRow,
  isSelected: boolean,
  status: string | null,
  activate: (sessionId: string) => void,
): HTMLElement {
  const entry = row({
    density: 'list',
    label: session.label,
    detail: harnessText(session.harness) || null,
    trailing: session.marked ? statusDot('attention') : null,
    onClick: () => activate(session.sessionId),
  });
  entry.classList.add('session-row');
  entry.title =
    status === null ? session.label : `${session.label} · ${status}`;
  entry.classList.toggle('is-selected', isSelected);
  if (isSelected) {
    entry.setAttribute('aria-current', 'true');
  }
  if (status !== null) {
    entry.append(element('span', 'session-row-status', status));
  }
  return entry;
}
