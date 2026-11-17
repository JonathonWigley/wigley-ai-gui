import type { AgentHarnessInfo } from '../../../contracts/agent';
import type { Timers } from '../../../contracts/ambient';
import type { Disposable } from '../../../contracts/disposable';
import type { KeyHints } from '../../../contracts/plugin';
import { harnessLabel } from '../../../shared/agent-harness-label';
import { element } from '../../../shared/page/dom';
import type { DrawnPart } from '../../../shared/page/layout-host/draw-part';
import {
  createDragReorder,
  type ReorderDrop,
} from '../../../shared/page/ui/drag-reorder';
import { rowAction } from '../../../shared/page/ui/row';
import { qualify } from '../../../shared/plugin-manifests';
import type {
  RowActivity,
  SessionRow,
  SessionsState,
  SidebarSection,
} from '../contract';
import type {
  SectionInput,
  SectionPane,
  SessionsPart,
} from '../layouts/layout';
import { sessionsManifest } from '../manifest';
import type {
  DrawnGroup,
  DrawnSideBar,
  SessionsParts,
} from './layout/sessions-parts';
import {
  type ClaimedSection,
  drawnRows,
  type SidebarGroup,
  type SidebarSections,
} from './sidebar-order';
import { hasOtherSession } from './tabs';

// What a row draws beside its session: its shown title and its activity, each
// null for none, its row parts' tooltips, read at each draw and each time the
// pointer enters the row, and whether its session shows in a pane other than
// the focused one.
export interface RowState {
  title: string | null;
  activity: RowActivity | null;
  partTooltips(): string[];
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

// The side bar list's cursor: the row it sits on, null for none, and whether
// the list holds the keys, which rings and prompts that row.
export interface SidebarCursor {
  sessionId: string | null;
  hasKeys: boolean;
}

export interface SidebarView {
  // The side bar's host, which the shell holds; it lays out the drawn pane as
  // its own child.
  element: HTMLElement;
  // Draws the side bar pane again with the parts' current layouts, dropping
  // its rows and ending any drag; `render` then draws them.
  redrawPane(): void;
  // Disposes the rows, the pane and the cursor prompt's anchors and ends any
  // drag; a held draw never runs.
  dispose(): void;
  // `sections` are the rows to draw, in order; `rowStateOf` reads what a
  // session's row draws; `skip` holds the sessions a session step passes over,
  // which decide whether its prompts show; while the list holds the keys,
  // `cursor`'s row ends in the cursor prompt and carries `is-cursor`, and it
  // scrolls into view when the cursor moved or the keys just arrived. While a
  // drag runs the last call waits, and draws once the drag ends.
  render(
    state: SessionsState | null,
    sections: SidebarSections<SessionRow, SidebarSection>,
    rowStateOf: (row: SessionRow) => RowState,
    skip: ReadonlySet<string>,
    cursor: SidebarCursor,
  ): void;
  // Focuses the drawn pane's rows box, which the list's keys act in.
  focus(): void;
}

type SessionsCommand = keyof typeof sessionsManifest.commands;

// The cursor prompt on a favorite project's row, and on any other row.
const FAVORITE_ROW_ACTIONS: readonly [SessionsCommand, string][] = [
  ['listFavorite', 'unfavorite'],
  ['listMoveUp', 'up'],
  ['listMoveDown', 'down'],
  ['listRename', 'rename'],
  ['listClose', 'close'],
];
const OTHER_ROW_ACTIONS: readonly [SessionsCommand, string][] = [
  ['listFavorite', 'favorite'],
  ['listRename', 'rename'],
  ['listClose', 'close'],
];

// The cursor prompt `span.session-row-actions`, its keys firing in the
// `sessions.sidebar` scope; `anchors` receives the anchors it names.
function rowActionsElement(
  rowActions: readonly [SessionsCommand, string][],
  anchors: Disposable[],
  anchor: KeyHints['anchor'],
): HTMLElement {
  const actions = element('span', 'session-row-actions');
  for (const [command, label] of rowActions) {
    const node = element('span');
    anchors.push(
      anchor(node, qualify(sessionsManifest.id, command), {
        scope: qualify(sessionsManifest.id, 'sidebar'),
        label,
      }),
    );
    actions.append(node);
  }
  return actions;
}

// The kinds of the two sections that always draw.
type SectionKind = Exclude<SectionInput['kind'], 'plugin'>;

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
// `row`s, then a `section` per registered section that claimed a row, holding
// its `row`s directly, with its header part. The rows box carries
// `has-favorites` while Favorites holds a group, and `is-reordering` while a
// group header drags; it takes focus by script alone (`tabIndex` -1) while the
// list holds the keys, drawing no outline of its own. The view keeps each row's
// click, which activates its session, its tooltip, the selected row's mark, the
// cursor's ring and prompt (`s favorite  r rename  d close`, with `K up  J down`
// on a favorite project's row, named with `anchor`), each star's click and each
// header's tooltip and drag. A row names its harness by the label in
// `harnesses`, read at each draw.
export function mountSidebarView(
  events: SidebarEvents,
  parts: SessionsParts,
  timers: Timers,
  anchor: KeyHints['anchor'],
  harnesses: () => ReadonlyMap<string, AgentHarnessInfo>,
): SidebarView {
  const host = element('div', 'session-side-host');
  host.style.display = 'contents';
  // The anchors the cursor prompts name, for the view's life.
  const promptAnchors: Disposable[] = [];
  const favoritePrompt = rowActionsElement(
    FAVORITE_ROW_ACTIONS,
    promptAnchors,
    anchor,
  );
  const otherPrompt = rowActionsElement(
    OTHER_ROW_ACTIONS,
    promptAnchors,
    anchor,
  );
  // The prompt stays hidden until `render` hands it a state.

  // Whether `session`'s row is the cursor's while the list holds the keys, and
  // the prompt it ends in then: the favorite prompt on a favorite project's row.
  const promptOf = (
    cursor: SidebarCursor,
    session: SessionRow,
    isFavorite: boolean,
  ) => ({
    isPrompted: cursor.hasKeys && session.sessionId === cursor.sessionId,
    prompt: isFavorite ? favoritePrompt : otherPrompt,
  });
  const drawPane = (): DrawnPart<DrawnSideBar> => {
    host.replaceChildren();
    const drawn = parts.sideBar(host);
    drawn.built.sessionEdge?.classList.add('is-no-target');
    drawn.built.rows.tabIndex = -1;
    // The cursor's card draws the focus ring, so the rows box draws none.
    drawn.built.rows.style.outline = 'none';
    return drawn;
  };
  let pane = drawPane();
  let rows: DrawnPart<SessionsPart>[] = [];
  let groups: DrawnPart<DrawnGroup>[] = [];
  let sections: DrawnPart<SectionPane>[] = [];
  let shownFavorites: string[] = [];
  // The row last scrolled into view while the list held the keys, null while
  // it does not or since the pane was drawn again.
  let scrolledTo: string | null = null;
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
    cursor: SidebarCursor,
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
          null,
          events.activate,
          promptOf(cursor, session, isFavorite),
          harnesses,
        ),
      );
    }
  };

  const drawSection = (
    kind: SectionKind,
    sectionGroups: readonly SidebarGroup<SessionRow>[],
    selectedSessionId: string | null,
    rowStateOf: (row: SessionRow) => RowState,
    cursor: SidebarCursor,
  ) => {
    const drawn = parts.section(
      pane.built.rows,
      {
        kind,
        id: kind,
        ...SECTION_TEXT[kind],
        isEmpty: sectionGroups.length === 0,
      },
      null,
    );
    sections.push(drawn);
    dragReorder.zone(drawn.built.groups, kind, {
      ordered: kind === 'favorites',
    });
    for (const group of sectionGroups) {
      drawGroup(
        drawn.built.groups,
        kind,
        group,
        selectedSessionId,
        rowStateOf,
        cursor,
      );
    }
  };

  // A registered section: no drop zone, its rows straight in its box.
  const drawPluginSection = (
    { section, rows: sectionRows }: ClaimedSection<SessionRow, SidebarSection>,
    selectedSessionId: string | null,
    rowStateOf: (row: SessionRow) => RowState,
    cursor: SidebarCursor,
  ) => {
    const drawn = parts.section(
      pane.built.rows,
      {
        kind: 'plugin',
        id: section.id,
        label: section.label,
        dropHint: '',
        isEmpty: false,
      },
      section.header ?? null,
    );
    sections.push(drawn);
    for (const session of sectionRows) {
      rows.push(
        drawRow(
          parts,
          drawn.built.groups,
          session,
          session.sessionId === selectedSessionId,
          rowStateOf(session),
          section.id,
          events.activate,
          promptOf(cursor, session, shownFavorites.includes(session.project)),
          harnesses,
        ),
      );
    }
  };

  return {
    element: host,
    redrawPane() {
      heldDraw = null;
      scrolledTo = null;
      disposeRows();
      pane.dispose();
      pane = drawPane();
    },
    dispose() {
      heldDraw = null;
      disposeRows();
      pane.dispose();
      for (const promptAnchor of promptAnchors) {
        promptAnchor.dispose();
      }
    },
    focus: () => pane.built.rows.focus(),
    render(state, nextSections, rowStateOf, skip, cursor) {
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
          cursor,
        );
        drawSection(
          'recent',
          nextSections.recent,
          selectedSessionId,
          rowStateOf,
          cursor,
        );
        for (const claimed of nextSections.plugins) {
          drawPluginSection(claimed, selectedSessionId, rowStateOf, cursor);
        }
        if (cursor.hasKeys && cursor.sessionId !== scrolledTo) {
          rows
            .find((row) => row.built.element.classList.contains('is-cursor'))
            ?.built.element.scrollIntoView({ block: 'nearest' });
        }
        scrolledTo = cursor.hasKeys ? cursor.sessionId : null;
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
  { title, activity, partTooltips, onScreen }: RowState,
  section: string | null,
  activate: (sessionId: string) => void,
  { isPrompted, prompt }: { isPrompted: boolean; prompt: HTMLElement },
  harnesses: () => ReadonlyMap<string, AgentHarnessInfo>,
): DrawnPart<SessionsPart> {
  const drawn = parts.row(
    list,
    {
      sessionId: session.sessionId,
      title,
      label: session.label,
      harness:
        session.harness === null
          ? ''
          : harnessLabel(harnesses(), session.harness),
      marked: session.marked && !isSelected,
      activity:
        activity === null
          ? null
          : {
              word: activity.word,
              tone: activity.tone,
              emphasis: activity.emphasis ?? null,
            },
      onScreen,
      section,
      isPrompted,
    },
    prompt,
  );
  drawn.built.element.classList.toggle('is-cursor', isPrompted);
  const entry = drawn.built.element;
  rowAction(entry, () => activate(session.sessionId));
  const setTooltip = () => {
    entry.title = [
      title,
      session.label,
      activity?.word ?? null,
      ...partTooltips(),
    ]
      .filter((part) => part !== null)
      .join(' · ');
  };
  setTooltip();
  entry.addEventListener('pointerenter', setTooltip);
  entry.classList.toggle('is-selected', isSelected);
  if (isSelected) {
    entry.setAttribute('aria-current', 'true');
  }
  return drawn;
}
