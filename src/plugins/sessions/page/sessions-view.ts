import type { Timers } from '../../../contracts/ambient';
import {
  PANE_DIRECTIONS,
  type OuterPanes,
  type PaneDirection,
} from '../../../contracts/panes';
import type { ShownLayouts } from '../../../contracts/plugin';
import type { PartStore } from '../../../shared/page/contributed-parts';
import { element } from '../../../shared/page/dom';
import {
  leafIds,
  type PaneTree,
  paneToward,
  type SplitAxis,
} from '../../../shared/page/pane-tree/pane-tree';
import { createPaneTreeView } from '../../../shared/page/pane-tree/pane-tree-view';
import type { KeysPageExports } from '../../keys/contract';
import {
  type RowActivity,
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
import { drawnRows, sidebarSections } from './sidebar-order';
import { mountSidebarView } from './sidebar-view';
import { rowChanges, rowStatus, stepSession } from './tabs';

// `activate` runs on a row click; `isModeShown` reads whether Sessions mode
// shows; `tabsChanged` runs after any change to a session's tabs, their
// selection or their statuses; `keys` draws the session, tab and pane
// prompts; `timers` runs a pane divider's prompt linger; `panesChanged` runs
// after the pane tree or a pane's session changed, and `paneFocused` after
// focus moved to another pane, a pane tree press or outer pane key included;
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
  keys: Pick<KeysPageExports, 'anchor' | 'keysFor'>;
  timers: Timers;
  panesChanged(): void;
  paneFocused(paneId: string): void;
  rowParts: PartStore<SessionPart>;
  barParts: PartStore<SessionPart>;
  titleMaxLength(): number;
  recency: SessionRecency;
  favorites: ProjectFavorites;
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
// bar, the session list's header over its rows.
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
// mode's dialogs.
export interface SessionsView {
  element: HTMLElement;
  sideBar: HTMLElement;
  parts: Pick<SessionsParts, 'renameDialog'>;
  tabs: SessionTabsView;
  panes: SessionPanes;
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
  orderedRows(): SessionRow[];
  toggleFavorite(project: string): void;
  moveFavorite(project: string, by: 1 | -1): void;
}

// Sessions mode's two parts: the side bar of session rows, which the shell
// draws in its side bar, and the root holding the chat panes. Each row's
// second line follows its tabs' statuses. Both draw with `default` until the
// first `setLayouts`.
export function mountSessionsView(deps: SessionsViewDeps): SessionsView {
  const root = element('div', 'sessions');
  const parts = createSessionsParts(deps);
  // The preview sample while it shows, else null.
  let preview: SessionsState | null = null;
  const { favorites, recency } = deps;
  const logLine = (message: string) => deps.log('sessions', message);

  const toggleFavorite = (project: string) => {
    const isFavorite = favorites.toggle(project);
    drawSidebar();
    logLine(`${isFavorite ? 'favorited' : 'unfavorited'} ${project}`);
  };

  // Whether the preview shows, logging that a project key did nothing.
  const isKeyIgnoredByPreview = () => {
    if (preview === null) {
      return false;
    }
    logLine('projects ignored: the layout preview shows');
    return true;
  };

  const sidebar = mountSidebarView(
    {
      activate(sessionId) {
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
          logLine(`moved ${project} to favorites ${index}`);
        } else if (favorites.isFavorite(project)) {
          favorites.remove(project);
          drawSidebar();
          logLine(`unfavorited ${project}`);
        }
      },
    },
    parts,
    deps.timers,
  );
  let state: SessionsState | null = null;
  const activities = createRowActivities();
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

  const drawSidebar = () => {
    const titleMax = titleLimit(deps.titleMaxLength());
    if (preview !== null) {
      sidebar.render(
        preview,
        previewSections(preview),
        (row) => previewRowState(row, titleMax),
        new Set(),
      );
      return;
    }
    const tree = treeView.tree();
    const elsewhere = shownElsewhere(assigned, tree.focusedId);
    sidebar.render(
      state === null
        ? null
        : { ...state, selectedSessionId: assigned.get(tree.focusedId) ?? null },
      realSections(),
      (row) => ({
        title: shownTitle(row.titles, titleMax),
        activity: activities.top(row.sessionId),
        status: rowStatus(tabs.statusesOf(row.sessionId)),
        onScreen: elsewhere.has(row.sessionId),
      }),
      elsewhere,
    );
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
        logLine(`${project} is not a favorite`);
        return;
      }
      const shown = realSections().favorites.map((group) => group.project);
      if (!favorites.move(project, by, shown)) {
        logLine(`${project} cannot move ${direction}`);
        return;
      }
      drawSidebar();
      logLine(`moved ${project} ${direction}`);
    },
  };
}
