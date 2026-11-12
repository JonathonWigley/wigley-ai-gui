import type { AudioOutput, DecodedAudio, Playing } from './audio-output';
import type { PlayPlan } from './play-plan';

const DISPOSED = 'audio output disposed';

// The AudioOutput over Web Audio. Its one AudioContext is made by
// `createContext` on the first `decode` or `play`, so an output never used
// makes none.
export function createWebAudioOutput(
  createContext: () => AudioContext = () => new AudioContext(),
): AudioOutput {
  let context: AudioContext | null = null;
  let disposed = false;
  // A WeakMap, so a sound the caller drops frees its buffer with no call.
  const buffers = new WeakMap<DecodedAudio, AudioBuffer>();
  // The stops of the sounds still playing.
  const playing = new Set<() => void>();

  function contextOf(): AudioContext {
    context ??= createContext();
    return context;
  }

  return {
    async decode(bytes) {
      if (disposed) {
        throw new Error(DISPOSED);
      }
      const buffer = await contextOf().decodeAudioData(ownArrayBuffer(bytes));
      const audio: DecodedAudio = {
        duration: buffer.duration,
        channels: channelsOf(buffer),
        byteSize: buffer.length * buffer.numberOfChannels * 4,
      };
      buffers.set(audio, buffer);
      return audio;
    },
    play(audio, plan) {
      if (disposed) {
        throw new Error(DISPOSED);
      }
      const buffer = buffers.get(audio);
      if (buffer === undefined) {
        throw new Error('audio output did not decode this sound');
      }
      return startSound(contextOf(), buffer, plan, playing);
    },
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      for (const stop of playing) {
        stop();
      }
      if (context !== null) {
        void context.close();
      }
    },
  };
}

// decodeAudioData detaches the buffer it is given, so it gets exactly the
// view's bytes: the view's own buffer when the view covers all of it, a copy
// otherwise.
function ownArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const { buffer } = bytes;
  const coversItsBuffer =
    bytes.byteOffset === 0 && bytes.byteLength === buffer.byteLength;
  if (coversItsBuffer && buffer instanceof ArrayBuffer) {
    return buffer;
  }
  return bytes.slice().buffer;
}

function channelsOf(buffer: AudioBuffer): Float32Array[] {
  return Array.from({ length: buffer.numberOfChannels }, (_, channel) =>
    buffer.getChannelData(channel),
  );
}

// Starts `buffer` through a gain node to the destination, adding its stop to
// `playing` until it ends or is stopped.
function startSound(
  context: AudioContext,
  buffer: AudioBuffer,
  plan: PlayPlan,
  playing: Set<() => void>,
): Playing {
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.loop = plan.loop;
  source.playbackRate.value = plan.rate;
  const gain = context.createGain();
  gain.gain.value = plan.gain;
  source.connect(gain);
  gain.connect(context.destination);

  const ended = Promise.withResolvers<void>();
  let finished = false;
  function finish(): void {
    finished = true;
    playing.delete(stop);
    ended.resolve();
  }
  function stop(): void {
    if (finished) {
      return;
    }
    source.stop();
    finish();
  }
  source.onended = () => {
    if (!finished) {
      finish();
    }
  };
  playing.add(stop);

  if (context.state === 'suspended') {
    // Chromium's autoplay policy suspends a new context; a start on it runs
    // once it resumes, and a failed resume leaves the sound silent.
    context.resume().catch(() => {});
  }
  source.start(0);
  return { stop, ended: ended.promise };
}
