import { element } from '../../../shared/page/dom';
import type { DrawnPart } from '../../../shared/page/layout-host/draw-part';
import { rowAction } from '../../../shared/page/ui/row';
import type { SessionRow, SessionsState } from '../contract';
import type { SessionsPart } from '../layouts/layout';
import type { DrawnSideBar, SessionsParts } from './layout/sessions-parts';
import { harnessText, hasOtherSession } from './tabs';

export interface SidebarView {
  // The side bar's host, which the shell holds; it lays out the drawn pane as
  // its own child.
  element: HTMLElement;
  // Draws the side bar pane again with the parts' current layouts, dropping
  // its rows; `render` then draws them.
  redrawPane(): void;
  // `statusOf` reads a session's second line, null for none.
  render(
    state: SessionsState | null,
    statusOf: (sessionId: string) => string | null,
  ): void;
}

// Sessions mode's side bar, drawn through the sessions layout: the `sideBar`
// pane (a "Sessions" header holding the previous and next session prompts,
// hidden while no other session is there to move to) over one `row` per
// session in main's order. The view keeps each row's click, which activates
// its session, its tooltip, and the selected row's mark.
export function mountSidebarView(
  activate: (sessionId: string) => void,
  parts: SessionsParts,
): SidebarView {
  const host = element('div', 'session-side-host');
  host.style.display = 'contents';
  // The prompt stays hidden until `render` hands it a state.
  const drawPane = (): DrawnPart<DrawnSideBar> => {
    host.replaceChildren();
    const drawn = parts.sideBar(host);
    drawn.built.sessionEdge?.classList.add('is-no-target');
    return drawn;
  };
  let pane = drawPane();
  let rows: DrawnPart<SessionsPart>[] = [];

  const disposeRows = () => {
    for (const row of rows) {
      row.dispose();
    }
    rows = [];
  };

  return {
    element: host,
    redrawPane() {
      disposeRows();
      pane.dispose();
      pane = drawPane();
    },
    render(state, statusOf) {
      const selectedSessionId = state?.selectedSessionId ?? null;
      pane.built.sessionEdge?.classList.toggle(
        'is-no-target',
        state === null || !hasOtherSession(state),
      );
      disposeRows();
      const list = pane.built.rows;
      list.replaceChildren();
      rows = (state?.rows ?? []).map((session) =>
        drawRow(
          parts,
          list,
          session,
          session.sessionId === selectedSessionId,
          statusOf(session.sessionId),
          activate,
        ),
      );
    },
  };
}

function drawRow(
  parts: SessionsParts,
  list: HTMLElement,
  session: SessionRow,
  isSelected: boolean,
  status: string | null,
  activate: (sessionId: string) => void,
): DrawnPart<SessionsPart> {
  const drawn = parts.row(list, {
    sessionId: session.sessionId,
    label: session.label,
    harness: harnessText(session.harness),
    marked: session.marked,
    status,
  });
  const entry = drawn.built.element;
  rowAction(entry, () => activate(session.sessionId));
  entry.title =
    status === null ? session.label : `${session.label} · ${status}`;
  entry.classList.toggle('is-selected', isSelected);
  if (isSelected) {
    entry.setAttribute('aria-current', 'true');
  }
  return drawn;
}
