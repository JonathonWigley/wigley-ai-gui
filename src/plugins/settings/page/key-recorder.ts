import type { Disposable } from '../../../contracts/disposable';
import { normalVimKeys } from '../../../shared/key-hints';

// What a press would do: `free` takes keys nothing else holds, `moves` takes
// keys from the commands `from` names (each a `commandTarget`), and `refused`
// keeps nothing, `note` saying why.
export type Judgement =
  | { type: 'free' }
  | { type: 'moves'; note: string; from: readonly string[] }
  | {
      type: 'refused';
      note: string;
      reason: 'leader' | 'taken' | 'group' | 'chord';
    };

// One recording on the row `key`. `replacing` is the index of the line the
// keys replace among the row's drawn lines, null when they add one; `prompt`
// shows until a press is held. `confirm: 'enter'` holds each accepted press
// until Enter keeps it (or Tab hands it to `type`, when given); `'press'`
// keeps the first accepted press at once. `cancelled` runs on Esc and when a
// later `start` replaces this recording.
export interface RecordRequest {
  key: string;
  replacing: number | null;
  prompt: string;
  confirm: 'enter' | 'press';
  judge(keys: string): Judgement;
  keep(keys: string): void;
  type?(typed: string): void;
  cancelled?(): void;
}

// The recording in progress as a row draws it: `keys` the press held (vim
// notation), `note` the last judgement's note, `isRefused` while that note
// refuses a press.
export interface Recording {
  key: string;
  replacing: number | null;
  keys: string | null;
  prompt: string;
  note: string | null;
  isRefused: boolean;
}

// One recording at a time over the page's key capture. `start` replaces a
// running recording, its `cancelled` running first; `cancel` ends one with no
// callback and does nothing when idle.
export interface KeyRecorder {
  start(request: RecordRequest): void;
  current(): Recording | null;
  cancel(): void;
}

// The page's capture of one key or chord, as `api.keys.captureKey` arms it;
// `changed` runs on each change to `current()`, and `log` takes each line.
export interface KeyRecorderDeps {
  captureKey(onKey: (keys: string) => void, onCancel: () => void): Disposable;
  changed(): void;
  log(line: string): void;
}

const KEEP_PROMPT = 'Enter keeps it — Tab types it, Esc cancels';
const KEEP_PROMPT_UNTYPED = 'Enter keeps it — Esc cancels';

const ENTER = normalVimKeys('<CR>');
const TAB = normalVimKeys('<Tab>');

interface Running {
  request: RecordRequest;
  capture: Disposable;
  held: string | null;
  note: string | null;
  isRefused: boolean;
}

// Records keys on a row: each captured press is judged, and the capture is
// armed again until the recording ends. Logs `recording <key>`,
// `recorded <keys>`, `record moves <keys> from <targets>`,
// `record refused <keys>: <reason>`, `recording kept <key> <keys>`,
// `recording typed <key>` and `recording cancelled <key>`.
export function createKeyRecorder(deps: KeyRecorderDeps): KeyRecorder {
  const { log } = deps;
  let running: Running | null = null;

  const end = () => {
    running = null;
    deps.changed();
  };

  const pressed = (state: Running, keys: string) => {
    const { request } = state;
    const normal = normalVimKeys(keys);
    const isEnterMode = request.confirm === 'enter';
    if (isEnterMode && state.held !== null && normal === ENTER) {
      const held = state.held;
      log(`recording kept ${request.key} ${held}`);
      end();
      request.keep(held);
      return;
    }
    if (isEnterMode && request.type !== undefined && normal === TAB) {
      log(`recording typed ${request.key}`);
      end();
      request.type(state.held ?? '');
      return;
    }
    log(`recorded ${keys}`);
    const judgement = request.judge(keys);
    if (judgement.type === 'refused') {
      state.note = judgement.note;
      state.isRefused = true;
      log(`record refused ${keys}: ${judgement.reason}`);
    } else {
      state.held = keys;
      state.note = judgement.type === 'moves' ? judgement.note : null;
      state.isRefused = false;
      if (judgement.type === 'moves') {
        log(`record moves ${keys} from ${judgement.from.join(', ')}`);
      }
      if (!isEnterMode) {
        end();
        request.keep(keys);
        return;
      }
    }
    state.capture = arm(state);
    deps.changed();
  };

  const arm = (state: Running): Disposable =>
    deps.captureKey(
      (keys) => {
        if (running === state) {
          pressed(state, keys);
        }
      },
      () => {
        if (running !== state) {
          return;
        }
        log(`recording cancelled ${state.request.key}`);
        end();
        state.request.cancelled?.();
      },
    );

  const cancelRunning = (): Running | null => {
    const was = running;
    if (was === null) {
      return null;
    }
    running = null;
    was.capture.dispose();
    log(`recording cancelled ${was.request.key}`);
    return was;
  };

  return {
    start(request) {
      cancelRunning()?.request.cancelled?.();
      const state: Running = {
        request,
        capture: { dispose: () => undefined },
        held: null,
        note: null,
        isRefused: false,
      };
      running = state;
      state.capture = arm(state);
      log(`recording ${request.key}`);
      deps.changed();
    },
    current() {
      if (running === null) {
        return null;
      }
      const { request, held, note, isRefused } = running;
      let prompt = request.prompt;
      if (held !== null && request.confirm === 'enter') {
        prompt = request.type === undefined ? KEEP_PROMPT_UNTYPED : KEEP_PROMPT;
      }
      return {
        key: request.key,
        replacing: request.replacing,
        keys: held,
        prompt,
        note,
        isRefused,
      };
    },
    cancel() {
      if (cancelRunning() !== null) {
        deps.changed();
      }
    },
  };
}
