import '../../../shared/page/markdown.css';
import './forms.css';
import type {
  PageApi,
  PagePart,
  QualifiedEvents,
} from '../../../contracts/plugin';
import { errorText } from '../../../shared/error-text';
import {
  createLayoutLoader,
  showLayouts,
} from '../../../shared/page/layout-loader';
import type {
  SessionsPageEvents,
  SessionsPageExports,
} from '../../sessions/contract';
import type { KeysPageExports } from '../../keys/contract';
import type { FormsChannel } from '../contract';
import defaultLayout from '../layouts/default/layout.js';
import type { Layout } from '../layouts/layout';
import { formsManifest } from '../manifest';
import { startAutosave } from './autosave';
import { focusActionFor } from './boxes';
import { createEditorBoxes, type EditorBoxes } from './editor-boxes';
import { initialState } from './form-state';
import {
  closeRoundFromMain,
  formsCommandHandlers,
  guardClose,
} from './forms-commands';
import { createFormsStore, type FormsStore } from './forms-store';
import { mountFormsView } from './forms-view';
import { readLayout } from './layout/read-layout';

type FormsApi = PageApi<
  typeof formsManifest,
  FormsChannel,
  Record<never, never>,
  QualifiedEvents<'sessions', SessionsPageEvents>
>;

// Each box's edits reach the store, and a box taking focus focuses its item.
function createBoxes(api: FormsApi, store: FormsStore): EditorBoxes {
  return createEditorBoxes(
    api.services.editor,
    {
      changed: (box, value) =>
        store.dispatch({
          type: 'setText',
          roundId: box.roundId,
          target: box.target,
          value,
        }),
      activated: (box) => {
        const action = focusActionFor(store.get(), box);
        if (action !== null) {
          store.dispatch(action);
        }
      },
    },
    api.services.log,
  );
}

// Listeners first: a round shown while openRounds is in flight arrives in
// both, and showing an open round again changes nothing. The active round
// follows the session the sessions plugin shows, and a round leaves only when
// main closes it.
function listenForRounds(
  api: FormsApi,
  store: FormsStore,
  sessions: SessionsPageExports,
) {
  const { log, toast } = api.services;
  api.channel.on('roundShown', (round) =>
    store.dispatch({ type: 'roundShown', round }),
  );
  api.channel.on('roundClosed', (closed) =>
    closeRoundFromMain(
      {
        store,
        closeSession: (sessionId) => sessions.closeSession(sessionId),
        toast,
        log,
      },
      closed,
    ),
  );
  api.events.on('sessions.activeChanged', ({ sessionId }) =>
    store.dispatch({ type: 'sessionActivated', sessionId }),
  );
  void api.channel
    .invoke('openRounds')
    .then((rounds) => {
      for (const round of rounds) {
        store.dispatch({ type: 'roundShown', round });
      }
    })
    .catch((error) =>
      log('forms', `open rounds not read: ${errorText(error)}`),
    );
}

// Shows each agent round in its session's Form tab and sends the user's
// answers back to main; while a Form tab is the visible tab, the key scope
// follows the forms view and the status line shows. A session with an open
// round closes only through the cancel prompt. Rounds draw in the layout main
// chooses.
export const formsPagePart: PagePart<typeof formsManifest> = {
  manifest: formsManifest,
  start(api: FormsApi) {
    const { services } = api;
    const sessions = api.dependency<SessionsPageExports>('sessions');
    const store = createFormsStore(
      initialState([], sessions.selectedSessionId()),
    );
    const boxes = createBoxes(api, store);
    const view = mountFormsView({
      areas: api.areas,
      sessions,
      beforeClose: (sessionId) =>
        guardClose(
          {
            store,
            toast: services.toast,
            log: services.log,
            showForm: (formSessionId) => view.showForm(formSessionId),
            activate: (activeSessionId) => sessions.activate(activeSessionId),
          },
          sessionId,
        ),
      setScope: (formsView) => api.keys.setScope(formsView),
      onViewChanged: (listener) => {
        api.keys.onScopeChanged(listener);
        api.modes.onChanged(listener);
      },
      pushConfirmScope: () => api.keys.pushScope('confirm'),
      store,
      boxes,
      markdown: services.markdown,
      keys: api.dependency<KeysPageExports>('keys'),
      run: (command) => api.commands.run(command),
      platform: api.platform,
      uiState: services.uiState,
      log: services.log,
    });
    api.events.on('sessions.sessionRemoved', ({ sessionId }) =>
      view.forgetSession(sessionId),
    );
    startAutosave({
      store,
      save: (roundId, body) => api.channel.invoke('draft', roundId, body),
      delayMs: () => api.settings().autosaveDelayMs,
      timers: services.timers,
      log: services.log,
    });
    listenForRounds(api, store, sessions);
    showLayouts({
      channel: {
        onLayoutChanged: (listener) =>
          api.channel.on('layoutChanged', listener),
        readLayout: () => api.channel.invoke('layout'),
      },
      loader: createLayoutLoader<Layout>({
        importModule: (url) => import(/* @vite-ignore */ url),
        dataUrl: (path, revision) => api.dataUrl(path, revision),
        defaultLayout,
        head: document.head,
        read: readLayout,
      }),
      chosen: () => api.settings().layout,
      onChosenChanged: (listener) => {
        api.onSettingsChanged(() => listener());
      },
      setLayout: (layout, name) => view.setLayout(layout, name),
      log: services.log,
      logSource: 'forms',
      toast: services.toast,
    });
    return {
      commands: formsCommandHandlers({
        store,
        boxes,
        finish: (roundId, end) => api.channel.invoke('finish', roundId, end),
        closeSession: (sessionId) => sessions.closeSession(sessionId),
        layouts: {
          openPreview: () => api.channel.invoke('openPreview'),
        },
        scrollForm: (step, direction) => view.scrollBy(step, direction),
        toast: services.toast,
        log: services.log,
      }),
    };
  },
};
