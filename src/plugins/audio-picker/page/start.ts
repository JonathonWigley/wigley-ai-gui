import '../../../shared/page/markdown.css';
import './picker.css';
import type { Disposable } from '../../../contracts/disposable';
import type { PageApi, PagePart } from '../../../contracts/plugin';
import { callEach } from '../../../shared/call-each';
import { errorText } from '../../../shared/error-text';
import { startAutosave } from '../../../shared/page/autosave';
import {
  createEditorBoxes,
  type EditorBoxes,
} from '../../../shared/page/editor-boxes';
import { kitCommandsOf } from '../../../shared/page/layout-host/base-kit';
import { onPageHide } from '../../../shared/page/page-hide';
import {
  followSessionFormPlaces,
  type SessionFormPlaces,
} from '../../../shared/page/session-form-places';
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
  type AudioPickerChannel,
  type AudioPickerPageExports,
  type AudioPickerPlace,
  audioPickerPlaceSlot,
} from '../contract';
import defaultLayout from '../layouts/default/layout.js';
import defaultStylesheet from '../layouts/default/layout.css?url';
import type { AudioPickerLayout } from '../layouts/layout';
import { audioPickerManifest } from '../manifest';
import type { AudioOutput } from './audio/audio-output';
import { createWebAudioOutput } from './audio/web-audio-output';
import { registerDemoSteps } from './demo-steps';
import { PICKER_BOX_IDENTITY, type PickerBox } from './layout/picker-kit';
import { readPickerLayout } from './layout/read-picker-layout';
import {
  createPickerAudio,
  DECODE_CONCURRENCY,
  DECODED_CACHE_BYTES,
} from './picker-audio';
import {
  closePickerFromMain,
  mayClosePicker,
  pickerCommandHandlers,
} from './picker-commands';
import { buildBody, initialState, pickerPlace } from './picker-state';
import { createPickerStore, type PickerStore } from './picker-store';
import { mountPickerPopups } from './picker-view';

type PickerApi = PageApi<typeof audioPickerManifest, AudioPickerChannel>;

// Each notes box's edits reach the store, and a box taking focus shows its
// moment; the editor boxes log the focus once, however the box took it.
function createBoxes(
  api: PickerApi,
  store: PickerStore,
): EditorBoxes<PickerBox> {
  const { log } = api.services;
  return createEditorBoxes(
    api.services.editor,
    {
      changed: (box, value) =>
        store.dispatch({
          type: 'setNote',
          formId: box.formId,
          moment: box.moment,
          value,
        }),
      activated: (box) =>
        store.dispatch({
          type: 'showMoment',
          formId: box.formId,
          moment: box.moment,
        }),
    },
    log,
    PICKER_BOX_IDENTITY,
  );
}

// Listeners first: a picker shown while openForms is in flight arrives in
// both, and showing an open picker again changes nothing. The active picker
// follows the session the sessions plugin focuses, a picker leaves only when
// main closes it, and the read's pickers go back to the places the last page
// saved, the read tracked as a page restore (`api.restores`). The
// `Disposable` stops an `openForms` read still in flight from showing its
// pickers.
function listenForPickers(
  api: PickerApi,
  store: PickerStore,
  places: SessionFormPlaces<AudioPickerPlace>,
): Disposable {
  const { log, toast } = api.services;
  api.channel.on('formShown', (picker) =>
    store.dispatch({ type: 'formShown', form: picker }),
  );
  api.channel.on('formClosed', (closed) =>
    closePickerFromMain({ store, toast, log }, closed),
  );
  api.state.read(sessionsActiveSlot).on((sessionId) =>
    store.dispatch({
      type: 'sessionActivated',
      sessionId: sessionId ?? null,
    }),
  );
  let isStopped = false;
  const openFormsRead = api.channel
    .invoke('openForms')
    .then((pickers) => {
      if (isStopped) {
        return;
      }
      for (const picker of pickers) {
        store.dispatch({ type: 'formShown', form: picker });
      }
      places.formsRead(pickers.map((picker) => picker.formId));
    })
    .catch((error) => log(`open audio pickers not read: ${errorText(error)}`));
  api.restores.track(openFormsRead);
  return {
    dispose() {
      isStopped = true;
    },
  };
}

// Shows each audio picker an agent opens in its session's picker popup, reads
// and decodes its candidates' sounds and plays them one at a time, and sends
// the user's choices back to main: drafts as the edits pause, the finish on
// send or cancel. While a picker popup is the visible surface, the key scope
// follows the picker view; a play stops once it is not. The close key on a
// session with an open picker cancels the picker and closes the session at
// once; a picker being sent keeps its session. Other plugins read the active
// picker through the exports. The popup draws through the layout
// `audio-picker.layout` names, redrawing as it or the layout changes. Each
// open picker's place (`audioPickerPlaceSlot`) and its unsaved edits, saved at
// once on page hide, outlive a page reload. `makeOutput` makes the output the
// part decodes and plays through, disposed when the part stops. It registers
// the page half of the `audio-picker.picker` demo step.
export function createAudioPickerPagePart(
  makeOutput: () => AudioOutput,
): PagePart<typeof audioPickerManifest> {
  return {
    manifest: audioPickerManifest,
    start(api: PickerApi) {
      const { services } = api;
      const sessions = api.dependency(sessionsPageKey);
      const store = createPickerStore(
        initialState([], api.state.read(sessionsActiveSlot).get() ?? null),
      );
      const boxes = createBoxes(api, store);
      const places = followSessionFormPlaces({
        writer: api.state.publish(audioPickerPlaceSlot),
        store,
        placeOf: pickerPlace,
        restore: (formId, place) =>
          store.dispatch({ type: 'placeRestored', formId, place }),
      });
      const popups = mountPickerPopups({
        areas: api.areas,
        sessions,
        closesAtOnce: (sessionId) => formClosesAtOnce(store, sessionId),
        beforeClose: (sessionId) =>
          mayClosePicker(
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
        log: services.log,
        savedPlaces: places.saved,
      });
      const output = makeOutput();
      // The focused pane shows the session and its top popup is a picker,
      // which is that session's one picker.
      const audio = createPickerAudio({
        output,
        readAudio: (sessionId, at) =>
          api.channel.invoke('readAudio', sessionId, at),
        store,
        random: Math.random,
        toast: services.toast,
        log: services.log,
        cacheBytes: DECODED_CACHE_BYTES,
        concurrency: DECODE_CONCURRENCY,
        isShown: (sessionId) =>
          sessions.shownSessionId() === sessionId && popups.isShown(),
        timers: services.timers,
      });
      followRows(api.state.read(sessionsRowsSlot), {
        removed: (sessionId) => popups.forgetSession(sessionId),
      });
      api.layouts.show<AudioPickerLayout>({
        defaultLayout,
        defaultStylesheet,
        read: readPickerLayout,
        userLayout: () => api.settings().layout,
        setLayouts: (shown) => popups.setLayouts(shown),
      });
      const autosave = startAutosave({
        subscribe: (listener) => store.subscribe(listener),
        drafts: () => store.get().forms,
        idOf: (picker) => picker.formId,
        bodyOf: buildBody,
        saveStarted: (formId, revision) =>
          store.dispatch({ type: 'saveStarted', formId, revision }),
        saveFinished: (formId, revision, error) =>
          store.dispatch({ type: 'saveFinished', formId, revision, error }),
        save: (formId, body) => api.channel.invoke('draft', formId, body),
        delayMs: () => api.settings().autosaveDelayMs,
        onPageHide,
        timers: services.timers,
        log: services.log,
      });
      const pickersRead = listenForPickers(api, store, places);
      registerDemoSteps(services, {
        store,
        activate: (sessionId) => sessions.activate(sessionId),
        timers: services.timers,
        commands: api.commands,
        log: services.log,
      });
      const exports: AudioPickerPageExports = {
        activePicker() {
          const picker = activeForm(store.get());
          return picker === null
            ? null
            : {
                formId: picker.formId,
                sessionId: picker.sessionId,
                label: picker.label,
                form: picker.picker,
                draft: buildBody(picker),
              };
        },
      };
      let isStopped = false;
      return {
        exports: () => exports,
        dispose() {
          isStopped = true;
          callEach<Disposable>(
            [pickersRead, places, autosave, popups, audio, output],
            (each) => each.dispose(),
          );
        },
        commands: pickerCommandHandlers({
          store,
          boxes,
          audio,
          finish: (formId, end) => api.channel.invoke('finish', formId, end),
          scrollPicker: (step, direction) => popups.scrollBy(step, direction),
          openPreview: () => api.channel.invoke('openPreview'),
          toast: services.toast,
          log: services.log,
          isStopped: () => isStopped,
        }),
      };
    },
  };
}

export const audioPickerPagePart: PagePart<typeof audioPickerManifest> =
  createAudioPickerPagePart(() => createWebAudioOutput());
