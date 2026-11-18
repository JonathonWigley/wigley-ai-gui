import { describe, expect, it, vi } from 'vitest';
import type { PlayPlan } from './play-plan';
import { createWebAudioOutput } from './web-audio-output';

type FakeSource = {
  buffer: unknown;
  loop: boolean;
  playbackRate: { value: number };
  onended: (() => void) | null;
  connected: unknown[];
  starts: number[];
  stops: number;
};

type FakeGain = { gain: { value: number }; connected: unknown[] };

type FakeOptions = {
  state?: 'running' | 'suspended';
  decodeError?: Error;
  resumeFails?: boolean;
  // The first source's `stop` counts, then throws.
  firstStopFails?: boolean;
};

// An AudioContext that records what the output asks of it. Its decoded
// buffer has 2 channels of 10 samples, 1.5 s long.
function fakeWebAudio(options: FakeOptions = {}) {
  const calls: string[] = [];
  const decoded: ArrayBuffer[] = [];
  const sources: FakeSource[] = [];
  const gains: FakeGain[] = [];
  const destination = { node: 'destination' };
  const channels = [new Float32Array(10), new Float32Array(10)];
  const buffer = {
    duration: 1.5,
    length: 10,
    numberOfChannels: 2,
    getChannelData: (channel: number) => channels[channel],
  };
  let closes = 0;
  const context = {
    state: options.state ?? 'running',
    destination,
    decodeAudioData(data: ArrayBuffer) {
      decoded.push(data);
      return options.decodeError === undefined
        ? Promise.resolve(buffer)
        : Promise.reject(options.decodeError);
    },
    createBufferSource() {
      const source = {
        buffer: null as unknown,
        loop: false,
        playbackRate: { value: 1 },
        onended: null as (() => void) | null,
        connected: [] as unknown[],
        starts: [] as number[],
        stops: 0,
        connect(node: unknown) {
          source.connected.push(node);
        },
        start(when: number) {
          calls.push('start');
          source.starts.push(when);
        },
        stop() {
          source.stops++;
          if (options.firstStopFails === true && sources[0] === source) {
            throw new Error('stop refused');
          }
        },
      };
      sources.push(source);
      return source;
    },
    createGain() {
      const gain = {
        gain: { value: 1 },
        connected: [] as unknown[],
        connect(node: unknown) {
          gain.connected.push(node);
        },
      };
      gains.push(gain);
      return gain;
    },
    resume() {
      calls.push('resume');
      return options.resumeFails
        ? Promise.reject(new Error('resume refused'))
        : Promise.resolve();
    },
    close() {
      closes++;
      return Promise.resolve();
    },
  };
  const createContext = vi.fn(() => context as unknown as AudioContext);
  return {
    output: createWebAudioOutput(createContext),
    createContext,
    calls,
    decoded,
    sources,
    gains,
    destination,
    buffer,
    channels,
    closes: () => closes,
  };
}

const PLAN: PlayPlan = { file: 0, rate: 1, gain: 1, loop: false };
const LOOP_PLAN: PlayPlan = { file: 0, rate: 1, gain: 1, loop: true };

function countingBytes(length: number): Uint8Array {
  return Uint8Array.from({ length }, (_, i) => i);
}

async function isSettled(promise: Promise<void>): Promise<boolean> {
  let settled = false;
  void promise.then(() => {
    settled = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  return settled;
}

describe('createWebAudioOutput', () => {
  it.each([
    {
      case: 'a view at an offset into a larger buffer',
      bytes: () => countingBytes(16).subarray(4, 10),
      received: [4, 5, 6, 7, 8, 9],
      passesItsBuffer: false,
    },
    {
      case: 'a view over its whole buffer',
      bytes: () => countingBytes(16),
      received: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
      passesItsBuffer: true,
    },
  ])(
    'createWebAudioOutput_Decode_PassesTheViewsBytesAndReportsTheBuffer: $case',
    async ({ bytes, received, passesItsBuffer }) => {
      const fake = fakeWebAudio();
      const view = bytes();

      const audio = await fake.output.decode(view);

      expect(fake.decoded).toHaveLength(1);
      expect([...new Uint8Array(fake.decoded[0])]).toEqual(received);
      expect(fake.decoded[0] === view.buffer).toBe(passesItsBuffer);
      expect(audio).toEqual({
        duration: 1.5,
        channels: fake.channels,
        byteSize: 80,
      });
    },
  );

  it('createWebAudioOutput_DecodeFails_RejectsWithTheDecodersError', async () => {
    const decodeError = new Error('bad data');
    const fake = fakeWebAudio({ decodeError });

    await expect(fake.output.decode(countingBytes(8))).rejects.toBe(
      decodeError,
    );
  });

  it('createWebAudioOutput_Construct_MakesNoContextUntilUsed', async () => {
    const unused = fakeWebAudio();
    unused.output.dispose();
    expect(unused.createContext).not.toHaveBeenCalled();

    const used = fakeWebAudio();
    expect(used.createContext).not.toHaveBeenCalled();
    const audio = await used.output.decode(countingBytes(8));
    used.output.play(audio, PLAN);
    expect(used.createContext).toHaveBeenCalledTimes(1);
  });

  it('createWebAudioOutput_Play_WiresSourceGainAndDestinationFromThePlan', async () => {
    const fake = fakeWebAudio();
    const audio = await fake.output.decode(countingBytes(8));

    fake.output.play(audio, { file: 0, rate: 0.75, gain: 0.4, loop: true });

    expect(fake.sources).toHaveLength(1);
    expect(fake.gains).toHaveLength(1);
    const [source] = fake.sources;
    const [gain] = fake.gains;
    expect(source.buffer).toBe(fake.buffer);
    expect(source.loop).toBe(true);
    expect(source.playbackRate.value).toBe(0.75);
    expect(gain.gain.value).toBe(0.4);
    expect(source.connected).toEqual([gain]);
    expect(gain.connected).toEqual([fake.destination]);
    expect(source.starts).toEqual([0]);
  });

  it('createWebAudioOutput_Stop_StopsOnceAndEndsThePlay', async () => {
    const fake = fakeWebAudio();
    const audio = await fake.output.decode(countingBytes(8));

    const stopped = fake.output.play(audio, PLAN);
    expect(await isSettled(stopped.ended)).toBe(false);
    stopped.stop();
    stopped.stop();
    expect(fake.sources[0].stops).toBe(1);
    expect(await isSettled(stopped.ended)).toBe(true);

    const endsOnItsOwn = fake.output.play(audio, PLAN);
    fake.sources[1].onended?.();
    expect(await isSettled(endsOnItsOwn.ended)).toBe(true);
    fake.output.dispose();
    expect(fake.sources[1].stops).toBe(0);
  });

  it('createWebAudioOutput_SuspendedContext_ResumesBeforeStart', async () => {
    const fake = fakeWebAudio({ state: 'suspended', resumeFails: true });
    const audio = await fake.output.decode(countingBytes(8));
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', onUnhandled);
    try {
      const playing = fake.output.play(audio, PLAN);
      expect(playing.stop).toBeTypeOf('function');
      await new Promise((resolve) => setTimeout(resolve, 0));
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }

    expect(fake.calls).toEqual(['resume', 'start']);
    expect(unhandled).toEqual([]);
  });

  it('createWebAudioOutput_ForeignAudio_Throws', () => {
    const fake = fakeWebAudio();
    const foreign = {
      duration: 1.5,
      channels: fake.channels,
      byteSize: 80,
    };

    expect(() => fake.output.play(foreign, PLAN)).toThrow();
  });

  it('disposing with one sound whose stop throws still stops the rest and closes the context', async () => {
    const fake = fakeWebAudio({ firstStopFails: true });
    const audio = await fake.output.decode(countingBytes(8));
    fake.output.play(audio, LOOP_PLAN);
    fake.output.play(audio, LOOP_PLAN);

    expect(() => fake.output.dispose()).toThrow('stop refused');

    expect(fake.sources.map((source) => source.stops)).toEqual([1, 1]);
    expect(fake.closes()).toBe(1);
  });

  it('createWebAudioOutput_Dispose_StopsPlayingAndClosesTheContext', async () => {
    const fake = fakeWebAudio();
    const audio = await fake.output.decode(countingBytes(8));
    const loop = fake.output.play(audio, LOOP_PLAN);

    fake.output.dispose();
    expect(fake.sources[0].stops).toBe(1);
    expect(await isSettled(loop.ended)).toBe(true);
    expect(fake.closes()).toBe(1);

    fake.output.dispose();
    expect(fake.sources[0].stops).toBe(1);
    expect(fake.closes()).toBe(1);
    expect(fake.createContext).toHaveBeenCalledTimes(1);
    await expect(fake.output.decode(countingBytes(8))).rejects.toThrow(
      'audio output disposed',
    );
    expect(() => fake.output.play(audio, PLAN)).toThrow(
      'audio output disposed',
    );
  });
});
