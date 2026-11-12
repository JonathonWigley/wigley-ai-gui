import { describe, expect, it } from 'vitest';
import type { AudioCandidate, PitchRange, PlayMode } from '../../contract';
import { type PlayPlan, playPlan } from './play-plan';

function candidateOf(
  play: PlayMode,
  files: number,
  pitch: PitchRange | null,
  volume: number,
): AudioCandidate {
  return {
    name: 'sample_sound',
    library: 'Sample Library',
    files: Array.from({ length: files }, (_, i) => `/sounds/sample_${i}.wav`),
    play,
    volume,
    pitch,
    loudnessLufs: null,
    driveUrl: null,
  };
}

describe('playPlan', () => {
  it.each<{
    case: string;
    candidate: AudioCandidate;
    draws: number[];
    expected: PlayPlan;
  }>([
    {
      case: 'one-shot, no pitch',
      candidate: candidateOf('one-shot', 1, null, 0.6),
      draws: [],
      expected: { file: 0, rate: 1, gain: 0.6, loop: false },
    },
    {
      case: 'loop with a range',
      candidate: candidateOf('loop', 1, { min: -2, max: 3 }, 0.8),
      draws: [0.6],
      expected: { file: 0, rate: 1.0594630943592953, gain: 0.8, loop: true },
    },
    {
      case: 'variants, no pitch',
      candidate: candidateOf('variants', 4, null, 0.35),
      draws: [0.74],
      expected: { file: 2, rate: 1, gain: 0.35, loop: false },
    },
    {
      case: 'variants, file then pitch',
      candidate: candidateOf('variants', 4, { min: -4, max: 2 }, 0.45),
      draws: [0.0, 0.25],
      expected: { file: 0, rate: 0.8655365610061431, gain: 0.45, loop: false },
    },
    {
      case: 'variants, last file, fixed pitch',
      candidate: candidateOf('variants', 3, { min: -1, max: -1 }, 0.7),
      draws: [0.999, 0.25],
      expected: { file: 2, rate: 0.9438743126816935, gain: 0.7, loop: false },
    },
  ])(
    'playPlan_Candidate_PlansFileRateGainAndLoop: $case',
    ({ candidate, draws, expected }) => {
      let drawn = 0;
      const random = (): number => {
        if (drawn >= draws.length) {
          throw new Error(`random drawn more than ${draws.length} times`);
        }
        return draws[drawn++];
      };

      const { rate, ...plan } = playPlan(candidate, random);

      const { rate: expectedRate, ...expectedPlan } = expected;
      expect(drawn).toBe(draws.length);
      expect(rate).toBeCloseTo(expectedRate, 9);
      expect(plan).toEqual(expectedPlan);
    },
  );
});
