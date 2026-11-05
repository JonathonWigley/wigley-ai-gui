import type { Timers } from '../../../contracts/ambient';
import { element } from '../../../shared/page/dom';
import type { DrawnPart } from '../../../shared/page/layout-host/draw-part';
import {
  createDragReorder,
  type ReorderDrop,
} from '../../../shared/page/ui/drag-reorder';
import { rowAction } from '../../../shared/page/ui/row';
import type { RowActivity, SessionRow, SessionsState } from '../contract';
import type {
  SectionInput,
  SectionPane,
  SessionsPart,
} from '../layouts/layout';
import type {
  DrawnGroup,
  DrawnSideBar,
  SessionsParts,
} from './layout/sessions-parts';
import {
  drawnRows,
  type SidebarGroup,
  type SidebarSections,
} from './sidebar-order';
import { harnessText, hasOtherSession } from './tabs';

// What a row draws beside its session: its shown title, its activity and its
// second line, each null for none, and whether its session shows in a pane
// other than the focused one.
export interface RowState {
  title: string | null;
  activity: RowActivity | null;
  status: string | null;
  onScreen: boolean;
}

// What the side bar's clicks and drops ask for; the view owns what they mean.
// `dropped`'s zone is a section's kind, and `shownFavorites` the Favorites
// section's projects as drawn, the dragged one included.
export interface SidebarEvents {
  activate(sessionId: string): void;
  toggleFavorite(project: string): void;
  dropped(drop: ReorderDrop, shownFavorites: readonly string[]): void;
}

export interface SidebarView {
  // The side bar's host, which the shell holds; it lays out the drawn pane as
  // its own child.
  element: HTMLElement;
  // Draws the side bar pane again with the parts' current layouts, dropping
  // its rows and ending any drag; `render` then draws them.
  redrawPane(): void;
  // Disposes the rows and the pane and ends any drag; a held draw never runs.
  dispose(): void;
  // `sections` are the rows to draw, in order; `rowStateOf` reads what a
  // session's row draws; `skip` holds the sessions a session step passes over,
  // which decide whether its prompts show. While a drag runs the last call
  // waits, and draws once the drag ends.
  render(
    state: SessionsState | null,
    sections: SidebarSections<SessionRow>,
    rowStateOf: (row: SessionRow) => RowState,
    skip: ReadonlySet<string>,
  ): void;
}

type SectionKind = SectionInput['kind'];

const SECTION_TEXT: Record<SectionKind, { label: string; dropHint: string }> = {
  favorites: {
    label: 'Favorites',
    dropHint: 'Drop a project here to favorite it',
  },
  recent: { label: 'Recent', dropHint: 'Drop a project here to unfavorite it' },
};

// Sessions mode's side bar, drawn through the sessions layout: the `sideBar`
// pane (a "Sessions" header holding the previous and next session prompts,
// hidden while no session a step reaches is there to move to) over the
// Favorites and Recent `section`s, each holding a `group` per project over its
// `row`s. The rows box carries `has-favorites` while Favorites holds a group,
// and `is-reordering` while a group header drags. The view keeps each row's
// click, which activates its session, its tooltip, the selected row's mark,
// each star's click and each header's tooltip and drag.
export function mountSidebarView(
  events: SidebarEvents,
  parts: SessionsParts,
  timers: Timers,
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
  let groups: DrawnPart<DrawnGroup>[] = [];
  let sections: DrawnPart<SectionPane>[] = [];
  let shownFavorites: string[] = [];
  // The draw a running drag holds back, the last asked for.
  let heldDraw: (() => void) | null = null;
  // The tick that sets `is-reordering`: a `dragstart` that changes layout can
  // cancel its drag in Chromium.
  let reorderingTimer: number | null = null;

  const dragReorder = createDragReorder({
    dropped: (drop) => events.dropped(drop, shownFavorites),
    started() {
      reorderingTimer = timers.set(() => {
        reorderingTimer = null;
        pane.built.rows.classList.add('is-reordering');
      }, 0);
    },
    ended() {
      if (reorderingTimer !== null) {
        timers.clear(reorderingTimer);
        reorderingTimer = null;
      }
      pane.built.rows.classList.remove('is-reordering');
      const draw = heldDraw;
      heldDraw = null;
      draw?.();
    },
  });

  const disposeRows = () => {
    for (const drawn of [...rows, ...groups, ...sections]) {
      drawn.dispose();
    }
    rows = [];
    groups = [];
    sections = [];
    dragReorder.clear();
  };

  const drawGroup = (
    parent: HTMLElement,
    kind: SectionKind,
    group: SidebarGroup<SessionRow>,
    selectedSessionId: string | null,
    rowStateOf: (row: SessionRow) => RowState,
  ) => {
    const { project, isFavorite } = group;
    const drawn = parts.group(parent, {
      project,
      count: group.rows.length,
      isFavorite,
    });
    groups.push(drawn);
    drawn.built.header.title = project;
    drawn.built.favoriteToggle?.addEventListener('click', () =>
      events.toggleFavorite(project),
    );
    dragReorder.item(drawn.built.element, drawn.built.header, project, kind);
    for (const session of group.rows) {
      rows.push(
        drawRow(
          parts,
          drawn.built.rows,
          session,
          session.sessionId === selectedSessionId,
          rowStateOf(session),
          events.activate,
        ),
      );
    }
  };

  const drawSection = (
    kind: SectionKind,
    sectionGroups: readonly SidebarGroup<SessionRow>[],
    selectedSessionId: string | null,
    rowStateOf: (row: SessionRow) => RowState,
  ) => {
    const drawn = parts.section(pane.built.rows, {
      kind,
      ...SECTION_TEXT[kind],
      isEmpty: sectionGroups.length === 0,
    });
    sections.push(drawn);
    dragReorder.zone(drawn.built.groups, kind, {
      ordered: kind === 'favorites',
    });
    for (const group of sectionGroups) {
      drawGroup(drawn.built.groups, kind, group, selectedSessionId, rowStateOf);
    }
  };

  return {
    element: host,
    redrawPane() {
      heldDraw = null;
      disposeRows();
      pane.dispose();
      pane = drawPane();
    },
    dispose() {
      heldDraw = null;
      disposeRows();
      pane.dispose();
    },
    render(state, nextSections, rowStateOf, skip) {
      const draw = () => {
        const selectedSessionId = state?.selectedSessionId ?? null;
        pane.built.sessionEdge?.classList.toggle(
          'is-no-target',
          state === null ||
            !hasOtherSession({ ...state, rows: drawnRows(nextSections) }, skip),
        );
        disposeRows();
        const list = pane.built.rows;
        list.replaceChildren();
        list.classList.toggle(
          'has-favorites',
          nextSections.favorites.length > 0,
        );
        shownFavorites = nextSections.favorites.map((group) => group.project);
        drawSection(
          'favorites',
          nextSections.favorites,
          selectedSessionId,
          rowStateOf,
        );
        drawSection(
          'recent',
          nextSections.recent,
          selectedSessionId,
          rowStateOf,
        );
      };
      if (dragReorder.isDragging()) {
        heldDraw = draw;
        return;
      }
      draw();
    },
  };
}

function drawRow(
  parts: SessionsParts,
  list: HTMLElement,
  session: SessionRow,
  isSelected: boolean,
  { title, activity, status, onScreen }: RowState,
  activate: (sessionId: string) => void,
): DrawnPart<SessionsPart> {
  const drawn = parts.row(list, {
    sessionId: session.sessionId,
    title,
    label: session.label,
    harness: harnessText(session.harness),
    marked: session.marked && !isSelected,
    activity:
      activity === null
        ? null
        : {
            word: activity.word,
            tone: activity.tone,
            emphasis: activity.emphasis ?? null,
          },
    status,
    onScreen,
  });
  const entry = drawn.built.element;
  rowAction(entry, () => activate(session.sessionId));
  entry.title = [title, session.label, activity?.word ?? null, status]
    .filter((part) => part !== null)
    .join(' · ');
  entry.classList.toggle('is-selected', isSelected);
  if (isSelected) {
    entry.setAttribute('aria-current', 'true');
  }
  return drawn;
}
