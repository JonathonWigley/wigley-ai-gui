import './sessions.css';
import type { PaneDirection } from '../../../contracts/panes';
import type {
  PageApi,
  PageCommandContext,
  PagePart,
} from '../../../contracts/plugin';
import { errorText } from '../../../shared/error-text';
import {
  createPartStore,
  type PartStore,
} from '../../../shared/page/contributed-parts';
import { blurFocusedElement, holdsTextEntry } from '../../../shared/page/dom';
import { listPickerCommands } from '../../../shared/page/list-picker';
import { pruneKeys } from '../../../shared/page/place-slot';
import {
  leafIds,
  type PaneTree,
  parsePaneTree,
  type SplitAxis,
} from '../../../shared/page/pane-tree/pane-tree';
import { qualify } from '../../../shared/plugin-manifests';
import {
  followRows,
  type SessionPart,
  type SessionRow,
  type SessionsChannel,
  sessionsActiveSlot,
  sessionsActivitySlot,
  sessionsPlaceSlot,
  sessionsFavoriteProjectAtCommand,
  type SessionsPageEvents,
  type SessionsPageExports,
  sessionsRowsSlot,
  sessionsSelectionSlot,
  sessionsSelectRowCommand,
  sessionsSelectTabCommand,
  type SessionsState,
  type SidebarSection,
} from '../contract';
import defaultLayout from '../layouts/default/layout.js';
import defaultStylesheet from '../layouts/default/layout.css?url';
import type { Layout, SectionInput } from '../layouts/layout';
import { sessionsManifest } from '../manifest';
import { cutTitle, titleLimit } from '../session-title';
import { sessionsPageView } from './consumer-view';
import { readSessionsLayout } from './layout/read-sessions-layout';
import {
  type ActivationTarget,
  activationTarget,
  echoesAfterReply,
  fillPlan,
  liveWaits,
  type PaneSessions,
  type PendingEcho,
  panesToClose,
  pickerRows,
  pressedFocusAction,
  restorePlan,
  type SelectionTarget,
  savedPaneSessions,
  selectionAction,
  selectionTarget,
  shownElsewhere,
} from './pane-sessions';
import { previewToggle } from './preview';
import { createProjectFavorites } from './project-favorites';
import { createRenameDialog } from './rename-dialog';
import { createSessionRecency } from './session-recency';
import { mountSessionsView, type SessionsView } from './sessions-view';
import type { CursorMove } from './sidebar-order';
import {
  closesAtOnce,
  isMarkToast,
  isSameVisibleTab,
  markToastText,
  mayClose,
  rowChanges,
  stepSession,
  stepTab,
  type VisibleTab,
  visibleTab,
} from './tabs';
import { kitCommandsOf } from '../../../shared/page/layout-host/base-kit';

type SessionsApi = PageApi<
  typeof sessionsManifest,
  SessionsChannel,
  SessionsPageEvents
>;

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

// The line a popup opened or hidden logs, by `togglePopup` or its bar entry.
function popupToggledLine(
  title: string,
  isOpen: boolean,
  sessionLabel: string,
): string {
  return `${isOpen ? 'opened' : 'hid'} ${title} popup in ${sessionLabel}`;
}

// The ids of the side bar's own sections, which no registered section may take.
const RESERVED_SECTION_IDS: readonly string[] = [
  'favorites',
  'recent',
] satisfies Exclude<SectionInput['kind'], 'plugin'>[];

// A choice in the split picker: a session no pane shows, or a new session.
type PickerChoice = { kind: 'row'; row: SessionRow } | { kind: 'new' };

// Asks the session's tabs in order, then its popups, then main, to close it,
// resolving to whether the row closed; `atOnce` says the close key found a tab
// or popup asking for an instant close, so main cancels what its guards hold
// first. Main's refusal is logged and toasted, and a failed ask logged.
async function closeSession(
  api: SessionsApi,
  view: SessionsView,
  labelOf: (sessionId: string) => string,
  sessionId: string,
  atOnce: boolean,
): Promise<boolean> {
  const { log } = api.services;
  const viewsNow = () => [
    ...view.tabs.tabsOf(sessionId),
    ...view.tabs.popupsOf(sessionId),
  ];
  if (!(await mayClose(viewsNow, atOnce))) {
    return false;
  }
  try {
    const refusal = await api.channel.invoke('closeSession', sessionId, atOnce);
    if (refusal !== null) {
      log(`session close kept by main: ${labelOf(sessionId)}`);
      api.services.toast(refusal, 'info');
    }
    return refusal === null;
  } catch (error) {
    log(`session not closed: ${errorText(error)}`);
    return false;
  }
}

function createExports(
  api: SessionsApi,
  view: SessionsView,
  rowParts: PartStore<SessionPart>,
  barParts: PartStore<SessionPart>,
  sections: PartStore<SidebarSection>,
  activate: (sessionId: string) => void,
  labelOf: (sessionId: string) => string,
  shownSessionId: () => string | null,
): SessionsPageExports {
  return {
    addTab(sessionId, tab) {
      const handle = view.tabs.add(sessionId, tab);
      api.events.emit('tabAdded', { sessionId, tabId: tab.id });
      return handle;
    },
    addPopup: (sessionId, popup, options) =>
      view.tabs.addPopup(sessionId, popup, options),
    cutToTitleLimit: (text) =>
      cutTitle(text, titleLimit(api.settings().titleMaxLength)),
    addRowPart: (part) => rowParts.add(part),
    addBarPart: (part) => barParts.add(part),
    addSection(section) {
      if (RESERVED_SECTION_IDS.includes(section.id)) {
        throw new Error(`section id ${section.id} is reserved`);
      }
      return sections.add(section);
    },
    activate,
    closeSession: (sessionId) =>
      closeSession(api, view, labelOf, sessionId, false),
    shownSessionId,
    setActivity: (sessionId, sourceId, activity) =>
      view.setActivity(sessionId, sourceId, activity),
  };
}

// Sessions mode: a side bar row for each of main's sessions, in the mode's
// side bar, beside chat panes, each showing one session's tabs, which other
// plugins add. The side bar's selected row, the title bar and `sessions.active`
// follow the focused pane's session; main owns the rows and keeps a
// selection of its own, which the page keeps in step through `activate`, its
// own echoes changing nothing when they come back. The first state is read at
// `ready`, and each notice of the rows or the selection applies after
// it. A selection naming no row is mid-operation: main deleted that row and its
// selection write follows, so the state that settles it places the panes, and
// the focus and the visible tab follow in a microtask, after every reader heard
// the notice. Each session's place (`sessionsPlaceSlot`) outlives a reload:
// a row leaving deletes it, and once the restore window settles the part
// deletes the places of rows that ended while no page ran. Activating a session
// focuses the pane showing it, or loads it into the focused pane; closing one
// asks main, and a pane whose session leaves closes, the last pane staying.
// The visible surface, the focused pane's session's top open popup, else its
// selected tab, while the mode shows, sets the base key scope through its
// `shown`; with none visible the scope is `idle`; the tab that stops being
// visible hears `hidden`, and `tabShown` fires for each tab told it shows.
// `togglePopup` hides and shows the focused pane's session's popup. A row a
// mark selected while the mode is hidden toasts the mark instead of showing
// it. The pane keys split, close and swap panes, a split asking which session
// the new pane shows; a split or pane close does nothing while that picker is
// open. The pane tree and each pane's session persist in uiState `panes`; a
// restored pane whose session main does not hold yet waits for it until the
// first pane key that changes the panes. The side bar, panes, tab bars, popups
// and the popup bar draw with the layout the `layout` setting names.
// `openPreview` swaps the side bar's rows for a sample of every row state and
// back, page-only: it sends nothing to main. `renameSession` opens the rename
// dialog over the focused pane's session; the rows draw titles cut to the
// `titleMaxLength` setting, drawn again when it changes. The rows group by
// project under Favorites and Recent, from the favorites and recency stamps in
// uiState, less the rows a section another plugin registers (`addSection`)
// claims, which draw in that section after Recent; the session step keys follow
// that drawn order, and the project keys change the focused pane's session's
// project's favorite. The side bar's rows are the Sessions list, reached by
// Alt+h past the leftmost pane (`focusSideBar`) or by opening the side bar over
// a narrow window: it holds the `sidebar` scope while its cursor walks the rows,
// and while it does no visible tab takes the scope. Its row keys act on the
// cursor's row; Enter, Esc and Alt+l (`focusMain`) end its turn, as do the side
// bar hiding, the mode hiding and a press or a focus in the chat panes, each
// setting main's scope again. A pane key move, like a key leaving the list,
// hands the keys to the focused pane's transcript in normal mode; a release
// into a pane focuses its Chat box.
export const sessionsPagePart: PagePart<typeof sessionsManifest> = {
  manifest: sessionsManifest,
  start(api: SessionsApi) {
    const { log } = api.services;
    const { uiState } = api.services;
    const rows = api.state.read(sessionsRowsSlot);
    const selection = api.state.read(sessionsSelectionSlot);
    const active = api.state.publish(sessionsActiveSlot);
    active.set(null);
    const activities = api.state.publish(sessionsActivitySlot);
    // The old page's sources are gone with it, and the new page's set theirs
    // again.
    for (const sessionId of activities.all().keys()) {
      activities.delete(sessionId);
    }
    // Each session's place outlives a reload, not its row. The places of rows
    // main does not hold leave once the restore window settles, so the rows
    // chat's restore reopens are in the mirror first.
    const places = api.state.publish(sessionsPlaceSlot);
    api.restores.onSettled(() =>
      pruneKeys(places, (sessionId) => rows.all().has(sessionId)),
    );
    let state: SessionsState = { rows: [], selectedSessionId: null };
    // False until the first state's focus is written to `active`.
    let hasPublished = false;
    let isModeShown = false;
    let lastVisible: VisibleTab = null;
    // The sessions the page asked main to activate whose state has not come
    // back yet, oldest first.
    let pendingEchoes: PendingEcho[] = [];
    // Read once; the first state places it.
    const saved = readSavedPanes(uiState.get(PANES_KEY));
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
    rows.on(applyNotice);
    selection.on(applyNotice);
    // After `applyNotice`, so the row's frame is dropped before its place goes.
    followRows(rows, { removed: (sessionId) => places.delete(sessionId) });

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
      const tab =
        sessionId === null ? null : view.tabs.selectedTabOf(sessionId);
      const popup =
        sessionId === null ? null : view.tabs.openPopupOf(sessionId);
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
        api.keys.setScope('idle');
        log(
          sessionId === null
            ? 'nothing shown'
            : `nothing shown in ${labelOf(sessionId)}`,
        );
      } else if (next?.kind === 'popup') {
        popup?.shown();
      } else if (next !== null && tab !== null) {
        tab.shown();
        api.events.emit('tabShown', {
          sessionId: next.sessionId,
          tabId: tab.id,
        });
      }
    };

    // Sets the title bar to the focused pane's session, and publishes it when
    // it changed; a row a mark selected while the mode is hidden toasts.
    const publishFocused = () => {
      const sessionId = view.panes.focusedSessionId();
      const focused = sessionId === null ? undefined : rowOf(sessionId);
      mode.setContext(
        focused === undefined
          ? null
          : {
              title: focused.label,
              detail:
                focused.projectDir === null
                  ? null
                  : api.services.paths.tilde(
                      focused.projectDir,
                      api.services.homeDir,
                    ),
            },
      );
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
        api.services.toast(
          markToastText(
            markToast,
            api.keys.keysFor(qualify(sessionsManifest.id, 'showMode')),
          ),
          'info',
        );
      }
    };

    const savePanes = () => {
      const panes: SavedPanes = {
        tree: view.panes.tree(),
        sessions: savedPaneSessions(view.panes.sessions(), waiting, state.rows),
      };
      uiState.set(PANES_KEY, panes);
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
      api.channel
        .invoke('activate', sessionId)
        .then((sentState) => {
          pendingEchoes = echoesAfterReply(pendingEchoes, echo, sentState);
        })
        .catch((error) => {
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

    const paneLabel = (panes: PaneSessions, paneId: string) => {
      const sessionId = panes.get(paneId) ?? null;
      return sessionId === null ? 'empty' : labelOf(sessionId);
    };

    // Sets main's scope again, whatever `checkVisible` last saw: the visible
    // tab's `shown`, or `idle` when the focused pane shows no tab.
    const setMainScope = () => {
      lastVisible = null;
      checkVisible(true);
    };

    // Hands the keys to the focused pane as a key move does: the focused
    // element blurs and the visible tab is told it shows again, so the keys
    // land on its transcript in normal mode, or the pane's `idle`.
    const keysToFocusedPane = () => {
      log(
        `keys to pane ${paneLabel(view.panes.sessions(), view.panes.focusedPaneId())}`,
      );
      blurFocusedElement();
      setMainScope();
    };

    const logListCursor = (row: SessionRow | null) =>
      log(row === null ? 'no session rows' : `list cursor on ${row.label}`);

    const rowParts = createPartStore<SessionPart>();
    const barParts = createPartStore<SessionPart>();
    const sections = createPartStore<SidebarSection>();
    // A row click, a star's click and a tab's click each run their command.
    const view = mountSessionsView({
      activate: (sessionId) =>
        void api.commands.run(sessionsSelectRowCommand, sessionId),
      runFavorite: (project) =>
        void api.commands.run(sessionsFavoriteProjectAtCommand, project),
      selectTab: (sessionId, tab) =>
        void api.commands.run(sessionsSelectTabCommand, { sessionId, tab }),
      isModeShown: () => isModeShown,
      tabsChanged() {
        if (!isApplying) {
          checkVisible();
        }
      },
      popupOpenedFromBar(sessionId, popup) {
        log(popupToggledLine(popup.title, true, labelOf(sessionId)));
      },
      keys: api.keys,
      timers: api.services.timers,
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
        log(`pane focused ${paneLabel(panes, paneId)}`);
        const sessionId = panes.get(paneId) ?? null;
        if (!isPlacing && sessionId !== null && sessionId !== mainSelection()) {
          tellMain(sessionId);
        }
      },
      paneKeyFocused: () => keysToFocusedPane(),
      cursorMoved: (row) => logListCursor(row),
      // The keys follow a release into its pane, as `pressedFocusAction` says.
      panePressed(pane) {
        const textSelection = window.getSelection();
        const focused = document.activeElement;
        const sessionId = view.panes.focusedSessionId();
        const action = pressedFocusAction({
          hasSelectionInPane:
            textSelection?.isCollapsed === false &&
            pane.contains(textSelection.anchorNode),
          isFocusInPane: pane.contains(focused),
          doesFocusTakeText: holdsTextEntry(focused),
          isChatTabShown:
            sessionId !== null &&
            view.tabs.selectedTabOf(sessionId)?.id === 'chat',
          isPopupOpen:
            sessionId !== null && view.tabs.openPopupOf(sessionId) !== null,
        });
        if (action === 'keep') {
          return;
        }
        blurFocusedElement();
        const canFocusBox =
          action === 'toBox' &&
          sessionId !== null &&
          api.keys.command('chat.focusBox') !== undefined;
        if (canFocusBox) {
          api.commands.run('chat.focusBox');
        }
      },
      markdown: api.services.markdown,
      platform: api.platform.os,
      state: api.state.forLayouts,
      commands: kitCommandsOf(api),
      log,
      rowParts,
      barParts,
      sections,
      titleMaxLength: () => api.settings().titleMaxLength,
      recency: createSessionRecency(api.services.clock, uiState),
      favorites: createProjectFavorites(uiState),
      activities,
      places,
    });
    let titleMaxLength = api.settings().titleMaxLength;
    api.onSettingsChanged((settings) => {
      if (settings.titleMaxLength !== titleMaxLength) {
        titleMaxLength = settings.titleMaxLength;
        view.redrawRows();
      }
    });
    const exports = createExports(
      api,
      view,
      rowParts,
      barParts,
      sections,
      activate,
      labelOf,
      () => (isModeShown ? view.panes.focusedSessionId() : null),
    );

    // Gives the Sessions list the keys, the cursor on the selected row.
    const focusList = () => {
      api.keys.setScope('sidebar');
      const row = view.list.enter();
      log(
        row === null ? 'list focused, no rows' : `list focused on ${row.label}`,
      );
    };

    // Ends the list's turn and gives main's scope and keys back; `picked`
    // closes a narrow window's side bar overlay, so the keys never sit in a
    // pane under it. `leave` runs first, so the `sideBarHidden` it may cause
    // finds the list already left. A DOM focus already inside a pane stays,
    // as `endListByMain` leaves it: only main's scope is set again. A press
    // in another pane moves pane focus on its release, after this runs.
    const focusMain = () => {
      if (view.list.leave()) {
        log('list left');
        mode.picked();
      }
      if (view.panes.paneHolding(document.activeElement) !== null) {
        setMainScope();
      } else {
        keysToFocusedPane();
      }
    };

    // The first mode's `shown` runs inside `add`, before `mode` is assigned.
    const mode = api.modes.add({
      id: 'sessions',
      title: 'Sessions',
      icon: 'comment-discussion',
      element: view.element,
      sideBar: view.sideBar,
      shown() {
        isModeShown = true;
        api.panes.setOuterPanes(view.panes.outer);
        view.tabs.rescroll();
        checkVisible();
      },
      hidden() {
        isModeShown = false;
        view.list.leave();
        api.panes.setOuterPanes(null);
        checkVisible();
      },
      focusSideBar: focusList,
      focusMain,
      sideBarOpenedOver: focusList,
      sideBarHidden() {
        if (view.list.leave()) {
          log('list left');
          keysToFocusedPane();
        }
      },
    });

    // A press or a focus inside the chat panes ends the list's turn; the press
    // or the focus places the DOM focus itself.
    const endListByMain = () => {
      if (view.list.leave()) {
        log('list left');
        setMainScope();
      }
    };
    view.element.addEventListener('pointerdown', endListByMain, true);
    view.element.addEventListener('focusin', endListByMain);

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
      const { ended, loads } = fillPlan(
        waiting,
        nextRows,
        view.panes.sessions(),
      );
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
      rows: [...rows.all().values()],
      selectedSessionId: selection.get() ?? null,
    });

    const apply = (next: SessionsState) => {
      const before = state;
      if (!hasRestored && restoreFollowed === null) {
        restoreFollowed = Promise.withResolvers<void>();
        api.restores.track(restoreFollowed.promise);
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
        wasSplit:
          midOperation.wasSplit || leafIds(view.panes.tree()).length > 1,
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

    // Main sends `activated` before the writes it causes, so the mode shows
    // before they arrive and the round never toasts.
    api.channel.on('activated', () => mode.show());

    const showMode = () => {
      if (!mode.isShown()) {
        mode.show();
        return;
      }
      mode.toggleSideBar();
    };

    // Steps the focused pane, in drawn order, over the sessions no other pane
    // shows.
    const stepToSession = (by: 1 | -1) => {
      mode.show();
      if (view.isPreviewShown()) {
        view.stepPreview(by);
        return;
      }
      const { panes } = view;
      const sessionId = stepSession(
        {
          ...state,
          rows: view.orderedRows(),
          selectedSessionId: panes.focusedSessionId(),
        },
        by,
        shownElsewhere(panes.sessions(), panes.focusedPaneId()),
      );
      if (sessionId !== null) {
        exports.activate(sessionId);
      }
    };

    const stepToTab = (by: 1 | -1) => {
      mode.show();
      const sessionId = view.panes.focusedSessionId();
      if (sessionId === null) {
        return;
      }
      const tabs = view.tabs.tabsOf(sessionId);
      const selected = view.tabs.selectedTabOf(sessionId);
      const tabId = stepTab(
        tabs.map((tab) => tab.id),
        selected?.id ?? null,
        by,
      );
      const tab = tabs.find((candidate) => candidate.id === tabId);
      if (tab === undefined) {
        log(`no other tab in ${labelOf(sessionId)}`);
        return;
      }
      view.tabs.select(sessionId, tab.id);
      log(`showed ${tab.title} tab in ${labelOf(sessionId)}`);
    };

    // Hides the focused pane's session's open popup, else opens the one it hid
    // last, showing the mode first.
    const togglePopup = () => {
      mode.show();
      const sessionId = view.panes.focusedSessionId();
      if (sessionId === null) {
        log('no popup: no session shown');
        return;
      }
      const toggled = view.tabs.togglePopup(sessionId);
      if (toggled === null) {
        log(`no popup in ${labelOf(sessionId)}`);
        return;
      }
      log(
        popupToggledLine(
          toggled.popup.title,
          toggled.isOpen,
          labelOf(sessionId),
        ),
      );
    };

    const renameDialog = createRenameDialog({
      pushScope: () => api.keys.pushScope('rename'),
      setUserTitle: (sessionId, title) =>
        api.channel.invoke('setUserTitle', sessionId, title),
      titleMaxLength: () => api.settings().titleMaxLength,
      parts: view.parts,
      log,
    });
    api.areas.overlay.contribute(renameDialog.element);

    api.layouts.show<Layout>({
      defaultLayout,
      defaultStylesheet,
      read: readSessionsLayout,
      userLayout: () => api.settings().layout,
      setLayouts: (shown) => {
        view.setLayouts(shown);
        renameDialog.redraw();
        checkVisible(true);
      },
    });

    const openPreview = previewToggle(mode, view, log);

    const picker = api.services.picker.create({ filter: true });

    // Acts on the focused pane's session, as `closeSession` does.
    const renameSession = () => {
      if (!mode.isShown()) {
        log('rename ignored: Sessions mode is hidden');
        return;
      }
      const sessionId = view.panes.focusedSessionId();
      const row = sessionId === null ? undefined : rowOf(sessionId);
      if (row === undefined) {
        log('no session to rename');
        return;
      }
      renameDialog.open(row);
    };

    // Runs a project key on the focused pane's session's project, as
    // `renameSession` acts on its session.
    const projectKey = (run: (project: string) => void) => () => {
      if (!mode.isShown()) {
        log('projects ignored: Sessions mode is hidden');
        return;
      }
      const sessionId = view.panes.focusedSessionId();
      const row = sessionId === null ? undefined : rowOf(sessionId);
      if (row === undefined) {
        log('no session for projects');
        return;
      }
      run(row.project);
    };

    // Asks which session the new pane `paneId` shows: the sessions no pane
    // shows, in drawn order, then a new one when chat can start one. A cancel
    // while the pane still shows nothing closes it.
    const openSplitPicker = (paneId: string) => {
      const choices: PickerChoice[] = pickerRows(
        view.orderedRows(),
        view.panes.sessions(),
      ).map((row) => ({ kind: 'row', row }));
      if (api.keys.command('chat.newSession') !== undefined) {
        choices.push({ kind: 'new' });
      }
      const isPaneLive = () => leafIds(view.panes.tree()).includes(paneId);
      blurFocusedElement();
      picker.open<PickerChoice>({
        title: 'Show session',
        items: choices,
        label: (choice) =>
          choice.kind === 'row' ? choice.row.label : 'New session',
        chosen(choice) {
          if (!isPaneLive()) {
            return;
          }
          if (choice.kind === 'new') {
            api.commands.run('chat.newSession');
            return;
          }
          view.panes.load(paneId, choice.row.sessionId);
          log(`pane loaded ${choice.row.label}`);
          exports.activate(choice.row.sessionId);
        },
        cancelled() {
          const isStillEmpty =
            isPaneLive() && view.panes.sessions().get(paneId) === null;
          if (isStillEmpty) {
            view.panes.close(paneId);
            log('split cancelled');
            checkVisible(true);
          }
        },
      });
    };

    // Runs a pane key while Sessions mode shows; logs and does nothing while
    // it is hidden.
    const paneKey = (run: () => void) => () => {
      if (!mode.isShown()) {
        log('pane keys ignored: Sessions mode is hidden');
        return;
      }
      run();
    };

    // Runs a split or pane close unless the split picker is open: a split
    // would replace the picker's request and leave its empty pane open, and a
    // close could leave the picker over a closed pane.
    const unlessPicking = (run: () => void) => () => {
      if (picker.isOpen()) {
        log('pane keys ignored: the split picker is open');
        return;
      }
      run();
    };

    // Each pane key that changes the panes ends the restore (`closeWaiting`).
    const split = (axis: SplitAxis) => {
      const paneId = view.panes.split(axis);
      if (paneId === null) {
        log('pane too small to split');
        return;
      }
      log(`pane split ${axis === 'column' ? 'down' : 'right'}`);
      closeWaiting();
      openSplitPicker(paneId);
    };

    const closePane = () => {
      if (!view.panes.close(view.panes.focusedPaneId())) {
        log('last pane stays');
        return;
      }
      log('pane closed');
      closeWaiting();
      checkVisible(true);
    };

    const swapPane = (direction: PaneDirection) => {
      if (!view.panes.swap(direction)) {
        log(`no pane ${direction}`);
        return;
      }
      log('panes swapped');
      closeWaiting();
      checkVisible(true);
    };

    // Runs a list key while the side bar shows; a narrowing hides it without
    // telling, so a key then logs and does nothing.
    const listKey = (run: () => void) => () => {
      if (!mode.sideBarShown()) {
        log('list keys ignored: the side bar is hidden');
        return;
      }
      run();
    };

    const moveListCursor = (move: CursorMove) =>
      listKey(() => logListCursor(view.list.move(move)));

    // Runs a list key on main's row under the cursor; a layout preview row is
    // not main's.
    const cursorRowKey = (run: (row: SessionRow) => void) =>
      listKey(() => {
        const sessionId = view.list.cursorSessionId();
        const row = sessionId === null ? undefined : rowOf(sessionId);
        if (row === undefined) {
          log('no session under the cursor');
          return;
        }
        run(row);
      });

    return {
      commands: {
        showMode,
        openPreview,
        nextSession: () => stepToSession(1),
        prevSession: () => stepToSession(-1),
        nextTab: () => stepToTab(1),
        prevTab: () => stepToTab(-1),
        togglePopup,
        // Acts on the focused pane's session, whichever box the key fired in;
        // never on a row the user cannot see.
        closeSession: () => {
          if (!mode.isShown()) {
            log('close ignored: Sessions mode is hidden');
            return;
          }
          const sessionId = view.panes.focusedSessionId();
          if (sessionId !== null) {
            const atOnce = closesAtOnce([
              ...view.tabs.tabsOf(sessionId),
              ...view.tabs.popupsOf(sessionId),
            ]);
            void closeSession(api, view, labelOf, sessionId, atOnce);
          }
        },
        splitDown: paneKey(unlessPicking(() => split('column'))),
        splitRight: paneKey(unlessPicking(() => split('row'))),
        closePane: paneKey(unlessPicking(closePane)),
        swapPaneLeft: paneKey(() => swapPane('left')),
        swapPaneRight: paneKey(() => swapPane('right')),
        swapPaneUp: paneKey(() => swapPane('up')),
        swapPaneDown: paneKey(() => swapPane('down')),
        ...listPickerCommands(picker),
        // Closes the side bar's overlay, as a row click picks in it.
        selectRow: ({ arg }: PageCommandContext<string>) => {
          exports.activate(arg);
          mode.picked();
        },
        // Logs no `showed` line: the tab keys log that.
        selectTab: ({
          arg,
        }: PageCommandContext<{ sessionId: string; tab: string }>) =>
          view.tabs.select(arg.sessionId, arg.tab),
        renameSession,
        renameAccept: () => renameDialog.accept(),
        renameCancel: () => renameDialog.cancel(),
        favoriteProject: projectKey((project) => view.toggleFavorite(project)),
        favoriteProjectAt: ({ arg }: PageCommandContext<string>) =>
          view.toggleFavorite(arg),
        moveProjectUp: projectKey((project) => view.moveFavorite(project, -1)),
        moveProjectDown: projectKey((project) => view.moveFavorite(project, 1)),
        listDown: moveListCursor(1),
        listUp: moveListCursor(-1),
        listTop: moveListCursor('first'),
        listBottom: moveListCursor('last'),
        listOpen: cursorRowKey((row) => {
          exports.activate(row.sessionId);
          focusMain();
        }),
        listShow: cursorRowKey((row) => exports.activate(row.sessionId)),
        listBack: focusMain,
        listFavorite: cursorRowKey((row) => view.toggleFavorite(row.project)),
        listMoveUp: cursorRowKey((row) => view.moveFavorite(row.project, -1)),
        listMoveDown: cursorRowKey((row) => view.moveFavorite(row.project, 1)),
        listRename: cursorRowKey((row) => renameDialog.open(row)),
        listClose: cursorRowKey((row) => {
          void exports
            .closeSession(row.sessionId)
            .then(() => view.list.refocus());
        }),
      },
      exports: (consumer) =>
        sessionsPageView(exports, consumer, (listener) =>
          followRows(rows, { removed: listener }),
        ),
      ready() {
        apply(currentState());
      },
      dispose: () => view.dispose(),
    };
  },
};
