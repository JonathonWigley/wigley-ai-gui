import type { Timers } from '../../../contracts/ambient';
import type { Disposable } from '../../../contracts/disposable';
import type { PluginLog } from '../../../contracts/log';
import type { ToastTone } from '../../../contracts/plugin';
import { errorText } from '../../../shared/error-text';
import { formById } from '../../../shared/page/session-forms';
import type {
  AudioCandidate,
  AudioPickerForm,
  AudioPosition,
} from '../contract';
import type { AudioOutput, DecodedAudio, Playing } from './audio/audio-output';
import { createDecodedCache, type DecodedCache } from './audio/decoded-cache';
import { playPlan } from './audio/play-plan';
import { waveformPeaks } from './audio/waveform';
import type { OpenPicker } from './picker-state';
import type { PickerStore } from './picker-store';

export const WAVEFORM_BUCKETS = 64;
export const DECODED_CACHE_BYTES = 512 * 1024 * 1024;
export const DECODE_CONCURRENCY = 2;
export const VISIBILITY_POLL_MS = 250;

export interface PickerAudioDeps {
  output: AudioOutput;
  // The bytes of one file of an open picker's candidate.
  readAudio(sessionId: string, at: AudioPosition): Promise<Uint8Array>;
  store: PickerStore;
  // A value in [0, 1), as Math.random returns.
  random(): number;
  toast(text: string, tone: ToastTone): void;
  log: PluginLog;
  // The most decoded PCM each picker keeps, in bytes.
  cacheBytes: number;
  // The most candidates read and decoded at once, across every picker.
  concurrency: number;
  // Whether the session's picker popup is the surface the user sees now.
  isShown(sessionId: string): boolean;
  timers: Timers;
}

// The page's sounds: it reads and decodes each picker's candidates as the
// picker arrives in the store, and plays one sound at a time across the page.
// A play stops on `stop()`, on a `toggle` of any row, and when its picker
// leaves the store, starts sending or stops being the visible surface; moving
// the cursor leaves it playing. No rejection escapes `toggle`.
export interface PickerAudio extends Disposable {
  // Stops the row's sound when it is the one playing; otherwise stops the
  // sound playing and plays the row's. Does nothing for a picker not in the
  // store or sending.
  toggle(formId: string, moment: number, candidate: number): void;
  stop(): void;
}

// One open picker's reads and decoded sounds.
interface PickerLoad {
  sessionId: string;
  form: AudioPickerForm;
  cache: DecodedCache;
  totalFiles: number;
  // Files that decoded, a failed candidate's earlier files included.
  okFiles: number;
  // Files decoded, failed, or skipped behind a failure.
  settledFiles: number;
}

// One candidate's files, read and decoded in file order.
interface LoadUnit {
  formId: string;
  moment: number;
  candidate: number;
}

interface CurrentPlay {
  formId: string;
  sessionId: string;
  moment: number;
  candidate: number;
  name: string;
  playing: Playing;
  // The visibility poll's timer, null between polls.
  poll: number | null;
}

export function createPickerAudio(deps: PickerAudioDeps): PickerAudio {
  const { store, log } = deps;
  const loads = new Map<string, PickerLoad>();
  let queue: LoadUnit[] = [];
  let running = 0;
  let current: CurrentPlay | null = null;
  // Raised by every toggle and stop: a play whose read lands after a later
  // one is dropped.
  let latestToggle = 0;
  let isDisposed = false;

  const isLive = (formId: string, load: PickerLoad) =>
    !isDisposed && loads.get(formId) === load;

  const clearPoll = (play: CurrentPlay) => {
    if (play.poll !== null) {
      deps.timers.clear(play.poll);
      play.poll = null;
    }
  };

  // Clears the play before stopping it, so the `ended` its stop resolves
  // finds it no longer current.
  const stopCurrent = () => {
    const play = current;
    if (play === null) {
      return;
    }
    current = null;
    clearPoll(play);
    play.playing.stop();
    store.dispatch({ type: 'playStopped', formId: play.formId });
    log(`stop ${play.name}`);
  };

  const pollVisibility = (play: CurrentPlay) => {
    play.poll = deps.timers.set(() => {
      play.poll = null;
      if (current !== play) {
        return;
      }
      if (deps.isShown(play.sessionId)) {
        pollVisibility(play);
      } else {
        stopCurrent();
      }
    }, VISIBILITY_POLL_MS);
  };

  const endedOnItsOwn = (play: CurrentPlay) => {
    if (current !== play) {
      return;
    }
    current = null;
    clearPoll(play);
    store.dispatch({ type: 'playStopped', formId: play.formId });
    log(`ended ${play.name}`);
  };

  // Reads and decodes one file into the picker's cache; null when `isWanted`
  // turned false while it read or decoded.
  const decodeFile = async (
    load: PickerLoad,
    at: AudioPosition,
    isWanted: () => boolean,
  ): Promise<DecodedAudio | null> => {
    const bytes = await deps.readAudio(load.sessionId, at);
    if (!isWanted()) {
      return null;
    }
    // Read before the decode, which may detach the bytes.
    const byteLength = bytes.length;
    const audio = await deps.output.decode(bytes);
    if (!isWanted()) {
      return null;
    }
    const { name } = candidateAt(load.form, at.moment, at.candidate);
    log(`decoded ${name} file ${at.file + 1} ${byteLength} bytes`);
    load.cache.set(soundKey(at), audio);
    return audio;
  };

  const logWhenSettled = (load: PickerLoad) => {
    if (load.settledFiles === load.totalFiles) {
      log(`decoded ${load.okFiles} of ${load.totalFiles} files`);
    }
  };

  // The candidate turns ready once every file decoded; its first failure
  // fails it, and its later files are never read.
  const runUnit = async (unit: LoadUnit) => {
    const { formId, moment } = unit;
    const load = loads.get(formId);
    if (load === undefined) {
      return;
    }
    const candidate = candidateAt(load.form, moment, unit.candidate);
    const isWanted = () => isLive(formId, load);
    let first: DecodedAudio | null = null;
    let peaks: number[] = [];
    for (let file = 0; file < candidate.files.length; file++) {
      let audio: DecodedAudio | null;
      try {
        audio = await decodeFile(
          load,
          { moment, candidate: unit.candidate, file },
          isWanted,
        );
      } catch (error) {
        if (!isWanted()) {
          return;
        }
        const reason = `file ${file + 1}: ${errorText(error)}`;
        log(`decode failed ${candidate.name} ${reason}`);
        load.settledFiles += candidate.files.length - file;
        store.dispatch({
          type: 'candidateFailed',
          formId,
          moment,
          candidate: unit.candidate,
          error: reason,
        });
        logWhenSettled(load);
        return;
      }
      if (audio === null) {
        return;
      }
      if (file === 0) {
        first = audio;
        peaks = waveformPeaks(audio.channels, WAVEFORM_BUCKETS);
      }
      load.okFiles += 1;
      load.settledFiles += 1;
    }
    if (first !== null) {
      store.dispatch({
        type: 'candidateLoaded',
        formId,
        moment,
        candidate: unit.candidate,
        peaks,
        durationSeconds: first.duration,
      });
    }
    logWhenSettled(load);
  };

  const pump = () => {
    while (!isDisposed && running < deps.concurrency && queue.length > 0) {
      const unit = queue.shift() as LoadUnit;
      running += 1;
      void runUnit(unit).finally(() => {
        running -= 1;
        pump();
      });
    }
  };

  const addPicker = (picker: OpenPicker) => {
    const { moments } = picker.picker;
    loads.set(picker.formId, {
      sessionId: picker.sessionId,
      form: picker.picker,
      cache: createDecodedCache(deps.cacheBytes),
      totalFiles: moments.reduce(
        (sum, moment) =>
          sum +
          moment.candidates.reduce(
            (files, candidate) => files + candidate.files.length,
            0,
          ),
        0,
      ),
      okFiles: 0,
      settledFiles: 0,
    });
    moments.forEach((moment, m) =>
      moment.candidates.forEach((_, c) =>
        queue.push({ formId: picker.formId, moment: m, candidate: c }),
      ),
    );
  };

  // Loads the pickers new to the store, drops the ones gone from it, and
  // stops a play whose picker left or started sending.
  const sync = () => {
    const state = store.get();
    for (const picker of state.forms) {
      if (!loads.has(picker.formId)) {
        addPicker(picker);
      }
    }
    for (const formId of [...loads.keys()]) {
      if (formById(state, formId) === undefined) {
        loads.delete(formId);
      }
    }
    queue = queue.filter((unit) => loads.has(unit.formId));
    const playingPicker =
      current === null ? undefined : formById(state, current.formId);
    const isPlayingPickerGone =
      current !== null &&
      (playingPicker === undefined || playingPicker.sending !== null);
    if (isPlayingPickerGone) {
      stopCurrent();
    }
    pump();
  };

  // Plays the plan's file, from the cache or read again; dropped when a later
  // toggle or stop came, or its picker left or started sending, first.
  const startPlay = async (
    token: number,
    formId: string,
    load: PickerLoad,
    moment: number,
    candidateIndex: number,
  ) => {
    const candidate = candidateAt(load.form, moment, candidateIndex);
    const isWanted = () =>
      token === latestToggle &&
      isLive(formId, load) &&
      formById(store.get(), formId)?.sending === null;
    try {
      const plan = playPlan(candidate, deps.random);
      const at = { moment, candidate: candidateIndex, file: plan.file };
      const audio =
        load.cache.get(soundKey(at)) ?? (await decodeFile(load, at, isWanted));
      if (audio === null || !isWanted()) {
        return;
      }
      const play: CurrentPlay = {
        formId,
        sessionId: load.sessionId,
        moment,
        candidate: candidateIndex,
        name: candidate.name,
        playing: deps.output.play(audio, plan),
        poll: null,
      };
      current = play;
      store.dispatch({
        type: 'playStarted',
        formId,
        moment,
        candidate: candidateIndex,
      });
      log(`play ${candidate.name} ${candidate.play}`);
      log(
        `play plan file ${plan.file + 1} of ${candidate.files.length} rate ${plan.rate.toFixed(3)} gain ${plan.gain.toFixed(2)}`,
      );
      pollVisibility(play);
      void play.playing.ended.then(() => endedOnItsOwn(play));
    } catch (error) {
      if (!isWanted()) {
        return;
      }
      const reason = errorText(error);
      log(`play failed ${candidate.name}: ${reason}`);
      deps.toast(`Can't play ${candidate.name}: ${reason}`, 'error');
    }
  };

  const subscription = store.subscribe(sync);
  sync();

  return {
    toggle(formId, moment, candidateIndex) {
      const picker = formById(store.get(), formId);
      const load = loads.get(formId);
      if (
        isDisposed ||
        picker === undefined ||
        load === undefined ||
        picker.sending !== null
      ) {
        return;
      }
      const wasPlaying = current;
      latestToggle += 1;
      stopCurrent();
      const isSameRow =
        wasPlaying !== null &&
        wasPlaying.formId === formId &&
        wasPlaying.moment === moment &&
        wasPlaying.candidate === candidateIndex;
      if (isSameRow) {
        return;
      }
      const candidate = candidateAt(load.form, moment, candidateIndex);
      if (picker.loads[moment][candidateIndex].load !== 'ready') {
        log(`not loaded ${candidate.name}`);
        return;
      }
      void startPlay(latestToggle, formId, load, moment, candidateIndex);
    },
    stop() {
      latestToggle += 1;
      stopCurrent();
    },
    dispose() {
      isDisposed = true;
      latestToggle += 1;
      stopCurrent();
      subscription.dispose();
      queue = [];
      loads.clear();
    },
  };
}

function candidateAt(
  form: AudioPickerForm,
  moment: number,
  candidate: number,
): AudioCandidate {
  return form.moments[moment].candidates[candidate];
}

// The cache key of one file: `<moment>.<candidate>.<file>`.
function soundKey(at: AudioPosition): string {
  return `${at.moment}.${at.candidate}.${at.file}`;
}
