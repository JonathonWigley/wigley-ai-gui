import './forms.css';
import type { PageApi, PagePart } from '../../../contracts/plugin';
import type { FormsChannel, RoundEnd } from '../contract';
import { formsManifest } from '../manifest';
import { startAutosave } from './autosave';
import { focusActionFor } from './boxes';
import { createEditorBoxes, type EditorBoxes } from './editor-boxes';
import { initialState } from './form-state';
import { formsCommandHandlers } from './forms-commands';
import { createFormsStore, type FormsStore } from './forms-store';
import { mountFormsView } from './forms-view';

type FormsApi = PageApi<typeof formsManifest, FormsChannel>;

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

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
// both, and showing an open round again changes nothing.
function listenForRounds(api: FormsApi, store: FormsStore) {
  const { log } = api.services;
  api.channel.on('roundShown', (round) =>
    store.dispatch({ type: 'roundShown', round }),
  );
  api.channel.on('roundClosed', (roundId) =>
    store.dispatch({ type: 'roundClosed', roundId }),
  );
  api.channel.on('focusRound', (roundId) =>
    store.dispatch({ type: 'focusRound', roundId }),
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

// Shows agents' rounds and sends the user's answers back to main; the scope
// follows the forms view.
export const formsPagePart: PagePart<typeof formsManifest> = {
  manifest: formsManifest,
  start(api: FormsApi) {
    const { services } = api;
    const store = createFormsStore(initialState([]));
    const boxes = createBoxes(api, store);
    mountFormsView({
      areas: api.areas,
      store,
      boxes,
      markdown: services.markdown,
      keymap: api.keys.keymap,
      label: api.keys.label,
      run: (command) => api.commands.run(command),
    });
    store.subscribe(() => api.keys.setScope(store.get().view));
    startAutosave({
      store,
      save: (roundId, body) => api.channel.invoke('draft', roundId, body),
      delayMs: api.settings.autosaveDelayMs,
      timers: services.timers,
      log: services.log,
    });
    listenForRounds(api, store);
    return {
      commands: formsCommandHandlers({
        store,
        boxes,
        finish: (roundId, end) => finishRound(api, roundId, end),
        toast: services.toast,
        log: services.log,
      }),
    };
  },
};
