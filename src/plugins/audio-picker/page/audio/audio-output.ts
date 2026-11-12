import type { PlayPlan } from './play-plan';

// A sound one AudioOutput decoded. `channels` are read once, for
// waveformPeaks, before the sound's first play: a play may detach them.
// `byteSize` is the PCM the sound holds.
export type DecodedAudio = {
  duration: number;
  channels: readonly Float32Array[];
  byteSize: number;
};

// One sound playing. `stop()` stops it; a second `stop()` does nothing.
// `ended` resolves once: when the sound ends on its own, on its first
// `stop()`, or on the output's `dispose()`. A loop ends only on `stop()` or
// `dispose()`.
export type Playing = { stop(): void; ended: Promise<void> };

// Decodes and plays sounds.
// - `decode` takes the bytes, which the caller does not read after the call,
//   and resolves with the sound, or rejects with the decoder's error.
// - `play` starts the sound at once, and throws for a DecodedAudio this
//   output did not decode. It reads every field of the plan except `file`.
// - `dispose` stops every sound still playing, resolves each one's `ended`,
//   and releases the output; a second `dispose()` does nothing. After it,
//   `decode` rejects and `play` throws, both with `audio output disposed`.
export type AudioOutput = {
  decode(bytes: Uint8Array): Promise<DecodedAudio>;
  play(audio: DecodedAudio, plan: PlayPlan): Playing;
  dispose(): void;
};
