import { describe, expect, it } from 'vitest';
import type { ToastTone } from '../../../contracts/plugin';
import { activeForm } from '../../../shared/page/session-forms';
import type { AudioPosition } from '../contract';
import type { DecodedAudio, Playing } from './audio/audio-output';
import type { PlayPlan } from './audio/play-plan';
import {
  createPickerAudio,
  type PickerAudio,
  WAVEFORM_BUCKETS,
} from './picker-audio';
import {
  type CandidateLoad,
  initialState,
  type PickerAction,
} from './picker-state';
import { createPickerStore, type PickerStore } from './picker-store';
import { presentedPicker, soundsPicker } from './test-pickers';

// Files of the sounds fixture, as `<moment>.<candidate>.<file>`: `Click` is
// 0.0.0, `Steps` 0.1.0 to 0.1.2, `Rain` 1.0.0.
type FileKey = string;

interface PendingRead {
  key: FileKey;
  resolve(bytes: Uint8Array | null): void;
  reject(error: Error): void;
}

interface Options {
  random?: number;
  cacheBytes?: number;
  // Files whose decode rejects with `bad data`.
  badDecodes?: FileKey[];
  playThrows?: boolean;
  // A play's stop counts, then throws.
  stopThrows?: boolean;
}

function keyOf(at: AudioPosition): FileKey {
  return `${at.moment}.${at.candidate}.${at.file}`;
}

// A settled read's bytes: 11 bytes for file 1, 12 for file 2, and so on.
function bytesOf(key: FileKey): Uint8Array {
  return new Uint8Array(11 + Number(key.split('.')[2]));
}

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

// Picker `p1` of the sounds fixture, active, shown once `show()` runs. Every
// decoded sound is 100 bytes; a file's samples are all 0.5 for file 1 and 0.9
// for the others, and file 1 lasts 1.25 s, the others 3 s.
function setup(options: Options = {}) {
  const inner = createPickerStore(initialState([], 'p1-session'));
  const dispatched: PickerAction[] = [];
  let liveSubscriptions = 0;
  const store: PickerStore = {
    get: () => inner.get(),
    dispatch: (action) => {
      dispatched.push(action);
      inner.dispatch(action);
    },
    subscribe: (listener) => {
      const subscription = inner.subscribe(listener);
      liveSubscriptions += 1;
      return {
        dispose: () => {
          liveSubscriptions -= 1;
          subscription.dispose();
        },
      };
    },
  };
  const started: FileKey[] = [];
  const pending: PendingRead[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const fileOfBytes = new WeakMap<Uint8Array, FileKey>();
  const fileOfAudio = new WeakMap<DecodedAudio, FileKey>();
  const plays: { file: FileKey | undefined; plan: PlayPlan; stops: number }[] =
    [];
  const endings: (() => void)[] = [];
  const logs: string[] = [];
  const toasts: [string, ToastTone][] = [];
  const timers = new Map<number, () => void>();
  let nextTimer = 1;
  const hidden = new Set<string>();
  const audio: PickerAudio = createPickerAudio({
    output: {
      decode: (bytes) => {
        const key = fileOfBytes.get(bytes) as FileKey;
        if (options.badDecodes?.includes(key) === true) {
          return Promise.reject(new Error('bad data'));
        }
        const isFirst = key.endsWith('.0');
        const decoded: DecodedAudio = {
          duration: isFirst ? 1.25 : 3,
          channels: [new Float32Array(8).fill(isFirst ? 0.5 : 0.9)],
          byteSize: 100,
        };
        fileOfAudio.set(decoded, key);
        return Promise.resolve(decoded);
      },
      play: (decoded, plan) => {
        if (options.playThrows === true) {
          throw new Error('boom');
        }
        const play = { file: fileOfAudio.get(decoded), plan, stops: 0 };
        plays.push(play);
        let end = () => {};
        const ended = new Promise<void>((resolve) => {
          end = resolve;
        });
        endings.push(end);
        const playing: Playing = {
          stop: () => {
            play.stops += 1;
            end();
            if (options.stopThrows === true) {
              throw new Error('stop refused');
            }
          },
          ended,
        };
        return playing;
      },
      dispose: () => {},
    },
    readAudio: (_sessionId, at) =>
      new Promise<Uint8Array | null>((resolve, reject) => {
        const key = keyOf(at);
        started.push(key);
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        const settled = () => {
          inFlight -= 1;
        };
        pending.push({
          key,
          resolve: (bytes) => {
            settled();
            if (bytes !== null) {
              fileOfBytes.set(bytes, key);
            }
            resolve(bytes);
          },
          reject: (error) => {
            settled();
            reject(error);
          },
        });
      }),
    store,
    random: () => options.random ?? 0,
    toast: (text, tone) => toasts.push([text, tone]),
    log: (message) => logs.push(message),
    cacheBytes: options.cacheBytes ?? 1000,
    concurrency: 2,
    isShown: (sessionId) => !hidden.has(sessionId),
    timers: {
      set: (run) => {
        const handle = nextTimer++;
        timers.set(handle, run);
        return handle;
      },
      clear: (handle) => {
        timers.delete(handle);
      },
    },
  });

  // Settles the read of `key`, rejecting it with `error` when given.
  const settle = async (key: FileKey, error?: Error) => {
    const index = pending.findIndex((read) => read.key === key);
    const [read] = pending.splice(index, 1);
    if (error === undefined) {
      read.resolve(bytesOf(key));
    } else {
      read.reject(error);
    }
    await flush();
  };

  return {
    store,
    audio,
    dispatched,
    started,
    pending,
    plays,
    endings,
    logs,
    toasts,
    timers,
    hidden,
    maxInFlight: () => maxInFlight,
    liveSubscriptions: () => liveSubscriptions,
    show: (formId = 'p1') =>
      store.dispatch({
        type: 'formShown',
        form: presentedPicker(formId, { form: soundsPicker() }),
      }),
    settle,
    // Settles every read, oldest first, the read of `failing` with `gone`.
    settleAll: async (failing?: FileKey) => {
      while (pending.length > 0) {
        const { key } = pending[0];
        await settle(key, key === failing ? new Error('gone') : undefined);
      }
    },
    // Runs every pending timer, as VISIBILITY_POLL_MS passing does.
    advance: () => {
      // Each run re-arms its timer, which a live iteration would run again.
      // oxlint-disable-next-line unicorn/no-useless-spread
      for (const [handle, run] of [...timers]) {
        timers.delete(handle);
        run();
      }
    },
    loadOf: (moment: number, candidate: number): CandidateLoad | undefined =>
      activeForm(store.get())?.loads[moment][candidate],
    playing: () => activeForm(store.get())?.playing ?? null,
  };
}

type Harness = ReturnType<typeof setup>;

describe('createPickerAudio', () => {
  it.each<[string, (keys: FileKey[]) => FileKey, FileKey[]]>([
    [
      "the variants' reads settled first",
      (keys) => keys.find((key) => key.startsWith('0.1.')) ?? keys[0],
      ['0.0.0', '0.1.0', '0.1.1', '0.1.2', '1.0.0'],
    ],
    [
      'every read settled in the order it started',
      (keys) => keys[0],
      ['0.0.0', '0.1.0', '1.0.0', '0.1.1', '0.1.2'],
    ],
  ])(
    'createPickerAudio_PickerShown_ReadsEachCandidateSeriallyTwoAtATime: %s',
    async (_name, next, order) => {
      const h = setup();
      h.show();

      while (h.pending.length > 0) {
        await h.settle(next(h.pending.map((read) => read.key)));
      }

      expect(h.started).toEqual(order);
      expect(h.maxInFlight()).toBe(2);
    },
  );

  it.each<
    [string, Options, FileKey | undefined, CandidateLoad, string[], FileKey[]]
  >([
    [
      'every file decodes',
      {},
      undefined,
      {
        load: 'ready',
        peaks: Array<number>(WAVEFORM_BUCKETS).fill(0.5),
        durationSeconds: 1.25,
        error: null,
      },
      [
        'decoded Steps file 1 11 bytes',
        'decoded Steps file 2 12 bytes',
        'decoded Steps file 3 13 bytes',
      ],
      ['0.1.0', '0.1.1', '0.1.2'],
    ],
    [
      'the read of file 2 fails',
      {},
      '0.1.1',
      {
        load: 'error',
        peaks: null,
        durationSeconds: null,
        error: 'file 2: gone',
      },
      ['decoded Steps file 1 11 bytes', 'decode failed Steps file 2: gone'],
      ['0.1.0', '0.1.1'],
    ],
    [
      'the decode of file 1 fails',
      { badDecodes: ['0.1.0'] },
      undefined,
      {
        load: 'error',
        peaks: null,
        durationSeconds: null,
        error: 'file 1: bad data',
      },
      ['decode failed Steps file 1: bad data'],
      ['0.1.0'],
    ],
  ])(
    'createPickerAudio_FileSettles_SetsTheRowAndLogs: %s',
    async (_name, options, failing, load, lines, reads) => {
      const h = setup(options);
      h.show();

      await h.settleAll(failing);

      expect(h.loadOf(0, 1)).toEqual(load);
      expect(h.logs.filter((line) => line.includes('Steps'))).toEqual(lines);
      expect(h.started.filter((key) => key.startsWith('0.1.'))).toEqual(reads);
    },
  );

  it.each<[string, FileKey | undefined, string]>([
    ['every file decodes', undefined, 'decoded 5 of 5 files'],
    ["the variants' file 2 fails", '0.1.1', 'decoded 3 of 5 files'],
  ])(
    'createPickerAudio_EveryFileSettled_LogsDecodedOnce: %s',
    async (_name, failing, line) => {
      const h = setup();
      h.show();

      await h.settleAll(failing);

      expect(h.logs.filter((logged) => logged.endsWith(' files'))).toEqual([
        line,
      ]);
    },
  );

  it.each<
    [
      string,
      Options & { loaded?: boolean },
      (h: Harness) => void,
      { file: FileKey | undefined; plan: PlayPlan; stops: number }[],
      string[],
      [string, ToastTone][],
      { moment: number; candidate: number } | null,
    ]
  >([
    [
      'the one-shot',
      {},
      (h) => h.audio.toggle('p1', 0, 0),
      [
        {
          file: '0.0.0',
          plan: { file: 0, rate: 1, gain: 0.6, loop: false },
          stops: 0,
        },
      ],
      ['play Click one-shot', 'play plan file 1 of 1 rate 1.000 gain 0.60'],
      [],
      { moment: 0, candidate: 0 },
    ],
    [
      'the same row twice',
      {},
      (h) => {
        h.audio.toggle('p1', 0, 0);
        h.audio.toggle('p1', 0, 0);
      },
      [
        {
          file: '0.0.0',
          plan: { file: 0, rate: 1, gain: 0.6, loop: false },
          stops: 1,
        },
      ],
      [
        'play Click one-shot',
        'play plan file 1 of 1 rate 1.000 gain 0.60',
        'stop Click',
      ],
      [],
      null,
    ],
    [
      'one row then another',
      {},
      (h) => {
        h.audio.toggle('p1', 0, 0);
        h.audio.toggle('p1', 1, 0);
      },
      [
        {
          file: '0.0.0',
          plan: { file: 0, rate: 1, gain: 0.6, loop: false },
          stops: 1,
        },
        {
          file: '1.0.0',
          plan: { file: 0, rate: 1, gain: 1, loop: true },
          stops: 0,
        },
      ],
      [
        'play Click one-shot',
        'play plan file 1 of 1 rate 1.000 gain 0.60',
        'stop Click',
        'play Rain loop',
        'play plan file 1 of 1 rate 1.000 gain 1.00',
      ],
      [],
      { moment: 1, candidate: 0 },
    ],
    [
      'the variants drawing 0.7',
      { random: 0.7 },
      (h) => h.audio.toggle('p1', 0, 1),
      [
        {
          file: '0.1.2',
          plan: { file: 2, rate: 1, gain: 1, loop: false },
          stops: 0,
        },
      ],
      ['play Steps variants', 'play plan file 3 of 3 rate 1.000 gain 1.00'],
      [],
      { moment: 0, candidate: 1 },
    ],
    [
      'a row still loading',
      { loaded: false },
      (h) => h.audio.toggle('p1', 0, 0),
      [],
      ['not loaded Click'],
      [],
      null,
    ],
    [
      'a picker sending',
      {},
      (h) => {
        h.store.dispatch({
          type: 'sendStarted',
          formId: 'p1',
          kind: 'submitted',
        });
        h.audio.toggle('p1', 0, 0);
      },
      [],
      [],
      [],
      null,
    ],
    [
      'a play that throws',
      { playThrows: true },
      (h) => h.audio.toggle('p1', 0, 0),
      [],
      ['play failed Click: boom'],
      [["Can't play Click: boom", 'error']],
      null,
    ],
  ])(
    'createPickerAudio_Toggle_PlaysOneSoundByItsPlan: %s',
    async (_name, options, act, plays, lines, toasts, playing) => {
      const h = setup(options);
      h.show();
      if (options.loaded !== false) {
        await h.settleAll();
      }
      h.logs.length = 0;

      act(h);
      await flush();

      expect(h.plays).toEqual(plays);
      expect(h.logs).toEqual(lines);
      expect(h.toasts).toEqual(toasts);
      expect(h.playing()).toEqual(playing);
    },
  );

  it('createPickerAudio_PlayEndsOnItsOwn_ClearsPlayingAndLogsEnded', async () => {
    const h = setup();
    h.show();
    await h.settleAll();
    h.audio.toggle('p1', 0, 0);

    h.endings[0]();
    await flush();

    expect(h.playing()).toBeNull();
    expect(h.logs).toContain('ended Click');
    expect(h.logs).not.toContain('stop Click');
    expect(h.timers.size).toBe(0);
  });

  it.each<[string, (h: Harness) => void, boolean]>([
    [
      'its picker closed',
      (h) => h.store.dispatch({ type: 'formClosed', formId: 'p1' }),
      true,
    ],
    [
      'its send started',
      (h) =>
        h.store.dispatch({
          type: 'sendStarted',
          formId: 'p1',
          kind: 'submitted',
        }),
      true,
    ],
    [
      'its session no longer shown',
      (h) => {
        h.hidden.add('p1-session');
        h.advance();
      },
      true,
    ],
    [
      'another session not shown',
      (h) => {
        h.hidden.add('p2-session');
        h.advance();
      },
      false,
    ],
    [
      'the cursor moved',
      (h) => {
        h.store.dispatch({ type: 'nextRow' });
        h.advance();
      },
      false,
    ],
    ['another picker shown', (h) => h.show('p2'), false],
  ])(
    'createPickerAudio_StopRule_StopsOrKeepsPlayback: %s',
    async (_name, act, isStopped) => {
      const h = setup();
      h.show();
      await h.settleAll();
      h.audio.toggle('p1', 1, 0);
      h.logs.length = 0;

      act(h);
      await flush();

      expect(h.plays[0].stops).toBe(isStopped ? 1 : 0);
      expect(h.logs.includes('stop Rain')).toBe(isStopped);
      expect(h.timers.size).toBe(isStopped ? 0 : 1);
    },
  );

  it.each<[string, (h: Harness) => Promise<void>, FileKey[], FileKey[]]>([
    [
      'an evicted row',
      async (h) => {
        h.audio.toggle('p1', 0, 0);
        await flush();
        await h.settle('0.0.0');
      },
      ['0.0.0'],
      ['0.0.0'],
    ],
    [
      'an evicted row, then a cached row before its read lands',
      async (h) => {
        h.audio.toggle('p1', 0, 0);
        h.audio.toggle('p1', 0, 1);
        await flush();
        await h.settle('0.0.0');
      },
      ['0.0.0'],
      ['0.1.2'],
    ],
  ])(
    'createPickerAudio_EvictedSound_IsReadAgainAndOnlyTheLatestPlays: %s',
    async (_name, act, reads, played) => {
      // Holds one 100-byte sound: the last decoded, Steps' file 3.
      const h = setup({ cacheBytes: 150, random: 0.9 });
      h.show();
      await h.settleAll();
      const readsBefore = h.started.length;

      await act(h);

      expect(h.started.slice(readsBefore)).toEqual(reads);
      expect(h.plays.map((play) => play.file)).toEqual(played);
    },
  );

  it('disposing while a play whose stop throws still unsubscribes from the store', async () => {
    const h = setup({ stopThrows: true });
    h.show();
    await h.settleAll();
    h.audio.toggle('p1', 0, 0);

    expect(() => h.audio.dispose()).toThrow('stop refused');

    expect(h.liveSubscriptions()).toBe(0);
  });

  it('createPickerAudio_PickerClosedDuringReads_DropsItsQueue', async () => {
    const h = setup();
    h.show();
    h.store.dispatch({ type: 'formClosed', formId: 'p1' });
    h.dispatched.length = 0;

    await h.settleAll();

    expect(h.started).toEqual(['0.0.0', '0.1.0']);
    expect(h.dispatched).toEqual([]);
    expect(h.logs).toEqual([]);
  });

  // Breaks: a null read decoded or failed as a broken file.
  it('createPickerAudio_ReadAnsweredNull_FailsNothingAndLogsNothing', async () => {
    const h = setup();
    h.show();
    h.dispatched.length = 0;

    for (const read of h.pending.splice(0)) {
      read.resolve(null);
    }
    await flush();

    expect(h.dispatched).toEqual([]);
    expect(h.logs).toEqual([]);
  });
});
