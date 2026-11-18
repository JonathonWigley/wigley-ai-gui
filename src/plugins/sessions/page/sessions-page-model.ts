import type { PluginLog } from '../../../contracts/log';
import type { PageRestores } from '../../../contracts/plugin';
import type { UiState } from '../../../contracts/ui-state';
import { errorText } from '../../../shared/error-text';
import {
  leafIds,
  type PaneTree,
  parsePaneTree,
} from '../../../shared/page/pane-tree/pane-tree';
import type { MarkOptions, SessionRow, SessionsState } from '../contract';
import {
  type ActivationTarget,
  activationTarget,
  echoesAfterReply,
  fillPlan,
  liveWaits,
  type PendingEcho,
  panesToClose,
  restorePlan,
  type SelectionTarget,
  savedPaneSessions,
  selectionAction,
  selectionTarget,
} from './pane-sessions';
import type { SessionTabsView } from './session-tabs-view';
import type { SessionList, SessionPanes, SessionsView } from './sessions-view';
import {
  isMarkToast,
  isSameVisibleTab,
  rowChanges,
  type VisibleTab,
  visibleTab,
} from './tabs';

// The uiState key holding the chat panes: the pane tree and each pane's
// session by host session id, null for an empty pane or a row with none.
const PANES_KEY = 'panes';

// The chat panes as uiState holds them.
interface SavedPanes {
  tree: PaneTree;
  sessions: Record<string, string | null>;
}

// The pane tree and each of its panes' host session id read back from
// uiState; null when the value is not a saved pane layout.
function readSavedPanes(
  value: unknown,
): { tree: PaneTree; hostIds: Map<string, string | null> } | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const { tree: savedTree, sessions } = value as Partial<SavedPanes>;
  const tree = parsePaneTree(savedTree);
  if (tree === null || typeof sessions !== 'object' || sessions === null) {
    return null;
  }
  const hostIds = new Map<string, string | null>();
  for (const paneId of leafIds(tree)) {
    const hostId: unknown = sessions[paneId];
    hostIds.set(paneId, typeof hostId === 'string' ? hostId : null);
  }
  return { tree, hostIds };
}

// What the mid-operation states of one main operation added up to, for the state
// that settles it: a later one's own panes are already closed.
interface MidOperation {
  removed: readonly string[];
  wasSplit: boolean;
  hasClosedPane: boolean;
}

const NO_MID_OPERATION: MidOperation = {
  removed: [],
  wasSplit: false,
  hasClosedPane: false,
};

// The parts of the sessions view the model reads and drives.
export interface SessionsPageModelView {
  render: SessionsView['render'];
  panes: Pick<
    SessionPanes,
    | 'tree'
    | 'sessions'
    | 'focusedPaneId'
    | 'focusedSessionId'
    | 'load'
    | 'focus'
    | 'close'
    | 'restore'
  >;
  tabs: Pick<
    SessionTabsView,
    'tabsOf' | 'selectedTabOf' | 'openPopupOf' | 'drop'
  >;
  list: Pick<SessionList, 'holdsKeys'>;
}

// `readRows` reads main's rows, owners included; `readSelection` main's
// selection. `active` is the `sessions.active` slot. `activateInMain` asks
// main to select a session, resolving true when main wrote the rows or the
// selection. `setContext` sets the title bar to the focused row, none for
// undefined; `markToast` toasts a mark that selected a row while the mode was
// hidden; `setIdleScope` sets the `idle` key scope; `tabShown` emits
// `tabShown`.
export interface SessionsPageModelDeps {
  view: SessionsPageModelView;
  uiState: UiState;
  readRows(): Iterable<SessionRow>;
  readSelection(): string | null;
  active: {
    get(): string | null | undefined;
    set(sessionId: string | null): void;
  };
  activateInMain(sessionId: string): Promise<boolean>;
  restores: Pick<PageRestores, 'track'>;
  setContext(focused: SessionRow | undefined): void;
  markToast(mark: MarkOptions): void;
  setIdleScope(): void;
  tabShown(sessionId: string, tabId: string): void;
  log: PluginLog;
  // Whether the page part stopped: main's later reply to an activation then
  // changes and logs nothing.
  isStopped(): boolean;
}

// `ready` applies the first state; `applyNotice` applies the state now once
// `ready` ran, nothing before. `tabsChanged`, `panesChanged` and
// `paneFocused` are the view's callbacks of those names.
export interface SessionsPageModel {
  ready(): void;
  applyNotice(): void;
  state(): SessionsState;
  rowOf(sessionId: string): SessionRow | undefined;
  labelOf(sessionId: string): string;
  activate(sessionId: string): void;
  checkVisible(isShownAgain?: boolean): void;
  setMainScope(): void;
  paneLabel(paneId: string): string;
  setModeShown(isShown: boolean): void;
  isModeShown(): boolean;
  closeWaiting(): void;
  tabsChanged(): void;
  panesChanged(): void;
  paneFocused(paneId: string): void;
}

// The Sessions page's state and how main's rows and selection apply to the
// panes. The focused pane's session drives the title bar and `active`; main
// keeps a selection of its own, which `activate` keeps in step, its own echoes
// changing nothing when they come back. Rows with an owner are left out of the
// state. The first state is read at `ready`, restoring the saved panes, and
// each notice applies after it. A selection naming no row is mid-operation:
// main deleted that row and its selection write follows, so the state that
// settles it places the panes, and the focus and the visible tab follow in a
// microtask, after every reader heard the notice. A restored pane whose
// session main does not hold yet waits for it until `closeWaiting`. The
// visible surface, the focused pane's session's top open popup, else its
// selected tab, while the mode shows, hears `shown`; with none visible the
// scope is `idle`, and the tab that stops being visible hears `hidden`.
export function createSessionsPageModel(
  deps: SessionsPageModelDeps,
): SessionsPageModel {
  const { view, active, log } = deps;
  let state: SessionsState = { rows: [], selectedSessionId: null };
  // False until the first state's focus is written to `active`.
  let hasPublished = false;
  let isModeShown = false;
  let lastVisible: VisibleTab = null;
  // The sessions the page asked main to activate whose state has not come
  // back yet, oldest first.
  let pendingEchoes: PendingEcho[] = [];
  // Read once; the first state places it.
  const saved = readSavedPanes(deps.uiState.get(PANES_KEY));
  let hasRestored = false;
  // The one restore tracked from the first apply, a throwing one included,
  // until the first apply that is not mid-operation shows the restored
  // panes' visible tab, setting the key base, in its microtask.
  let restoreFollowed: PromiseWithResolvers<void> | null = null;
  // The restored panes still waiting for their sessions (`restorePlan`),
  // until the first pane key closes them.
  let waiting = new Map<string, string>();
  // True while `activate` places a session, so the focus change it makes
  // does not ask main a second time; true while `apply` runs, so the panes
  // publish once its state is in.
  let isPlacing = false;
  let isApplying = false;
  let midOperation = NO_MID_OPERATION;

  const applyNotice = () => {
    if (hasRestored) {
      apply(currentState());
    }
  };

  const rowOf = (sessionId: string) =>
    state.rows.find((row) => row.sessionId === sessionId);
  const labelOf = (sessionId: string) => rowOf(sessionId)?.label ?? sessionId;

  // The tab `visible` names, while its session still holds it; undefined
  // for a popup.
  const tabOfVisible = (visible: VisibleTab) =>
    typeof visible === 'object' && visible?.kind === 'tab'
      ? view.tabs
          .tabsOf(visible.sessionId)
          .find((tab) => tab.id === visible.tabId)
      : undefined;

  // Tells the tab that was visible, when the visible surface changed, that it
  // is hidden, then tells the visible surface, a popup or a tab, that it
  // shows; with none visible while the mode shows, sets the `idle` scope.
  // `isShownAgain` tells an unchanged visible surface again, after a pane
  // move or a layout redraw took keyboard focus from its element. Does
  // nothing while the Sessions list holds the keys, so no surface takes the
  // scope from it.
  const checkVisible = (isShownAgain = false) => {
    if (view.list.holdsKeys()) {
      return;
    }
    const sessionId = view.panes.focusedSessionId();
    const tab = sessionId === null ? null : view.tabs.selectedTabOf(sessionId);
    const popup = sessionId === null ? null : view.tabs.openPopupOf(sessionId);
    const next = visibleTab(
      isModeShown,
      sessionId,
      tab?.id ?? null,
      popup?.id ?? null,
    );
    const isSurfaceShown = typeof next === 'object' && next !== null;
    if (
      isSameVisibleTab(lastVisible, next) &&
      !(isShownAgain && isSurfaceShown)
    ) {
      return;
    }
    if (!isSameVisibleTab(lastVisible, next)) {
      tabOfVisible(lastVisible)?.hidden?.();
    }
    lastVisible = next;
    if (next === 'none') {
      deps.setIdleScope();
      log(
        sessionId === null
          ? 'nothing shown'
          : `nothing shown in ${labelOf(sessionId)}`,
      );
    } else if (next?.kind === 'popup') {
      popup?.shown();
    } else if (next !== null && tab !== null) {
      tab.shown();
      deps.tabShown(next.sessionId, tab.id);
    }
  };

  // Sets the title bar to the focused pane's session, and publishes it when
  // it changed; a row a mark selected while the mode is hidden toasts.
  const publishFocused = () => {
    const sessionId = view.panes.focusedSessionId();
    const focused = sessionId === null ? undefined : rowOf(sessionId);
    deps.setContext(focused);
    const lastPublished = hasPublished ? (active.get() ?? null) : undefined;
    if (sessionId === lastPublished) {
      return;
    }
    hasPublished = true;
    if (focused !== undefined) {
      log(`activated ${focused.label}`);
    }
    active.set(sessionId);
    const markToast = focused?.markToast ?? null;
    if (
      markToast !== null &&
      isMarkToast(lastPublished, sessionId, isModeShown)
    ) {
      deps.markToast(markToast);
    }
  };

  const savePanes = () => {
    const panes: SavedPanes = {
      tree: view.panes.tree(),
      sessions: savedPaneSessions(view.panes.sessions(), waiting, state.rows),
    };
    deps.uiState.set(PANES_KEY, panes);
  };

  // The selection main will hold once the activations it was sent land.
  const mainSelection = () =>
    pendingEchoes.at(-1)?.sessionId ?? state.selectedSessionId;

  // Asks main to select `sessionId`, recording the echo its state will
  // carry when that differs from the selection main will hold, until
  // `echoesAfterReply` drops it.
  const tellMain = (sessionId: string) => {
    const echo = sessionId === mainSelection() ? null : { sessionId };
    if (echo !== null) {
      pendingEchoes.push(echo);
    }
    deps
      .activateInMain(sessionId)
      .then((sentState) => {
        if (deps.isStopped()) {
          return;
        }
        pendingEchoes = echoesAfterReply(pendingEchoes, echo, sentState);
      })
      .catch((error) => {
        if (deps.isStopped()) {
          return;
        }
        pendingEchoes = [];
        log(`session not activated: ${errorText(error)}`);
      });
  };

  // Focuses the target pane, or loads `sessionId` into it and focuses it.
  const placeSession = (
    target: ActivationTarget | SelectionTarget,
    sessionId: string,
  ) => {
    const { panes } = view;
    isPlacing = true;
    try {
      if (target.kind === 'focus') {
        panes.focus(target.paneId);
        return;
      }
      panes.load(target.paneId, sessionId);
      if (target.paneId !== panes.focusedPaneId()) {
        panes.focus(target.paneId);
      }
    } finally {
      isPlacing = false;
    }
  };

  const activate = (sessionId: string) => {
    if (rowOf(sessionId) !== undefined) {
      const { panes } = view;
      placeSession(
        activationTarget(panes.sessions(), panes.focusedPaneId(), sessionId),
        sessionId,
      );
    }
    tellMain(sessionId);
  };

  const paneLabel = (paneId: string) => {
    const sessionId = view.panes.sessions().get(paneId) ?? null;
    return sessionId === null ? 'empty' : labelOf(sessionId);
  };

  // Sets main's scope again, whatever `checkVisible` last saw: the visible
  // tab's `shown`, or `idle` when the focused pane shows no tab.
  const setMainScope = () => {
    lastVisible = null;
    checkVisible(true);
  };

  // Lays out the first state's panes as `restorePlan` says.
  const restoreSavedPanes = (first: SessionsState) => {
    const plan = restorePlan(saved?.hostIds ?? null, first.rows);
    if (saved === null || plan.kind === 'fallback') {
      if (first.selectedSessionId !== null) {
        view.panes.load(view.panes.focusedPaneId(), first.selectedSessionId);
      }
      return;
    }
    waiting = plan.waiting;
    view.panes.restore(saved.tree, plan.sessions);
    for (const paneId of plan.closing) {
      view.panes.close(paneId);
    }
    const focused = view.panes.focusedSessionId();
    if (focused !== null && focused !== first.selectedSessionId) {
      activate(focused);
    }
  };

  // Ends the waits `nextRows` settle and loads the panes `fillPlan` fills.
  const fillWaiting = (nextRows: readonly SessionRow[]) => {
    const { ended, loads } = fillPlan(waiting, nextRows, view.panes.sessions());
    for (const paneId of ended) {
      waiting.delete(paneId);
    }
    for (const [paneId, sessionId] of loads) {
      view.panes.load(paneId, sessionId);
      log(`pane restored ${labelOf(sessionId)}`);
    }
  };

  // Ends the restore: the panes still waiting close, the last pane staying.
  const closeWaiting = () => {
    if (waiting.size === 0) {
      return;
    }
    const paneIds = [...waiting.keys()];
    waiting = new Map();
    for (const paneId of paneIds) {
      view.panes.close(paneId);
    }
    log('waiting panes closed');
  };

  // Applies the selection rules (`selectionAction`) to the state `apply`
  // took in. A notice that leaves the selection alone answers no echo, however
  // its id compares with the ones still waited for.
  const placeSelection = (
    before: SessionsState,
    next: SessionsState,
    removed: readonly string[],
    wasSplit: boolean,
  ) => {
    if (next.selectedSessionId === before.selectedSessionId) {
      return;
    }
    const { action, echoes } = selectionAction({
      before: before.selectedSessionId,
      next: next.selectedSessionId,
      removed,
      wasSplit,
      pendingEchoes,
    });
    pendingEchoes = echoes;
    if (action.kind === 'place') {
      const { panes } = view;
      const target = selectionTarget(
        panes.sessions(),
        panes.focusedPaneId(),
        action.sessionId,
        waiting,
      );
      if (target.kind === 'loadEndingWait') {
        log(
          `wait ended: ${labelOf(action.sessionId)} loaded into a waiting pane`,
        );
      }
      placeSession(target, action.sessionId);
    } else if (action.kind === 'tellFocused') {
      const focused = view.panes.focusedSessionId();
      if (focused !== null) {
        activate(focused);
      }
    }
  };

  const currentState = (): SessionsState => ({
    rows: [...deps.readRows()].filter((row) => row.owner === null),
    selectedSessionId: deps.readSelection(),
  });

  const apply = (next: SessionsState) => {
    const before = state;
    if (!hasRestored && restoreFollowed === null) {
      restoreFollowed = Promise.withResolvers<void>();
      deps.restores.track(restoreFollowed.promise);
    }
    state = next;
    isApplying = true;
    const changes = rowChanges(before.rows, next.rows);
    const closing = panesToClose(view.panes.sessions(), changes.removed);
    const isSelectionRowless =
      next.selectedSessionId !== null &&
      !next.rows.some((row) => row.sessionId === next.selectedSessionId);
    const seen: MidOperation = {
      removed: [...midOperation.removed, ...changes.removed],
      wasSplit: midOperation.wasSplit || leafIds(view.panes.tree()).length > 1,
      hasClosedPane: midOperation.hasClosedPane || closing.length > 0,
    };
    try {
      view.render(next);
      for (const paneId of closing) {
        if (!view.panes.close(paneId)) {
          view.panes.load(paneId, null);
        }
      }
      for (const sessionId of changes.removed) {
        view.tabs.drop(sessionId);
      }
      if (!hasRestored) {
        hasRestored = true;
        restoreSavedPanes(next);
      } else {
        fillWaiting(next.rows);
        if (!isSelectionRowless) {
          placeSelection(before, next, seen.removed, seen.wasSplit);
        }
      }
    } finally {
      isApplying = false;
    }
    if (isSelectionRowless) {
      midOperation = seen;
      return;
    }
    midOperation = NO_MID_OPERATION;
    const followed = restoreFollowed;
    restoreFollowed = null;
    queueMicrotask(() => {
      try {
        publishFocused();
        checkVisible(seen.hasClosedPane);
      } finally {
        followed?.resolve();
      }
    });
  };

  return {
    ready: () => apply(currentState()),
    applyNotice,
    state: () => state,
    rowOf,
    labelOf,
    activate,
    checkVisible,
    setMainScope,
    paneLabel,
    setModeShown(isShown) {
      isModeShown = isShown;
    },
    isModeShown: () => isModeShown,
    closeWaiting,
    tabsChanged() {
      if (!isApplying) {
        checkVisible();
      }
    },
    panesChanged() {
      waiting = liveWaits(waiting, view.panes.sessions());
      savePanes();
      if (!isApplying) {
        publishFocused();
        checkVisible();
      }
    },
    paneFocused(paneId) {
      const panes = view.panes.sessions();
      log(`pane focused ${paneLabel(paneId)}`);
      const sessionId = panes.get(paneId) ?? null;
      if (!isPlacing && sessionId !== null && sessionId !== mainSelection()) {
        tellMain(sessionId);
      }
    },
  };
}
