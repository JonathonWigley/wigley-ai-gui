import './sessions.css';
import type { PageApi, PagePart } from '../../../contracts/plugin';
import { errorText } from '../../../shared/error-text';
import type {
  SessionsChannel,
  SessionsPageEvents,
  SessionsPageExports,
  SessionsState,
} from '../contract';
import { sessionsManifest } from '../manifest';
import { mountSessionsView, type SessionsView } from './sessions-view';
import { mayClose, stepTab } from './tabs';

type SessionsApi = PageApi<
  typeof sessionsManifest,
  SessionsChannel,
  SessionsPageEvents
>;

function createExports(
  api: SessionsApi,
  view: SessionsView,
  state: () => SessionsState,
): SessionsPageExports {
  const { log } = api.services;
  const tabLabel = (sessionId: string) =>
    state().rows.find((row) => row.sessionId === sessionId)?.label ?? sessionId;
  return {
    fill: (sessionId, sessionView) => view.fill(sessionId, sessionView),
    activeSessionId: () => state().selectedSessionId,
    activate(sessionId) {
      api.channel
        .invoke('activate', sessionId)
        .catch((error) =>
          log('sessions', `tab not activated: ${errorText(error)}`),
        );
    },
    closeTab(sessionId) {
      if (!mayClose(view.fillsOf(sessionId))) {
        return;
      }
      api.channel
        .invoke('closeSession', sessionId)
        .then((closed) => {
          if (!closed) {
            log('sessions', `tab close kept by main: ${tabLabel(sessionId)}`);
          }
        })
        .catch((error) =>
          log('sessions', `tab not closed: ${errorText(error)}`),
        );
    },
  };
}

// Shows a tab for each of main's session rows, one view per session that other
// plugins fill, and publishes `activeChanged` on the first state and whenever
// the selected session changes. Main owns the rows: activating or closing one
// asks main, and the page redraws from the state main sends back.
export const sessionsPagePart: PagePart<typeof sessionsManifest> = {
  manifest: sessionsManifest,
  start(api: SessionsApi) {
    const { log } = api.services;
    let state: SessionsState = { rows: [], selectedSessionId: null };
    // Undefined until the first state is published.
    let published: string | null | undefined;
    const view = mountSessionsView(api.areas.main, (sessionId) =>
      exports.activate(sessionId),
    );
    const exports = createExports(api, view, () => state);

    const apply = (next: SessionsState) => {
      state = next;
      view.render(next);
      const sessionId = next.selectedSessionId;
      if (sessionId === published) {
        return;
      }
      published = sessionId;
      const row = next.rows.find(
        (candidate) => candidate.sessionId === sessionId,
      );
      if (row !== undefined) {
        log('sessions', `activated ${row.label}`);
      }
      api.events.emit('activeChanged', { sessionId });
    };

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

    const step = (by: 1 | -1) => {
      const sessionId = stepTab(state, by);
      if (sessionId !== null) {
        exports.activate(sessionId);
      }
    };
    return {
      commands: {
        nextTab: () => step(1),
        prevTab: () => step(-1),
        // Acts on the active tab, whichever box the key fired in.
        closeTab: () => {
          if (state.selectedSessionId !== null) {
            exports.closeTab(state.selectedSessionId);
          }
        },
      },
      exports,
    };
  },
};
