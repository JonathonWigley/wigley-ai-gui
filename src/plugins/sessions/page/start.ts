import './sessions.css';
import type { PageApi, PagePart } from '../../../contracts/plugin';
import { errorText } from '../../../shared/error-text';
import { qualify } from '../../../shared/plugin-manifests';
import type { KeysPageExports } from '../../keys/contract';
import type {
  SessionsChannel,
  SessionsPageEvents,
  SessionsPageExports,
  SessionsState,
} from '../contract';
import { sessionsManifest } from '../manifest';
import { mountSessionsView, type SessionsView } from './sessions-view';
import {
  isRoundToast,
  isSameVisibleTab,
  mayClose,
  roundToastText,
  rowChanges,
  SIDEBAR_START,
  type SidebarLayout,
  sidebarAfterResize,
  sidebarLayout,
  stepSession,
  stepTab,
  toggledSidebar,
  type VisibleTab,
  visibleTab,
} from './tabs';

type SessionsApi = PageApi<
  typeof sessionsManifest,
  SessionsChannel,
  SessionsPageEvents
>;

// The window width below which the sidebar leaves the tab area the whole
// width: 420 px, where the form was fitted, plus the sidebar's 16rem.
const NARROW_QUERY = '(max-width: 679px)';

const SIDEBAR_LOGS: Record<SidebarLayout, string> = {
  beside: 'sidebar shown',
  over: 'sidebar shown over the content',
  hidden: 'sidebar hidden',
};

function createExports(
  api: SessionsApi,
  view: SessionsView,
  state: () => SessionsState,
  labelOf: (sessionId: string) => string,
): SessionsPageExports {
  const { log } = api.services;
  return {
    addTab: (sessionId, tab) => view.tabs.add(sessionId, tab),
    selectedSessionId: () => state().selectedSessionId,
    activate(sessionId) {
      api.channel
        .invoke('activate', sessionId)
        .catch((error) =>
          log('sessions', `session not activated: ${errorText(error)}`),
        );
    },
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

// Sessions mode: a sidebar row for each of main's sessions beside the selected
// session's tabs, which other plugins add. Main owns the rows: activating or
// closing one asks main, and the page redraws from the state main sends back,
// publishing sessions arriving and leaving and the selected session changing.
// The visible tab, the selected tab of the selected session while the mode
// shows, sets the base key scope through its `shown`; with none visible the
// scope is `idle`. A round selected while the mode is hidden toasts instead
// of showing it.
export const sessionsPagePart: PagePart<typeof sessionsManifest> = {
  manifest: sessionsManifest,
  start(api: SessionsApi) {
    const { log } = api.services;
    const keys = api.dependency<KeysPageExports>('keys');
    let state: SessionsState = { rows: [], selectedSessionId: null };
    // Undefined until the first state is published.
    let published: string | null | undefined;
    let isModeShown = false;
    let lastVisible: VisibleTab = null;
    const narrow = window.matchMedia(NARROW_QUERY);
    let isNarrow = narrow.matches;
    let sidebar = SIDEBAR_START;

    const labelOf = (sessionId: string) =>
      state.rows.find((row) => row.sessionId === sessionId)?.label ?? sessionId;

    // Tells the visible tab, when it changed, that it shows; with none
    // visible while the mode shows, sets the `idle` scope.
    const checkVisible = () => {
      const sessionId = state.selectedSessionId;
      const tab =
        sessionId === null ? null : view.tabs.selectedTabOf(sessionId);
      const next = visibleTab(isModeShown, sessionId, tab?.id ?? null);
      if (isSameVisibleTab(lastVisible, next)) {
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

    const view = mountSessionsView({
      activate: (sessionId) => exports.activate(sessionId),
      isModeShown: () => isModeShown,
      tabsChanged: checkVisible,
    });
    const exports = createExports(api, view, () => state, labelOf);
    const layOut = () => view.layOut(sidebarLayout(sidebar, isNarrow));
    layOut();
    narrow.addEventListener('change', (event) => {
      isNarrow = event.matches;
      sidebar = sidebarAfterResize(sidebar, isNarrow);
      layOut();
    });

    const modeId = qualify(sessionsManifest.id, 'sessions');
    api.modes.onChanged((shownModeId) => {
      isModeShown = shownModeId === modeId;
      checkVisible();
    });
    // The first mode's `shown` runs inside `add`, before `mode` is assigned.
    const mode = api.modes.add({
      id: 'sessions',
      title: 'Sessions',
      element: view.element,
      shown() {
        isModeShown = true;
        checkVisible();
      },
    });

    const apply = (next: SessionsState) => {
      const before = state;
      state = next;
      view.render(next);
      const changes = rowChanges(before.rows, next.rows);
      for (const sessionId of changes.removed) {
        view.tabs.drop(sessionId);
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
      const wasSelected = published;
      const sessionId = next.selectedSessionId;
      if (sessionId !== published) {
        published = sessionId;
        const row = next.rows.find(
          (candidate) => candidate.sessionId === sessionId,
        );
        if (row !== undefined) {
          log('sessions', `activated ${row.label}`);
        }
        api.events.emit('activeChanged', { sessionId });
      }
      checkVisible();
      if (
        sessionId !== null &&
        isRoundToast(wasSelected, sessionId, isModeShown)
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
      sidebar = toggledSidebar(sidebar, isNarrow);
      const layout = sidebarLayout(sidebar, isNarrow);
      view.layOut(layout);
      log('sessions', SIDEBAR_LOGS[layout]);
    };

    const stepToSession = (by: 1 | -1) => {
      mode.show();
      const sessionId = stepSession(state, by);
      if (sessionId !== null) {
        exports.activate(sessionId);
      }
    };

    const stepToTab = (by: 1 | -1) => {
      mode.show();
      const sessionId = state.selectedSessionId;
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

    return {
      commands: {
        showMode,
        nextSession: () => stepToSession(1),
        prevSession: () => stepToSession(-1),
        nextTab: () => stepToTab(1),
        prevTab: () => stepToTab(-1),
        // Acts on the selected session, whichever box the key fired in; never
        // on a row the user cannot see.
        closeSession: () => {
          if (!mode.isShown()) {
            log('sessions', 'close ignored: Sessions mode is hidden');
            return;
          }
          if (state.selectedSessionId !== null) {
            exports.closeSession(state.selectedSessionId);
          }
        },
      },
      exports,
    };
  },
};
