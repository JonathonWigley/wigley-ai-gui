import type { Timers } from '../../../contracts/ambient';
import {
  PANE_DIRECTIONS,
  type OuterPanes,
  type PaneDirection,
} from '../../../contracts/panes';
import type { KeyHints, ShownLayouts } from '../../../contracts/plugin';
import type { KeyedSlotWriter } from '../../../contracts/state';
import { callEach } from '../../../shared/call-each';
import type { PartStore } from '../../../shared/page/contributed-parts';
import { element } from '../../../shared/page/dom';
import {
  leafIds,
  type PaneTree,
  paneToward,
  type SplitAxis,
} from '../../../shared/page/pane-tree/pane-tree';
import { createPaneTreeView } from '../../../shared/page/pane-tree/pane-tree-view';
import {
  type RowActivity,
  type RowActivitySource,
  type SessionPart,
  type SessionRow,
  type SessionsState,
} from '../contract';
import type { Layout } from '../layouts/layout';
import { shownTitle, titleLimit } from '../session-title';
import {
  createSessionsParts,
  type SessionsParts,
  type SessionsPartsDeps,
} from './layout/sessions-parts';
import { type PaneSessions, shownElsewhere } from './pane-sessions';
import { PREVIEW_STATE, previewRowState, previewSections } from './preview';
import type { ProjectFavorites } from './project-favorites';
import { createRowActivities } from './row-activities';
import type { SessionRecency } from './session-recency';
import {
  mountSessionTabsView,
  type SessionTabsView,
} from './session-tabs-view';
import {
  cursorAfterDraw,
  type CursorMove,
  drawnRows,
  movedCursor,
  type SidebarSections,
  sidebarSections,
} from './sidebar-order';
import { mountSidebarView, type RowState } from './sidebar-view';
import { rowChanges, rowStatus, stepSession } from './tabs';

// `activate` runs on a row click; `isModeShown` reads whether Sessions mode
// shows; `tabsChanged` runs after any change to a session's tabs, their
// selection or their statuses; `keys` draws the session, tab and pane
// prompts; `timers` runs a pane divider's prompt linger; `panesChanged` runs
// after the pane tree or a pane's session changed, and `paneFocused` after
// focus moved to another pane, a press's release or outer pane key included,
// `panePressed` with the pane's slot after `paneFocused` when a release
// moved it, and `paneKeyFocused` after `paneFocused` when an outer pane key
// moved it; `cursorMoved` runs with the list cursor's new row (null for none)
// when a side bar draw moved the cursor off a row that left, or a row click
// moved it while the list holds the keys;
// `rowParts` are the parts each row draws, and adding or removing one draws
// the rows again; `barParts` are the parts each tab bar draws, and adding or
// removing one draws the tab bars again; `titleMaxLength` reads the setting
// each row draw cuts a first-message title to; `recency` and `favorites` order
// the side bar's rows; the rest is what the sessions layout's kits read.
export interface SessionsViewDeps extends Omit<
  SessionsPartsDeps,
  'keys' | 'rowParts' | 'barParts'
> {
  activate(sessionId: string): void;
  isModeShown(): boolean;
  tabsChanged(): void;
  keys: Pick<KeyHints, 'anchor' | 'keysFor'>;
  timers: Timers;
  panesChanged(): void;
  paneFocused(paneId: string): void;
  panePressed(pane: HTMLElement): void;
  paneKeyFocused(): void;
  cursorMoved(row: SessionRow | null): void;
  rowParts: PartStore<SessionPart>;
  barParts: PartStore<SessionPart>;
  titleMaxLength(): number;
  recency: SessionRecency;
  favorites: ProjectFavorites;
  // Writes `sessionsActivitySlot`, which holds the rows' activities.
  activities: KeyedSlotWriter<RowActivitySource[]>;
}

// The Sessions list: the side bar's rows as a keyboard pane, its cursor a
// session row apart from the selected one. `enter` gives the list the keys,
// the cursor on the selected row, else the first drawn row, the rows box
// focused, and returns the cursor's row; `leave` puts the cursor back on the
// selected row, takes the ring off and returns whether the list held the keys;
// `move` steps the cursor in drawn order (`movedCursor`) and returns its row;
// `cursorSessionId` reads the cursor's session, the selected one while the
// list does not hold the keys; `refocus` focuses the rows box again while the
// list holds the keys. Rows are null for none, and walk the preview's sample
// while it shows.
export interface SessionList {
  enter(): SessionRow | null;
  leave(): boolean;
  holdsKeys(): boolean;
  move(move: CursorMove): SessionRow | null;
  cursorSessionId(): string | null;
  refocus(): void;
}

// The chat panes and the session each shows. Each change draws the panes and
// the side bar again: the side bar's selected row is the focused pane's
// session, and a row shown in another pane carries its on-screen mark.
export interface SessionPanes {
  tree(): PaneTree;
  sessions(): PaneSessions;
  focusedPaneId(): string;
  // The focused pane's session; null for an empty pane.
  focusedSessionId(): string | null;
  // Shows `sessionId` in pane `paneId`, null emptying it; the frame it showed
  // waits in the holder.
  load(paneId: string, sessionId: string | null): void;
  focus(paneId: string): void;
  // Splits the focused pane, the new pane empty and focused; returns its id,
  // or null when the pane is too small to split.
  split(axis: SplitAxis): string | null;
  // Closes pane `paneId`; false for the last pane.
  close(paneId: string): boolean;
  // Swaps the focused pane with the pane toward `direction`, each keeping its
  // session; false at the edge.
  swap(direction: PaneDirection): boolean;
  // Draws `tree`, each leaf showing its session in `sessions` (none when left
  // out); runs no `paneFocused`.
  restore(tree: PaneTree, sessions: PaneSessions): void;
  outer: OuterPanes;
}

// `element` is the mode's root, the chat panes; `sideBar` is the mode's side
// bar, the session list's header over its rows; `list` is that list as a
// keyboard pane.
// `setLayouts` draws the side bar, panes and tab bars again with `shown`, then
// the rows, tabs and text from the state the view holds. `showPreview(true)`
// swaps the side bar's rows for the preview sample, whose selection a row
// click or `stepPreview` moves without activating anything; `false` draws the
// real rows again. `setActivity` sets a source's activity for a session, as
// `SessionsPageExports.setActivity` says, drawing the side bar again only when
// the row's shown activity changed; `render` drops the activities of the rows
// that left and hands the rows' changes to recency. `redrawRows` draws the side
// bar's rows again, for a changed title length. `orderedRows` lists main's rows
// in the order the side bar draws them, the preview's sample never among them.
// `toggleFavorite` and `moveFavorite` change the user's favorites, draw the
// side bar again and log the outcome; a star's click and a drop do the same.
// The preview never changes the favorites: while it shows, a star and a drop do
// nothing, and the two methods log `projects ignored` and do nothing. `parts`
// draws through the sessions layout the view's `setLayouts` sets, for the
// mode's dialogs. `dispose` ends a side bar drag and drops its rows, stops the
// pane tree watching its size and pointer and drops every frame.
export interface SessionsView {
  element: HTMLElement;
  sideBar: HTMLElement;
  parts: Pick<SessionsParts, 'renameDialog'>;
  tabs: SessionTabsView;
  panes: SessionPanes;
  list: SessionList;
  render(state: SessionsState): void;
  setLayouts(shown: ShownLayouts<Layout>): void;
  showPreview(isShown: boolean): void;
  isPreviewShown(): boolean;
  stepPreview(by: 1 | -1): void;
  setActivity(
    sessionId: string,
    sourceId: string,
    activity: RowActivity | null,
  ): void;
  redrawRows(): void;
  dispose(): void;
  orderedRows(): SessionRow[];
  toggleFavorite(project: string): void;
  moveFavorite(project: string, by: 1 | -1): void;
}

// Sessions mode's two parts: the side bar of session rows, which the shell
// draws in its side bar, and the root holding the chat panes. Each row's
// second line follows its tabs' statuses, and the list cursor's row ends in
// the cursor prompt. Both draw with `default` until the first `setLayouts`.
export function mountSessionsView(deps: SessionsViewDeps): SessionsView {
  const root = element('div', 'sessions');
  const parts = createSessionsParts(deps);
  // The preview sample while it shows, else null.
  let preview: SessionsState | null = null;
  const { favorites, recency } = deps;

  const toggleFavorite = (project: string) => {
    const isFavorite = favorites.toggle(project);
    drawSidebar();
    deps.log(`${isFavorite ? 'favorited' : 'unfavorited'} ${project}`);
  };

  // Whether the preview shows, logging that a project key did nothing.
  const isKeyIgnoredByPreview = () => {
    if (preview === null) {
      return false;
    }
    deps.log('projects ignored: the layout preview shows');
    return true;
  };

  const sidebar = mountSidebarView(
    {
      activate(sessionId) {
        if (cursor.hasKeys && cursor.sessionId !== sessionId) {
          cursor = { sessionId, hasKeys: true };
          drawSidebar();
          deps.cursorMoved(drawnRowOf(sessionId));
        }
        if (preview === null) {
          deps.activate(sessionId);
          return;
        }
        preview = { ...preview, selectedSessionId: sessionId };
        drawSidebar();
      },
      toggleFavorite(project) {
        if (preview === null) {
          toggleFavorite(project);
        }
      },
      dropped({ key: project, zone, index }, shownFavorites) {
        if (preview !== null) {
          return;
        }
        if (zone === 'favorites') {
          favorites.place(project, index, shownFavorites);
          drawSidebar();
          deps.log(`moved ${project} to favorites ${index}`);
        } else if (favorites.isFavorite(project)) {
          favorites.remove(project);
          drawSidebar();
          deps.log(`unfavorited ${project}`);
        }
      },
    },
    parts,
    deps.timers,
    deps.keys.anchor,
  );
  let state: SessionsState | null = null;
  // The list cursor while the list holds the keys; out of the list it sits on
  // the selected row, which each draw reads.
  let cursor: { sessionId: string | null; hasKeys: boolean } = {
    sessionId: null,
    hasKeys: false,
  };
  // The session ids the last side bar draw drew, in order.
  let drawnOrder: string[] = [];
  const activities = createRowActivities(deps.activities);
  const assigned = new Map<string, string | null>();
  let paneCount = 1;

  const realSections = () => {
    const rows = state?.rows ?? [];
    return sidebarSections(
      rows,
      favorites.list(),
      recency.stampsOf(rows),
      recency.projectStamps(),
    );
  };

  // What the side bar draws now: the preview's sample while it shows, else
  // main's rows with the focused pane's session selected.
  const sidebarDraw = (): {
    state: SessionsState | null;
    sections: SidebarSections<SessionRow>;
    rowStateOf: (row: SessionRow) => RowState;
    skip: ReadonlySet<string>;
  } => {
    const titleMax = titleLimit(deps.titleMaxLength());
    if (preview !== null) {
      return {
        state: preview,
        sections: previewSections(preview),
        rowStateOf: (row) => previewRowState(row, titleMax),
        skip: new Set(),
      };
    }
    const tree = treeView.tree();
    const elsewhere = shownElsewhere(assigned, tree.focusedId);
    return {
      state:
        state === null
          ? null
          : {
              ...state,
              selectedSessionId: assigned.get(tree.focusedId) ?? null,
            },
      sections: realSections(),
      rowStateOf: (row) => ({
        title: shownTitle(row.titles, titleMax),
        activity: activities.top(row.sessionId),
        status: rowStatus(tabs.statusesOf(row.sessionId)),
        onScreen: elsewhere.has(row.sessionId),
      }),
      skip: elsewhere,
    };
  };

  // The row the side bar draws for `sessionId`, null for none.
  const drawnRowOf = (sessionId: string | null) =>
    drawnRows(sidebarDraw().sections).find(
      (row) => row.sessionId === sessionId,
    ) ?? null;

  // Draws the side bar; while the list holds the keys, a cursor whose row
  // left moves by `cursorAfterDraw` and reports its new row.
  const drawSidebar = () => {
    const drawn = sidebarDraw();
    const rows = drawnRows(drawn.sections);
    const order = rows.map((row) => row.sessionId);
    let movedTo: SessionRow | null | undefined;
    if (cursor.hasKeys) {
      const next = cursorAfterDraw(drawnOrder, order, cursor.sessionId);
      if (next !== cursor.sessionId) {
        cursor = { sessionId: next, hasKeys: true };
        movedTo = rows.find((row) => row.sessionId === next) ?? null;
      }
    }
    drawnOrder = order;
    sidebar.render(drawn.state, drawn.sections, drawn.rowStateOf, drawn.skip, {
      sessionId: cursor.hasKeys
        ? cursor.sessionId
        : (drawn.state?.selectedSessionId ?? null),
      hasKeys: cursor.hasKeys,
    });
    if (movedTo !== undefined) {
      deps.cursorMoved(movedTo);
    }
  };

  const list: SessionList = {
    enter() {
      const drawn = sidebarDraw();
      const rows = drawnRows(drawn.sections);
      const selectedId = drawn.state?.selectedSessionId ?? null;
      const entry =
        rows.find((row) => row.sessionId === selectedId) ?? rows[0] ?? null;
      cursor = { sessionId: entry?.sessionId ?? null, hasKeys: true };
      drawSidebar();
      sidebar.focus();
      return entry;
    },
    leave() {
      if (!cursor.hasKeys) {
        return false;
      }
      cursor = { sessionId: null, hasKeys: false };
      drawSidebar();
      return true;
    },
    holdsKeys: () => cursor.hasKeys,
    move(by) {
      const sessionId = movedCursor(drawnOrder, cursor.sessionId, by);
      cursor = { ...cursor, sessionId };
      drawSidebar();
      return drawnRowOf(sessionId);
    },
    cursorSessionId: () =>
      cursor.hasKeys
        ? cursor.sessionId
        : (sidebarDraw().state?.selectedSessionId ?? null),
    refocus() {
      if (cursor.hasKeys) {
        sidebar.focus();
      }
    },
  };

  const drawPanes = () => {
    const tree = treeView.tree();
    tabs.place(
      leafIds(tree).map((id) => ({
        id,
        slot: treeView.slot(id),
        sessionId: assigned.get(id) ?? null,
      })),
      tree.focusedId,
      PANE_DIRECTIONS.filter(
        (direction) => paneToward(tree, tree.focusedId, direction) !== null,
      ),
    );
    drawSidebar();
  };

  const tabs = mountSessionTabsView({
    isModeShown: deps.isModeShown,
    keys: deps.keys,
    parts,
    changed() {
      drawSidebar();
      deps.tabsChanged();
    },
  });
  const treeView = createPaneTreeView({
    initialId: 'pane-1',
    anchor: (node, command) => deps.keys.anchor(node, command),
    timers: deps.timers,
    changed() {
      drawPanes();
      deps.panesChanged();
    },
    focused: (paneId) => deps.paneFocused(paneId),
    pressFocused: (paneId) => deps.panePressed(treeView.slot(paneId)),
    keyFocused: () => deps.paneKeyFocused(),
    leaving: (paneIds) => tabs.vacate(paneIds),
  });
  assigned.set('pane-1', null);
  root.append(treeView.element, tabs.holder);

  // A pane id no leaf holds.
  const newPaneId = () => {
    const taken = new Set(leafIds(treeView.tree()));
    let id = `pane-${++paneCount}`;
    while (taken.has(id)) {
      id = `pane-${++paneCount}`;
    }
    return id;
  };

  const panes: SessionPanes = {
    tree: () => treeView.tree(),
    sessions: () => assigned,
    focusedPaneId: () => treeView.tree().focusedId,
    focusedSessionId: () => assigned.get(treeView.tree().focusedId) ?? null,
    load(paneId, sessionId) {
      assigned.set(paneId, sessionId);
      drawPanes();
      deps.panesChanged();
    },
    focus: (paneId) => treeView.focus(paneId),
    split(axis) {
      const id = newPaneId();
      assigned.set(id, null);
      if (!treeView.split(axis, id)) {
        assigned.delete(id);
        return null;
      }
      return id;
    },
    close(paneId) {
      if (leafIds(treeView.tree()).length < 2) {
        return false;
      }
      assigned.delete(paneId);
      return treeView.close(paneId);
    },
    swap: (direction) => treeView.swap(direction),
    restore(tree, sessions) {
      assigned.clear();
      for (const id of leafIds(tree)) {
        assigned.set(id, sessions.get(id) ?? null);
      }
      treeView.restore(tree);
      drawPanes();
      deps.panesChanged();
    },
    outer: treeView.outer,
  };
  drawPanes();
  deps.rowParts.onChanged(() => drawSidebar());
  deps.barParts.onChanged(() => tabs.redrawBars());

  return {
    element: root,
    sideBar: sidebar.element,
    parts,
    tabs,
    panes,
    list,
    render(next) {
      const before = state?.rows ?? null;
      for (const sessionId of rowChanges(before ?? [], next.rows).removed) {
        activities.forget(sessionId);
      }
      recency.rowsChanged(before, next.rows);
      state = next;
      drawSidebar();
      tabs.render(next);
    },
    setLayouts(shown) {
      parts.setLayouts(shown);
      sidebar.redrawPane();
      drawSidebar();
      list.refocus();
      tabs.redrawPane();
    },
    showPreview(isShown) {
      preview = isShown ? PREVIEW_STATE : null;
      drawSidebar();
    },
    isPreviewShown: () => preview !== null,
    stepPreview(by) {
      if (preview === null) {
        return;
      }
      const sessionId = stepSession(
        { ...preview, rows: drawnRows(previewSections(preview)) },
        by,
        new Set(),
      );
      if (sessionId !== null) {
        preview = { ...preview, selectedSessionId: sessionId };
        drawSidebar();
      }
    },
    setActivity(sessionId, sourceId, activity) {
      if (activities.set(sessionId, sourceId, activity)) {
        drawSidebar();
      }
    },
    redrawRows: () => drawSidebar(),
    dispose() {
      callEach<() => void>(
        [
          () => sidebar.dispose(),
          () => treeView.dispose(),
          () => tabs.dropAll(),
        ],
        (step) => step(),
      );
    },
    orderedRows: () => drawnRows(realSections()),
    toggleFavorite(project) {
      if (!isKeyIgnoredByPreview()) {
        toggleFavorite(project);
      }
    },
    moveFavorite(project, by) {
      if (isKeyIgnoredByPreview()) {
        return;
      }
      const direction = by === -1 ? 'up' : 'down';
      if (!favorites.isFavorite(project)) {
        deps.log(`${project} is not a favorite`);
        return;
      }
      const shown = realSections().favorites.map((group) => group.project);
      if (!favorites.move(project, by, shown)) {
        deps.log(`${project} cannot move ${direction}`);
        return;
      }
      drawSidebar();
      deps.log(`moved ${project} ${direction}`);
    },
  };
}
