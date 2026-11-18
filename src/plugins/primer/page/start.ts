import '../../../shared/page/markdown.css';
import './primer.css';
import type { Disposable } from '../../../contracts/disposable';
import type { PageApi, PagePart } from '../../../contracts/plugin';
import { errorText } from '../../../shared/error-text';
import { startAutosave } from '../../../shared/page/autosave';
import { onPageHide } from '../../../shared/page/page-hide';
import {
  followSessionFormPlaces,
  type SessionFormPlaces,
} from '../../../shared/page/session-form-places';
import {
  createEditorBoxes,
  type EditorBoxes,
} from '../../../shared/page/editor-boxes';
import {
  activeForm,
  formClosesAtOnce,
} from '../../../shared/page/session-forms';
import {
  followRows,
  sessionsActiveSlot,
  sessionsPageKey,
  sessionsRowsSlot,
} from '../../sessions/contract';
import {
  type PrimerChannel,
  type PrimerPageEvents,
  type PrimerPageExports,
  type PrimerPlace,
  primerPlaceSlot,
} from '../contract';
import defaultLayout from '../layouts/default/layout.js';
import defaultStylesheet from '../layouts/default/layout.css?url';
import type { PrimerLayout } from '../layouts/layout';
import { primerManifest } from '../manifest';
import { focusActionFor, PRIMER_BOX_IDENTITY, type PrimerBox } from './boxes';
import { registerDemoSteps } from './demo-steps';
import { readPrimerLayout } from './layout/read-primer-layout';
import {
  closePrimerFromMain,
  mayClosePrimer,
  primerCommandHandlers,
} from './primer-commands';
import {
  createPrimerEventLog,
  presentedOf,
  startPrimerEvents,
} from './primer-events';
import { buildBody, initialState, primerPlace } from './primer-state';
import { createPrimerStore, type PrimerStore } from './primer-store';
import { mountPrimerPopups } from './primer-view';
import { kitCommandsOf } from '../../../shared/page/layout-host/base-kit';

type PrimerApi = PageApi<
  typeof primerManifest,
  PrimerChannel,
  PrimerPageEvents
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
// when main closes it, and the read's primers go back to the places the last
// page saved, the read tracked as a page restore (`api.restores`). The
// `Disposable` stops an `openForms` read still in flight from
// showing its primers.
function listenForPrimers(
  api: PrimerApi,
  store: PrimerStore,
  places: SessionFormPlaces<PrimerPlace>,
): Disposable {
  const { log, toast } = api.services;
  api.channel.on('formShown', (primer) =>
    store.dispatch({ type: 'formShown', form: primer }),
  );
  api.channel.on('formClosed', (closed) =>
    closePrimerFromMain(
      {
        store,
        toast,
        log,
      },
      closed,
    ),
  );
  api.state.read(sessionsActiveSlot).on((sessionId) =>
    store.dispatch({
      type: 'sessionActivated',
      sessionId: sessionId ?? null,
    }),
  );
  let isStopped = false;
  // A restored primer's popup can move the key base.
  const openFormsRead = api.channel
    .invoke('openForms')
    .then((primers) => {
      if (isStopped) {
        return;
      }
      for (const primer of primers) {
        store.dispatch({ type: 'formShown', form: primer });
      }
      places.formsRead(primers.map((primer) => primer.formId));
    })
    .catch((error) => log(`open primers not read: ${errorText(error)}`));
  api.restores.track(openFormsRead);
  return {
    dispose() {
      isStopped = true;
    },
  };
}

// Shows each agent primer in its session's primer popup and sends the user's
// edits back to main: drafts as the edits pause, the finish on send or cancel.
// While a primer popup is the visible surface, the key scope, the resize keys'
// split and the focus keys' panes follow the primer view. The close key on a
// session with an open primer cancels the primer and closes the session at
// once; a primer being sent keeps its session. Every store change emits the
// primer page events it makes, each logged as it goes; other plugins read the
// active primer through the exports. The popup draws
// through the primer layout `primer.layout` names, redrawing as it or the
// layout changes. Each open primer's place (`primerPlaceSlot`) and its unsaved
// edits, saved at once on page hide, outlive a page reload. It registers the
// page half of the `primer.primer` demo step.
export const primerPagePart: PagePart<typeof primerManifest> = {
  manifest: primerManifest,
  start(api: PrimerApi) {
    const { services } = api;
    const sessions = api.dependency(sessionsPageKey);
    const store = createPrimerStore(
      initialState([], api.state.read(sessionsActiveSlot).get() ?? null),
    );
    const boxes = createBoxes(api, store);
    const places = followSessionFormPlaces({
      writer: api.state.publish(primerPlaceSlot),
      store,
      placeOf: primerPlace,
      restore: (formId, place) =>
        store.dispatch({ type: 'placeRestored', formId, place }),
    });
    const view = mountPrimerPopups({
      areas: api.areas,
      sessions,
      closesAtOnce: (sessionId) => formClosesAtOnce(store, sessionId),
      beforeClose: (sessionId) =>
        mayClosePrimer(
          { store, toast: services.toast, log: services.log },
          sessionId,
        ),
      setScope: (scope) => api.keys.setScope(scope),
      setResizeTarget: (target) => api.panes.setResizeTarget(target),
      setFocusTarget: (target) => api.panes.setFocusTarget(target),
      pushConfirmScope: () => api.keys.pushScope('confirm'),
      store,
      boxes,
      markdown: services.markdown,
      keys: api.keys,
      run: (command) => api.commands.run(command),
      commands: kitCommandsOf(api),
      platform: api.platform.os,
      state: api.state.forLayouts,
      uiState: services.uiState,
      timers: services.timers,
      drops: api.drops,
      toast: services.toast,
      log: services.log,
      savedPlaces: places.saved,
    });
    followRows(api.state.read(sessionsRowsSlot), {
      removed: (sessionId) => view.forgetSession(sessionId),
    });
    api.layouts.show<PrimerLayout>({
      defaultLayout,
      defaultStylesheet,
      read: readPrimerLayout,
      userLayout: () => api.settings().layout,
      setLayouts: (shown) => view.setLayouts(shown),
    });
    const autosave = startAutosave({
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
      onPageHide,
      timers: services.timers,
      log: services.log,
    });
    const logEvent = createPrimerEventLog(services.log);
    startPrimerEvents(store, (event) => {
      logEvent(event);
      api.events.emit(event.name, event.data);
    });
    const primersRead = listenForPrimers(api, store, places);
    registerDemoSteps(services, {
      store,
      activate: (sessionId) => sessions.activate(sessionId),
      timers: services.timers,
      commands: api.commands,
      log: services.log,
    });
    const exports: PrimerPageExports = {
      activePrimer() {
        const primer = activeForm(store.get());
        return primer === null ? null : presentedOf(primer);
      },
    };
    return {
      exports: () => exports,
      dispose() {
        primersRead.dispose();
        places.dispose();
        autosave.dispose();
        view.dispose();
      },
      commands: primerCommandHandlers({
        store,
        boxes,
        finish: (primerId, end) => api.channel.invoke('finish', primerId, end),
        scrollPrimer: (step, direction) => view.scrollBy(step, direction),
        openPreview: () => api.channel.invoke('openPreview'),
        toast: services.toast,
        log: services.log,
      }),
    };
  },
};
