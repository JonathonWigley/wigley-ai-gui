import '../../../shared/page/markdown.css';
import './forms.css';
import type { Disposable } from '../../../contracts/disposable';
import type { PageApi, PagePart } from '../../../contracts/plugin';
import { errorText } from '../../../shared/error-text';
import {
  createEditorBoxes,
  type EditorBoxes,
} from '../../../shared/page/editor-boxes';
import {
  activeForm,
  formById,
  formClosesAtOnce,
} from '../../../shared/page/session-forms';
import { createReducerStore } from '../../../shared/page/reducer-store';
import { onPageHide } from '../../../shared/page/page-hide';
import {
  followSessionFormPlaces,
  type SessionFormPlaces,
} from '../../../shared/page/session-form-places';
import {
  followRows,
  sessionsActiveSlot,
  sessionsPageKey,
  sessionsRowsSlot,
} from '../../sessions/contract';
import {
  type FormsChannel,
  type FormsPageEvents,
  type FormsPageExports,
  formsPlaceSlot,
  type RoundPlace,
} from '../contract';
import defaultLayout from '../layouts/default/layout.js';
import defaultStylesheet from '../layouts/default/layout.css?url';
import type { Layout } from '../layouts/layout';
import { formsManifest } from '../manifest';
import { startRoundAutosave } from './autosave';
import { type BoxRef, FORMS_BOX_IDENTITY, focusActionFor } from './boxes';
import { createFormsContributions } from './contributions';
import {
  apply,
  buildBody,
  type FormsStore,
  initialState,
  roundPlace,
} from './form-state';
import {
  closeRoundFromMain,
  formsCommandHandlers,
  mayCloseRound,
} from './forms-commands';
import {
  createFormsEventLog,
  openRoundOf,
  startFormsEvents,
} from './forms-events';
import { mountFormsView } from './forms-view';
import { readLayout } from './layout/read-layout';
import { roundLayoutNames } from './layout/layout-resolver';
import { presentedRoundOf } from './presented-round';
import { kitCommandsOf } from '../../../shared/page/layout-host/base-kit';

type FormsApi = PageApi<typeof formsManifest, FormsChannel, FormsPageEvents>;

// Each box's edits reach the store, and a box taking focus focuses its item.
function createBoxes(api: FormsApi, store: FormsStore): EditorBoxes<BoxRef> {
  return createEditorBoxes(
    api.services.editor,
    {
      changed: (box, value) =>
        store.dispatch({
          type: 'setText',
          formId: box.roundId,
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
    FORMS_BOX_IDENTITY,
  );
}

// Listeners first: a round shown while openForms is in flight arrives in
// both, and showing an open round again changes nothing. The active round
// follows the session the sessions plugin focuses, and a round leaves only when
// main closes it. Main's forms map to the page's rounds here, and the read's
// rounds go back to the places the last page saved. The `Disposable` stops an
// `openForms` read still in flight from showing its rounds.
function listenForRounds(
  api: FormsApi,
  store: FormsStore,
  places: SessionFormPlaces<RoundPlace>,
): Disposable {
  const { log, toast } = api.services;
  api.channel.on('formShown', (form) =>
    store.dispatch({ type: 'formShown', form: presentedRoundOf(form) }),
  );
  api.channel.on('formClosed', (closed) =>
    closeRoundFromMain(
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
  void api.channel
    .invoke('openForms')
    .then((forms) => {
      if (isStopped) {
        return;
      }
      for (const form of forms) {
        store.dispatch({ type: 'formShown', form: presentedRoundOf(form) });
      }
      places.formsRead(forms.map((form) => form.formId));
    })
    .catch((error) => log(`open rounds not read: ${errorText(error)}`));
  return {
    dispose() {
      isStopped = true;
    },
  };
}

// Shows each agent round in its session's Form tab and sends the user's answers
// back to main; while a Form tab is the visible tab, the key scope follows the
// forms view. A session with an open round closes only through the cancel
// prompt. Each round draws with the layouts it names, the user's layout and
// `default`, loaded from main's set again whenever the set, the setting or the
// open rounds change. Every store change emits the forms page events it makes,
// each logged as it goes; other plugins read the open rounds and add card parts
// and review columns through the exports, each add or removal rebuilding the
// open rounds. Each open round's place (`formsPlaceSlot`) and its unsaved
// answers, saved at once on page hide, outlive a page reload.
export const formsPagePart: PagePart<typeof formsManifest> = {
  manifest: formsManifest,
  start(api: FormsApi) {
    const { services } = api;
    const sessions = api.dependency(sessionsPageKey);
    const store = createReducerStore(
      initialState([], api.state.read(sessionsActiveSlot).get() ?? null),
      apply,
    );
    const boxes = createBoxes(api, store);
    const places = followSessionFormPlaces({
      writer: api.state.publish(formsPlaceSlot),
      store,
      placeOf: roundPlace,
      restore: (formId, place) =>
        store.dispatch({ type: 'placeRestored', formId, place }),
    });
    const contributions = createFormsContributions();
    const view = mountFormsView({
      areas: api.areas,
      sessions,
      closesAtOnce: (sessionId) => formClosesAtOnce(store, sessionId),
      beforeClose: (sessionId) =>
        mayCloseRound(
          { store, toast: services.toast, log: services.log },
          sessionId,
        ),
      setScope: (formsView) => api.keys.setScope(formsView),
      setResizeTarget: (target) => api.panes.setResizeTarget(target),
      pushConfirmScope: () => api.keys.pushScope('confirm'),
      store,
      boxes,
      markdown: services.markdown,
      keys: api.keys,
      run: (command) => api.commands.run(command),
      commands: kitCommandsOf(api),
      contributions,
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
    const autosave = startRoundAutosave({
      store,
      save: (roundId, body) => api.channel.invoke('draft', roundId, body),
      delayMs: () => api.settings().autosaveDelayMs,
      onPageHide,
      timers: services.timers,
      log: services.log,
    });
    contributions.onChanged(() => view.rebuild());
    const logEvent = createFormsEventLog(store.get, services.log);
    startFormsEvents(store, (event) => {
      logEvent(event);
      api.events.emit(event.name, event.data);
    });
    const roundsRead = listenForRounds(api, store, places);
    const layoutShow = api.layouts.show<Layout>({
      defaultLayout,
      defaultStylesheet,
      read: readLayout,
      userLayout: () => api.settings().layout,
      namesInUse: () =>
        store.get().forms.flatMap((round) => roundLayoutNames(round.round)),
      setLayouts: (shown) => view.setLayouts(shown),
    });
    const layoutRefresh = store.subscribe(() => layoutShow.refresh());
    return {
      exports: (consumer): FormsPageExports => ({
        activeRound() {
          const round = activeForm(store.get());
          return round === null ? null : openRoundOf(round);
        },
        answers(roundId) {
          const round = formById(store.get(), roundId);
          return round === undefined ? null : buildBody(round);
        },
        addCardPart: (part) => consumer.track(contributions.addCardPart(part)),
        addReviewColumn: (column) =>
          consumer.track(contributions.addReviewColumn(column)),
      }),
      dispose() {
        roundsRead.dispose();
        places.dispose();
        autosave.dispose();
        layoutRefresh.dispose();
        view.dispose();
      },
      commands: formsCommandHandlers({
        store,
        boxes,
        finish: (roundId, end) => api.channel.invoke('finish', roundId, end),
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
