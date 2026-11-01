import './sessions.css';
import type { PaneDirection } from '../../../contracts/panes';
import type { PageApi, PagePart } from '../../../contracts/plugin';
import { errorText } from '../../../shared/error-text';
import { createListPicker } from '../../../shared/page/list-picker';
import {
  leafIds,
  type PaneTree,
  parsePaneTree,
  type SplitAxis,
} from '../../../shared/page/pane-tree/pane-tree';
import { qualify } from '../../../shared/plugin-manifests';
import type { KeysPageExports } from '../../keys/contract';
import type {
  SessionRow,
  SessionsChannel,
  SessionsPageEvents,
  SessionsPageExports,
  SessionsState,
} from '../contract';
import defaultLayout from '../layouts/default/layout.js';
import type { Layout } from '../layouts/layout';
import { sessionsManifest } from '../manifest';
import { readSessionsLayout } from './layout/read-sessions-layout';
import {
  activationTarget,
  type PaneSessions,
  panesToClose,
  pickerRows,
  restorePanes,
  shownElsewhere,
} from './pane-sessions';
import { previewToggle } from './preview';
import { mountSessionsView, type SessionsView } from './sessions-view';
import {
  isRoundToast,
  isSameVisibleTab,
  mayClose,
  roundToastText,
  rowChanges,
  stepSession,
  stepTab,
  type VisibleTab,
  visibleTab,
} from './tabs';

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

// A choice in the split picker: a session no pane shows, or a new session.
type PickerChoice = { kind: 'row'; row: SessionRow } | { kind: 'new' };

function createExports(
  api: SessionsApi,
  view: SessionsView,
  activate: (sessionId: string) => void,
  labelOf: (sessionId: string) => string,
): SessionsPageExports {
  const { log } = api.services;
  return {
    addTab: (sessionId, tab) => view.tabs.add(sessionId, tab),
    selectedSessionId: () => view.panes.focusedSessionId(),
    activate,
    closeSession(sessionId) {
      if (!mayClose(view.tabs.tabsOf(sessionId))) {
        return;
      }
      api.channel
        .invoke('closeSession', sessionId)
        .then((closed) => {
          if (!closed) {
            log(
              'sessions',
              `session close kept by main: ${labelOf(sessionId)}`,
            );
          }
        })
        .catch((error) =>
          log('sessions', `session not closed: ${errorText(error)}`),
        );
    },
  };
}

// Sessions mode: a side bar row for each of main's sessions, in the mode's
// side bar, beside chat panes, each showing one session's tabs, which other
// plugins add. The side bar's selected row, the title bar and `activeChanged`
// follow the focused pane's session; main owns the rows and keeps a
// selection of its own, which the page keeps in step through `activate`, its
// own echoes changing nothing when they come back. Activating a session
// focuses the pane showing it, or loads it into the focused pane; closing one
// asks main, and a pane whose session leaves closes, the last pane staying.
// The visible tab, the focused pane's session's selected tab while the mode
// shows, sets the base key scope through its `shown`; with none visible the
// scope is `idle`. A round selected while the mode is hidden toasts instead
// of showing it. The pane keys split, close and swap panes, a split asking
// which session the new pane shows; the pane tree and each pane's session
// persist in uiState `panes`. The side bar, panes and tab bars draw with the
// layout the `layout` setting names. `openPreview` swaps the side bar's rows
// for a sample of every row state and back, page-only: it sends nothing to
// main.
export const sessionsPagePart: PagePart<typeof sessionsManifest> = {
  manifest: sessionsManifest,
  start(api: SessionsApi) {
    const { log } = api.services;
    const { uiState } = api.services;
    const keys = api.dependency<KeysPageExports>('keys');
    let state: SessionsState = { rows: [], selectedSessionId: null };
    // Undefined until the first state is published.
    let published: string | null | undefined;
    let isModeShown = false;
    let lastVisible: VisibleTab = null;
    // The sessions the page asked main to activate whose state has not come
    // back yet, oldest first.
    const pendingEchoes: string[] = [];
    // Read once; the first state places it.
    const saved = readSavedPanes(uiState.get(PANES_KEY));
    let hasRestored = false;
    // True while `activate` places a session, so the focus change it makes
    // does not ask main a second time; true while `apply` runs, so the panes
    // publish once its state is in.
    let isPlacing = false;
    let isApplying = false;

    const rowOf = (sessionId: string) =>
      state.rows.find((row) => row.sessionId === sessionId);
    const labelOf = (sessionId: string) => rowOf(sessionId)?.label ?? sessionId;

    // Tells the visible tab, when it changed, that it shows; with none
    // visible while the mode shows, sets the `idle` scope. `isShownAgain`
    // tells an unchanged visible tab again, after a pane move took keyboard
    // focus from its element.
    const checkVisible = (isShownAgain = false) => {
      const sessionId = view.panes.focusedSessionId();
      const tab =
        sessionId === null ? null : view.tabs.selectedTabOf(sessionId);
      const next = visibleTab(isModeShown, sessionId, tab?.id ?? null);
      const isTabShown = typeof next === 'object' && next !== null;
      if (
        isSameVisibleTab(lastVisible, next) &&
        !(isShownAgain && isTabShown)
      ) {
        return;
      }
      lastVisible = next;
      if (next === 'none') {
        api.keys.setScope('idle');
        log(
          'sessions',
          sessionId === null
            ? 'nothing shown'
            : `nothing shown in ${labelOf(sessionId)}`,
        );
      } else if (next !== null) {
        tab?.shown();
      }
    };

    // Sets the title bar to the focused pane's session, and publishes it when
    // it changed; a round selected while the mode is hidden toasts.
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
      if (sessionId === published) {
        return;
      }
      const wasPublished = published;
      published = sessionId;
      if (focused !== undefined) {
        log('sessions', `activated ${focused.label}`);
      }
      api.events.emit('activeChanged', { sessionId });
      if (
        sessionId !== null &&
        isRoundToast(wasPublished, sessionId, isModeShown)
      ) {
        api.services.toast(
          roundToastText(
            labelOf(sessionId),
            keys.keysFor(qualify(sessionsManifest.id, 'showMode')),
          ),
          'info',
        );
      }
    };

    const savePanes = () => {
      const sessions: Record<string, string | null> = {};
      for (const [paneId, sessionId] of view.panes.sessions()) {
        sessions[paneId] =
          sessionId === null ? null : (rowOf(sessionId)?.hostSessionId ?? null);
      }
      const panes: SavedPanes = { tree: view.panes.tree(), sessions };
      uiState.set(PANES_KEY, panes);
    };

    // The selection main will hold once the activations it was sent land.
    const mainSelection = () => pendingEchoes.at(-1) ?? state.selectedSessionId;

    // Asks main to select `sessionId`, recording the echo its state will
    // carry when that differs from the selection main will hold.
    const tellMain = (sessionId: string) => {
      if (sessionId !== mainSelection()) {
        pendingEchoes.push(sessionId);
      }
      api.channel.invoke('activate', sessionId).catch((error) => {
        pendingEchoes.length = 0;
        log('sessions', `session not activated: ${errorText(error)}`);
      });
    };

    // Focuses the pane showing `sessionId`, or loads it into the focused pane.
    const placeSession = (sessionId: string) => {
      const { panes } = view;
      const target = activationTarget(
        panes.sessions(),
        panes.focusedPaneId(),
        sessionId,
      );
      isPlacing = true;
      try {
        if (target.kind === 'focus') {
          panes.focus(target.paneId);
        } else {
          panes.load(target.paneId, sessionId);
        }
      } finally {
        isPlacing = false;
      }
    };

    const activate = (sessionId: string) => {
      if (rowOf(sessionId) !== undefined) {
        placeSession(sessionId);
      }
      tellMain(sessionId);
    };

    const paneLabel = (panes: PaneSessions, paneId: string) => {
      const sessionId = panes.get(paneId) ?? null;
      return sessionId === null ? 'empty' : labelOf(sessionId);
    };

    // A row click closes the side bar's overlay; `activate` reads `mode` only
    // on a click, after `add`.
    const view = mountSessionsView({
      activate: (sessionId) => {
        exports.activate(sessionId);
        mode.picked();
      },
      isModeShown: () => isModeShown,
      tabsChanged: () => checkVisible(),
      keys,
      timers: api.services.timers,
      panesChanged() {
        savePanes();
        if (!isApplying) {
          publishFocused();
          checkVisible();
        }
      },
      paneFocused(paneId) {
        const panes = view.panes.sessions();
        log('sessions', `pane focused ${paneLabel(panes, paneId)}`);
        const sessionId = panes.get(paneId) ?? null;
        if (!isPlacing && sessionId !== null && sessionId !== mainSelection()) {
          tellMain(sessionId);
        }
      },
      markdown: api.services.markdown,
      platform: api.platform,
      commands: {
        exists: (id) => api.keys.command(id) !== undefined,
        run: (id) => api.commands.run(id),
      },
      log,
    });
    const exports = createExports(api, view, activate, labelOf);

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
        checkVisible();
      },
      hidden() {
        isModeShown = false;
        api.panes.setOuterPanes(null);
        checkVisible();
      },
    });

    // The first state's panes: the saved ones whose sessions came back, or
    // one pane holding main's selected session when none did.
    const restoreSavedPanes = (first: SessionsState) => {
      const restored =
        saved === null ? null : restorePanes(saved.hostIds, first.rows);
      const hasSession =
        restored !== null &&
        [...restored.values()].some((sessionId) => sessionId !== null);
      if (saved === null || restored === null || !hasSession) {
        if (first.selectedSessionId !== null) {
          view.panes.load(view.panes.focusedPaneId(), first.selectedSessionId);
        }
        return;
      }
      view.panes.restore(saved.tree, restored);
      for (const [paneId, sessionId] of restored) {
        if (sessionId === null) {
          view.panes.close(paneId);
        }
      }
      const focused = view.panes.focusedSessionId();
      if (focused !== null && focused !== first.selectedSessionId) {
        exports.activate(focused);
      }
    };

    // Places main's selection when it changed and is not the page's own echo.
    // When the selected session left a split and main picked the next row,
    // main is told the focused pane's session instead, so the panes left keep
    // theirs.
    const placeSelection = (
      before: SessionsState,
      next: SessionsState,
      removed: readonly string[],
      wasSplit: boolean,
    ) => {
      const selected = next.selectedSessionId;
      if (selected !== null && selected === pendingEchoes[0]) {
        pendingEchoes.shift();
        return;
      }
      if (selected === before.selectedSessionId || selected === null) {
        return;
      }
      const isFallbackPick =
        before.selectedSessionId !== null &&
        removed.includes(before.selectedSessionId);
      if (isFallbackPick && wasSplit) {
        const focused = view.panes.focusedSessionId();
        if (focused !== null) {
          exports.activate(focused);
        }
        return;
      }
      placeSession(selected);
    };

    const apply = (next: SessionsState) => {
      const before = state;
      state = next;
      isApplying = true;
      const changes = rowChanges(before.rows, next.rows);
      const wasSplit = leafIds(view.panes.tree()).length > 1;
      const closing = panesToClose(view.panes.sessions(), changes.removed);
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
        if (hasRestored) {
          placeSelection(before, next, changes.removed, wasSplit);
        } else {
          hasRestored = true;
          restoreSavedPanes(next);
        }
      } finally {
        isApplying = false;
      }
      for (const sessionId of changes.removed) {
        api.events.emit('sessionRemoved', { sessionId });
      }
      for (const row of changes.added) {
        api.events.emit('sessionAdded', {
          sessionId: row.sessionId,
          projectDir: row.projectDir,
          harness: row.harness,
          hostSessionId: row.hostSessionId,
        });
      }
      publishFocused();
      checkVisible(closing.length > 0);
    };

    // Main sends `activated` before the state it causes, so the mode shows
    // before that state arrives and the round never toasts.
    api.channel.on('activated', () => mode.show());

    // A state read that a stateChanged overtook is stale. A failed read is
    // logged and leaves the view blank, never claiming there are no sessions.
    let hasStateChanged = false;
    api.channel.on('stateChanged', (next) => {
      hasStateChanged = true;
      apply(next);
    });
    api.channel
      .invoke('state')
      .then((first) => {
        if (!hasStateChanged) {
          apply(first);
        }
      })
      .catch((error) => log('sessions', `state not read: ${errorText(error)}`));

    const showMode = () => {
      if (!mode.isShown()) {
        mode.show();
        return;
      }
      mode.toggleSideBar();
    };

    // Steps the focused pane over the sessions no other pane shows.
    const stepToSession = (by: 1 | -1) => {
      mode.show();
      if (view.isPreviewShown()) {
        view.stepPreview(by);
        return;
      }
      const { panes } = view;
      const sessionId = stepSession(
        { ...state, selectedSessionId: panes.focusedSessionId() },
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
        log('sessions', `no other tab in ${labelOf(sessionId)}`);
        return;
      }
      view.tabs.select(sessionId, tab.id);
      log('sessions', `showed ${tab.title} tab in ${labelOf(sessionId)}`);
    };

    api.layouts.show<Layout>({
      defaultLayout,
      read: readSessionsLayout,
      userLayout: () => api.settings().layout,
      setLayouts: (shown) => view.setLayouts(shown),
    });

    const openPreview = previewToggle(mode, view, (message) =>
      log('sessions', message),
    );

    const picker = createListPicker({
      pushScope: () => api.keys.pushScope('picker'),
      log,
      logSource: sessionsManifest.id,
    });
    api.areas.overlay.contribute(picker.element);

    // Asks which session the new pane `paneId` shows: the sessions no pane
    // shows, then a new one when chat can start one. A cancel while the pane
    // still shows nothing closes it.
    const openSplitPicker = (paneId: string) => {
      const choices: PickerChoice[] = pickerRows(
        state.rows,
        view.panes.sessions(),
      ).map((row) => ({ kind: 'row', row }));
      if (api.keys.command('chat.newSession') !== undefined) {
        choices.push({ kind: 'new' });
      }
      const isPaneLive = () => leafIds(view.panes.tree()).includes(paneId);
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
          log('sessions', `pane loaded ${choice.row.label}`);
          exports.activate(choice.row.sessionId);
        },
        cancelled() {
          const isStillEmpty =
            isPaneLive() && view.panes.sessions().get(paneId) === null;
          if (isStillEmpty) {
            view.panes.close(paneId);
            log('sessions', 'split cancelled');
            checkVisible(true);
          }
        },
      });
    };

    // Runs a pane key while Sessions mode shows; logs and does nothing while
    // it is hidden.
    const paneKey = (run: () => void) => () => {
      if (!mode.isShown()) {
        log('sessions', 'pane keys ignored: Sessions mode is hidden');
        return;
      }
      run();
    };

    const split = (axis: SplitAxis) => {
      const paneId = view.panes.split(axis);
      if (paneId === null) {
        log('sessions', 'pane too small to split');
        return;
      }
      log('sessions', `pane split ${axis === 'column' ? 'down' : 'right'}`);
      openSplitPicker(paneId);
    };

    const closePane = () => {
      if (!view.panes.close(view.panes.focusedPaneId())) {
        log('sessions', 'last pane stays');
        return;
      }
      log('sessions', 'pane closed');
      checkVisible(true);
    };

    const swapPane = (direction: PaneDirection) => {
      if (!view.panes.swap(direction)) {
        log('sessions', `no pane ${direction}`);
        return;
      }
      log('sessions', 'panes swapped');
      checkVisible(true);
    };

    return {
      commands: {
        showMode,
        openPreview,
        nextSession: () => stepToSession(1),
        prevSession: () => stepToSession(-1),
        nextTab: () => stepToTab(1),
        prevTab: () => stepToTab(-1),
        // Acts on the focused pane's session, whichever box the key fired in;
        // never on a row the user cannot see.
        closeSession: () => {
          if (!mode.isShown()) {
            log('sessions', 'close ignored: Sessions mode is hidden');
            return;
          }
          const sessionId = view.panes.focusedSessionId();
          if (sessionId !== null) {
            exports.closeSession(sessionId);
          }
        },
        splitDown: paneKey(() => split('column')),
        splitRight: paneKey(() => split('row')),
        closePane: paneKey(closePane),
        swapPaneLeft: paneKey(() => swapPane('left')),
        swapPaneRight: paneKey(() => swapPane('right')),
        swapPaneUp: paneKey(() => swapPane('up')),
        swapPaneDown: paneKey(() => swapPane('down')),
        pickerDown: () => picker.down(),
        pickerUp: () => picker.up(),
        pickerChoose: () => picker.choose(),
        pickerCancel: () => picker.cancel(),
      },
      exports,
    };
  },
};
