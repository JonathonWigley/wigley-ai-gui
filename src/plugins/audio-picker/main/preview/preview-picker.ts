import type { Paths } from '../../../../contracts/paths';
import type { SamplePickerArgs } from '../fixtures';

// The preview's built-in sample over the sample sounds in `dir`: every play
// mode, a pitch range, loudness and a link both present and absent, a name
// long enough to wrap, and a file that will not decode, so every row state
// shows. Its seven files are the ones `writeSampleSounds` writes.
export function previewPickerArgs(
  dir: string,
  paths: Pick<Paths, 'join'>,
): SamplePickerArgs {
  const file = (name: string) => paths.join(dir, name);
  return {
    heading: 'Layout preview',
    overview:
      'A sample picker for iterating the audio picker layout; nothing you choose here reaches an agent. Sending or cancelling it closes the preview.',
    moments: [
      {
        title: 'Button tap',
        reason: 'A short click that reads as a press.',
        recommend: 1,
        candidates: [
          {
            name: 'tap_a',
            library: 'Sample library',
            files: [file('tap_a.wav')],
            play: 'one-shot',
            volume: 0.8,
            loudness_lufs: -14,
            drive_url: 'https://drive.google.com/file/d/sample-tap-a',
          },
          {
            name: 'tap_b_with_a_long_name_that_wraps_in_the_row',
            library: 'Sample library',
            files: [file('tap_b.wav')],
            play: 'one-shot',
            volume: 0.8,
            pitch: { min: -3, max: 3 },
          },
        ],
      },
      {
        title: 'Shop ambience',
        reason: 'A bed under the shop screen, quiet enough to talk over.',
        recommend: 2,
        candidates: [
          {
            name: 'hum',
            library: 'Sample library',
            files: [file('hum.wav')],
            play: 'loop',
            volume: 0.4,
            loudness_lufs: -24,
          },
          {
            name: 'sparkle',
            library: 'Sample library',
            files: [
              file('sparkle_a.wav'),
              file('sparkle_b.wav'),
              file('sparkle_c.wav'),
            ],
            play: 'variants',
            volume: 0.6,
            pitch: { min: -1, max: 1 },
          },
        ],
      },
      {
        title: 'Reward fanfare',
        reason: "A file that will not decode, so the row's error line shows.",
        recommend: 1,
        candidates: [
          {
            name: 'broken',
            library: 'Drive library',
            files: [file('broken.wav')],
            play: 'one-shot',
            volume: 1,
          },
        ],
      },
    ],
  };
}
