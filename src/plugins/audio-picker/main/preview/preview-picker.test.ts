import { describe, expect, it } from 'vitest';
import { createMemoryFiles } from '../../../../shared/memory-files';
import { posixPaths } from '../../../../shared/paths/posix-paths';
import { PLAY_MODES } from '../../contract';
import { writeSampleSounds } from '../fixtures';
import { createAudioPickerType } from '../picker-type';
import { previewPickerArgs } from './preview-picker';

describe('previewPickerArgs', () => {
  it('previewPickerArgs parses, and holds every play mode, a pitch range, loudness and link both present and absent, and a file that will not decode', async () => {
    const dir = '/home/sounds';
    const files = createMemoryFiles();
    await writeSampleSounds(files, dir, posixPaths);

    const { moments } = createAudioPickerType(posixPaths).parse(
      previewPickerArgs(dir, posixPaths),
    );
    const candidates = moments.flatMap((moment) => moment.candidates);
    const isWav = (path: string) =>
      new TextDecoder().decode(files.bytesOf(path).subarray(0, 4)) === 'RIFF';

    expect(new Set(candidates.map((candidate) => candidate.play))).toEqual(
      new Set(PLAY_MODES),
    );
    for (const field of ['pitch', 'loudnessLufs', 'driveUrl'] as const) {
      expect(candidates.some((candidate) => candidate[field] !== null)).toBe(
        true,
      );
      expect(candidates.some((candidate) => candidate[field] === null)).toBe(
        true,
      );
    }
    expect(
      candidates.some((candidate) =>
        candidate.files.some((path) => !isWav(path)),
      ),
    ).toBe(true);
  });
});
