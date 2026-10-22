import '../../../shared/page/dialog.css';
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
import type { FormsChannel, RoundEnd } from '../contract';
import defaultLayout from '../layouts/default/layout.js';
import type { Layout } from '../layouts/layout';
import { formsManifest } from '../manifest';
import { startAutosave } from './autosave';
import { focusActionFor } from './boxes';
import { createEditorBoxes, type EditorBoxes } from './editor-boxes';
import { initialState } from './form-state';
import { formsCommandHandlers, guardClose } from './forms-commands';
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
// follows the session the sessions plugin shows.
function listenForRounds(api: FormsApi, store: FormsStore) {
  const { log } = api.services;
  api.channel.on('roundShown', (round) =>
    store.dispatch({ type: 'roundShown', round }),
  );
  api.channel.on('roundClosed', (roundId) =>
    store.dispatch({ type: 'roundClosed', roundId }),
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

function finishRound(api: FormsApi, roundId: string, end: RoundEnd) {
  void api.channel
    .invoke('finish', roundId, end)
    .catch((error) =>
      api.services.log(
        'forms',
        `round ${roundId} not finished: ${errorText(error)}`,
      ),
    );
}

// Shows each agent round in its session's Form tab and sends the user's
// answers back to main; while a Form tab is the visible tab, the scope follows
// the forms view. A session with an open round closes only through the cancel
// prompt. Rounds draw in the layout main chooses.
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
            log: services.log,
            showForm: (formSessionId) => view.showForm(formSessionId),
          },
          sessionId,
        ),
      formShown: () => api.keys.setScope(store.get().view),
      store,
      boxes,
      markdown: services.markdown,
      keys: api.dependency<KeysPageExports>('keys'),
      run: (command) => api.commands.run(command),
      log: services.log,
    });
    store.subscribe(() => {
      if (view.isFormShown()) {
        api.keys.setScope(store.get().view);
      }
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
    listenForRounds(api, store);
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
      setLayout: (layout, name) => view.setLayout(layout, name),
      log: services.log,
      logSource: 'forms',
      dataFolderLabel: "forms' data folder",
      toast: services.toast,
    });
    return {
      commands: formsCommandHandlers({
        store,
        boxes,
        finish: (roundId, end) => finishRound(api, roundId, end),
        closeSession: (sessionId) => sessions.closeSession(sessionId),
        layouts: {
          cycleLayout: (step) => api.channel.invoke('cycleLayout', step),
          copyLayout: () => api.channel.invoke('copyLayout'),
          openPreview: () => api.channel.invoke('openPreview'),
        },
        toast: services.toast,
        log: services.log,
      }),
    };
  },
};
