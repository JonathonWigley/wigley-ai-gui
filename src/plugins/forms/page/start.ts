import '../../../shared/page/dialog.css';
import './forms.css';
import type {
  PageApi,
  PagePart,
  QualifiedEvents,
  ToastTone,
} from '../../../contracts/plugin';
import { errorText } from '../../../shared/error-text';
import type {
  SessionsPageEvents,
  SessionsPageExports,
} from '../../sessions/contract';
import type { KeysPageExports } from '../../keys/contract';
import type { FormsChannel, LayoutChoice, RoundEnd } from '../contract';
import defaultLayout from '../layouts/default/layout.js';
import { formsManifest } from '../manifest';
import { startAutosave } from './autosave';
import { focusActionFor } from './boxes';
import { createEditorBoxes, type EditorBoxes } from './editor-boxes';
import { initialState } from './form-state';
import { formsCommandHandlers, guardClose } from './forms-commands';
import { createFormsStore, type FormsStore } from './forms-store';
import { type FormsView, mountFormsView } from './forms-view';
import { createLayoutLoader } from './layout/layout-loader';

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

// Shows main's chosen layout, then each layout main reports changed, loaded
// one at a time in arrival order. A layout that fails to load leaves the
// current one shown. A change heard before main answers `layout` is newer, so
// the answer is then dropped.
function showLayouts(api: FormsApi, view: FormsView) {
  const { log, toast } = api.services;
  const loader = createLayoutLoader({
    importModule: (url) => import(/* @vite-ignore */ url),
    dataUrl: (path, revision) => api.dataUrl(path, revision),
    defaultLayout,
    head: document.head,
  });
  let queue = Promise.resolve();
  let heardChange = false;
  const show = (choice: LayoutChoice) => {
    queue = queue.then(() =>
      loader.load(choice).then(
        (layout) => {
          view.setLayout(layout, choice.name);
          log(
            'forms',
            `layout ${choice.name} shown (${choice.reason}, revision ${choice.revision})`,
          );
          const shownToast = layoutToast(choice);
          if (shownToast !== null) {
            toast(shownToast.text, shownToast.tone);
          }
        },
        (error) => {
          log('forms', `layout ${choice.name} failed: ${errorText(error)}`);
          toast(`Layout ${choice.name} failed: ${errorText(error)}`, 'error');
        },
      ),
    );
  };
  api.channel.on('layoutChanged', (choice) => {
    heardChange = true;
    show(choice);
  });
  void api.channel
    .invoke('layout')
    .then((choice) => {
      if (!heardChange) {
        show(choice);
      }
    })
    .catch((error) => log('forms', `layout not read: ${errorText(error)}`));
}

function layoutToast(
  choice: LayoutChoice,
): { text: string; tone: ToastTone } | null {
  switch (choice.reason) {
    case 'cycled':
      return { text: `Layout: ${choice.name}`, tone: 'info' };
    case 'copied':
      return {
        text: `Layout copied to layouts/${choice.name} in forms' data folder`,
        tone: 'success',
      };
    default:
      return null;
  }
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
      delayMs: api.settings.autosaveDelayMs,
      timers: services.timers,
      log: services.log,
    });
    listenForRounds(api, store);
    showLayouts(api, view);
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
