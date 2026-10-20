import { button, element } from '../../../shared/page/dom';
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

// Sessions mode's sidebar: one row per session in main's order, the selected
// one marked; clicking a row activates its session.
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
        ...(state?.rows ?? []).map((row) =>
          buildRow(
            row,
            row.sessionId === selectedSessionId,
            statusOf(row.sessionId),
            activate,
          ),
        ),
      );
    },
  };
}

function buildRow(
  row: SessionRow,
  isSelected: boolean,
  status: string | null,
  activate: (sessionId: string) => void,
): HTMLElement {
  const entry = button('session-row', '', () => activate(row.sessionId));
  entry.title = status === null ? row.label : `${row.label} · ${status}`;
  entry.classList.toggle('is-selected', isSelected);
  if (isSelected) {
    entry.setAttribute('aria-current', 'true');
  }
  const harness = harnessText(row.harness);
  const harnessElement = element('span', 'session-row-harness', harness);
  harnessElement.hidden = harness === '';
  const marker = element('span', 'session-row-marker', '●');
  marker.hidden = !row.marked;
  const firstLine = element('span', 'session-row-line');
  firstLine.append(
    element('span', 'session-row-label', row.label),
    harnessElement,
    marker,
  );
  const statusElement = element('span', 'session-row-status', status ?? '');
  statusElement.hidden = status === null;
  entry.append(firstLine, statusElement);
  return entry;
}
