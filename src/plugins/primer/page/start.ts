import '../../../shared/page/markdown.css';
import './primer.css';
import type {
  PageApi,
  PagePart,
  QualifiedEvents,
} from '../../../contracts/plugin';
import { errorText } from '../../../shared/error-text';
import { startAutosave } from '../../../shared/page/autosave';
import {
  createEditorBoxes,
  type EditorBoxes,
} from '../../../shared/page/editor-boxes';
import { activeForm } from '../../../shared/page/session-forms';
import type { KeysPageExports } from '../../keys/contract';
import type {
  SessionsPageEvents,
  SessionsPageExports,
} from '../../sessions/contract';
import type {
  PrimerChannel,
  PrimerPageEvents,
  PrimerPageExports,
} from '../contract';
import defaultLayout from '../layouts/default/layout.js';
import type { PrimerLayout } from '../layouts/layout';
import { primerManifest } from '../manifest';
import { focusActionFor, PRIMER_BOX_IDENTITY, type PrimerBox } from './boxes';
import { readPrimerLayout } from './layout/read-primer-layout';
import {
  closePrimerFromMain,
  guardClose,
  primerCommandHandlers,
} from './primer-commands';
import {
  createPrimerEventLog,
  presentedOf,
  startPrimerEvents,
} from './primer-events';
import { buildBody, initialState } from './primer-state';
import { createPrimerStore, type PrimerStore } from './primer-store';
import { mountPrimerTab } from './primer-view';

type PrimerApi = PageApi<
  typeof primerManifest,
  PrimerChannel,
  PrimerPageEvents,
  QualifiedEvents<'sessions', SessionsPageEvents>
>;

// Each box's edits reach the store, and a box taking focus shows its row and
// item.
function createBoxes(
  api: PrimerApi,
  store: PrimerStore,
): EditorBoxes<PrimerBox> {
  return createEditorBoxes(
    api.services.editor,
    {
      changed: (box, value) =>
        store.dispatch({
          type: 'setText',
          formId: box.primerId,
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
    PRIMER_BOX_IDENTITY,
  );
}

// Listeners first: a primer shown while openForms is in flight arrives in
// both, and showing an open primer again changes nothing. The active primer
// follows the session the sessions plugin focuses, and a primer leaves only
// when main closes it.
function listenForPrimers(
  api: PrimerApi,
  store: PrimerStore,
  sessions: SessionsPageExports,
) {
  const { log, toast } = api.services;
  api.channel.on('formShown', (primer) =>
    store.dispatch({ type: 'formShown', form: primer }),
  );
  api.channel.on('formClosed', (closed) =>
    closePrimerFromMain(
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
    .invoke('openForms')
    .then((primers) => {
      for (const primer of primers) {
        store.dispatch({ type: 'formShown', form: primer });
      }
    })
    .catch((error) =>
      log('primer', `open primers not read: ${errorText(error)}`),
    );
}

// Shows each agent primer in its session's Primer tab and sends the user's
// edits back to main: drafts as the edits pause, the finish on send or cancel.
// While a Primer tab is the visible tab, the key scope, the resize keys'
// split and the focus keys' panes follow the primer view.
// A session with an open primer closes only through the cancel prompt. Every
// store change emits the primer page events it makes, each logged as it goes;
// other plugins read the active primer through the exports. The tab draws
// through the primer layout `primer.layout` names, redrawing as it or the
// layout changes.
export const primerPagePart: PagePart<typeof primerManifest> = {
  manifest: primerManifest,
  start(api: PrimerApi) {
    const { services } = api;
    const sessions = api.dependency<SessionsPageExports>('sessions');
    const store = createPrimerStore(
      initialState([], sessions.selectedSessionId()),
    );
    const boxes = createBoxes(api, store);
    const view = mountPrimerTab({
      areas: api.areas,
      sessions,
      beforeClose: (sessionId) =>
        guardClose(
          {
            store,
            toast: services.toast,
            log: services.log,
            showPrimer: (primerSessionId) => view.showPrimer(primerSessionId),
            activate: (activeSessionId) => sessions.activate(activeSessionId),
          },
          sessionId,
        ),
      setScope: (scope) => api.keys.setScope(scope),
      setResizeTarget: (target) => api.panes.setResizeTarget(target),
      setFocusTarget: (target) => api.panes.setFocusTarget(target),
      pushConfirmScope: () => api.keys.pushScope('confirm'),
      store,
      boxes,
      markdown: services.markdown,
      keys: api.dependency<KeysPageExports>('keys'),
      run: (command) => api.commands.run(command),
      commands: {
        exists: (command) => api.keys.command(command) !== undefined,
        run: (command) => api.commands.run(command),
      },
      platform: api.platform,
      uiState: services.uiState,
      timers: services.timers,
      drops: api.drops,
      toast: services.toast,
      log: services.log,
    });
    api.events.on('sessions.sessionRemoved', ({ sessionId }) =>
      view.forgetSession(sessionId),
    );
    api.layouts.show<PrimerLayout>({
      defaultLayout,
      read: readPrimerLayout,
      userLayout: () => api.settings().layout,
      setLayouts: (shown) => view.setLayouts(shown),
    });
    startAutosave({
      subscribe: (listener) => store.subscribe(listener),
      drafts: () => store.get().forms,
      idOf: (primer) => primer.formId,
      bodyOf: buildBody,
      saveStarted: (primerId, revision) =>
        store.dispatch({ type: 'saveStarted', formId: primerId, revision }),
      saveFinished: (primerId, revision, error) =>
        store.dispatch({
          type: 'saveFinished',
          formId: primerId,
          revision,
          error,
        }),
      save: (primerId, body) => api.channel.invoke('draft', primerId, body),
      delayMs: () => api.settings().autosaveDelayMs,
      timers: services.timers,
      log: services.log,
      logSource: 'primer',
    });
    const logEvent = createPrimerEventLog(services.log);
    startPrimerEvents(store, (event) => {
      logEvent(event);
      api.events.emit(event.name, event.data);
    });
    listenForPrimers(api, store, sessions);
    const exports: PrimerPageExports = {
      activePrimer() {
        const primer = activeForm(store.get());
        return primer === null ? null : presentedOf(primer);
      },
    };
    return {
      exports,
      commands: primerCommandHandlers({
        store,
        boxes,
        finish: (primerId, end) => api.channel.invoke('finish', primerId, end),
        closeSession: (sessionId) => sessions.closeSession(sessionId),
        scrollPrimer: (step, direction) => view.scrollBy(step, direction),
        openPreview: () => api.channel.invoke('openPreview'),
        toast: services.toast,
        log: services.log,
      }),
    };
  },
};
