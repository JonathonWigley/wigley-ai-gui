import type { Timers } from '../../../contracts/ambient';
import type { OuterPanes, PaneDirection } from '../../../contracts/panes';
import type { ShownLayouts } from '../../../contracts/plugin';
import { element } from '../../../shared/page/dom';
import {
  leafIds,
  type PaneTree,
  paneToward,
  type SplitAxis,
} from '../../../shared/page/pane-tree/pane-tree';
import { createPaneTreeView } from '../../../shared/page/pane-tree/pane-tree-view';
import type { KeysPageExports } from '../../keys/contract';
import type { SessionsState } from '../contract';
import type { Layout } from '../layouts/layout';
import {
  createSessionsParts,
  type SessionsPartsDeps,
} from './layout/sessions-parts';
import { type PaneSessions, shownElsewhere } from './pane-sessions';
import { PREVIEW_STATE, previewRowState } from './preview';
import {
  mountSessionTabsView,
  type SessionTabsView,
} from './session-tabs-view';
import { mountSidebarView } from './sidebar-view';
import { rowStatus, stepSession } from './tabs';

// `activate` runs on a row click; `isModeShown` reads whether Sessions mode
// shows; `tabsChanged` runs after any change to a session's tabs, their
// selection or their statuses; `keys` draws the session, tab and pane
// prompts; `timers` runs a pane divider's prompt linger; `panesChanged` runs
// after the pane tree or a pane's session changed, and `paneFocused` after
// focus moved to another pane, a pane tree press or outer pane key included;
// the rest is what the sessions layout's kits read.
export interface SessionsViewDeps extends Omit<SessionsPartsDeps, 'keys'> {
  activate(sessionId: string): void;
  isModeShown(): boolean;
  tabsChanged(): void;
  keys: Pick<KeysPageExports, 'anchor' | 'keysFor'>;
  timers: Timers;
  panesChanged(): void;
  paneFocused(paneId: string): void;
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
// real rows again.
export interface SessionsView {
  element: HTMLElement;
  sideBar: HTMLElement;
  tabs: SessionTabsView;
  panes: SessionPanes;
  render(state: SessionsState): void;
  setLayouts(shown: ShownLayouts<Layout>): void;
  showPreview(isShown: boolean): void;
  isPreviewShown(): boolean;
  stepPreview(by: 1 | -1): void;
}

const PANE_DIRECTIONS: readonly PaneDirection[] = [
  'left',
  'right',
  'up',
  'down',
];

// Sessions mode's two parts: the side bar of session rows, which the shell
// draws in its side bar, and the root holding the chat panes. Each row's
// second line follows its tabs' statuses. Both draw with `default` until the
// first `setLayouts`.
export function mountSessionsView(deps: SessionsViewDeps): SessionsView {
  const root = element('div', 'sessions');
  const parts = createSessionsParts(deps);
  // The preview sample while it shows, else null.
  let preview: SessionsState | null = null;
  const sidebar = mountSidebarView((sessionId) => {
    if (preview === null) {
      deps.activate(sessionId);
      return;
    }
    preview = { ...preview, selectedSessionId: sessionId };
    drawSidebar();
  }, parts);
  let state: SessionsState | null = null;
  const assigned = new Map<string, string | null>();
  let paneCount = 1;

  const drawSidebar = () => {
    if (preview !== null) {
      sidebar.render(preview, previewRowState, new Set());
      return;
    }
    const tree = treeView.tree();
    const elsewhere = shownElsewhere(assigned, tree.focusedId);
    sidebar.render(
      state === null
        ? null
        : { ...state, selectedSessionId: assigned.get(tree.focusedId) ?? null },
      (sessionId) => ({
        status: rowStatus(tabs.statusesOf(sessionId)),
        onScreen: elsewhere.has(sessionId),
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

  return {
    element: root,
    sideBar: sidebar.element,
    tabs,
    panes,
    render(next) {
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
      const sessionId = stepSession(preview, by, new Set());
      if (sessionId !== null) {
        preview = { ...preview, selectedSessionId: sessionId };
        drawSidebar();
      }
    },
  };
}
