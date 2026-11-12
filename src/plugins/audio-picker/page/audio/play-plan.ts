import type { AudioCandidate, PitchRange } from '../../contract';

// How one play of a candidate sounds: the 0-based file of its set, the
// playback rate, the gain and whether it loops.
export type PlayPlan = {
  file: number;
  rate: number;
  gain: number;
  loop: boolean;
};

// `random` returns a value in [0, 1), as Math.random does. A variants
// candidate draws its file first, then a set pitch draws its semitones; no
// other draw is made.
export function playPlan(
  candidate: AudioCandidate,
  random: () => number,
): PlayPlan {
  const file =
    candidate.play === 'variants'
      ? Math.floor(random() * candidate.files.length)
      : 0;
  const rate = candidate.pitch === null ? 1 : rateOf(candidate.pitch, random());
  return {
    file,
    rate,
    gain: candidate.volume,
    loop: candidate.play === 'loop',
  };
}

function rateOf(pitch: PitchRange, draw: number): number {
  const semitones = pitch.min + draw * (pitch.max - pitch.min);
  return 2 ** (semitones / 12);
}
