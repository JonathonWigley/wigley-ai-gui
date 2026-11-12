import { describe, expect, it } from 'vitest';
import { createMemoryFiles } from '../../../shared/memory-files';
import { posixPaths } from '../../../shared/paths/posix-paths';
import { scopedFiles } from '../../../shared/scoped-files';
import { MAX_CANDIDATES } from '../contract';
import {
  samplePickerArgs,
  sampleSoundsDir,
  sineWav,
  writeSampleSounds,
} from './fixtures';
import { createAudioPickerType } from './picker-type';
import { previewPickerArgs } from './preview/preview-picker';

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

describe('sineWav', () => {
  it.each([
    { hz: 880, seconds: 0.15 },
    { hz: 110, seconds: 1 },
  ])(
    'writes a WAV header that matches its samples ($hz Hz, $seconds s)',
    ({ hz, seconds }) => {
      const bytes = sineWav(hz, seconds);
      const view = new DataView(bytes.buffer, bytes.byteOffset);
      const dataBytes = Math.round(22050 * seconds) * 2;

      expect({
        riff: ascii(bytes, 0, 4),
        wave: ascii(bytes, 8, 4),
        fmt: ascii(bytes, 12, 4),
        format: view.getUint16(20, true),
        channels: view.getUint16(22, true),
        sampleRate: view.getUint32(24, true),
        bitsPerSample: view.getUint16(34, true),
        data: ascii(bytes, 36, 4),
        dataBytes: view.getUint32(40, true),
        length: bytes.length,
      }).toEqual({
        riff: 'RIFF',
        wave: 'WAVE',
        fmt: 'fmt ',
        format: 1,
        channels: 1,
        sampleRate: 22050,
        bitsPerSample: 16,
        data: 'data',
        dataBytes,
        length: 44 + dataBytes,
      });
    },
  );
});

describe('samplePickerArgs', () => {
  it('holds a moment of MAX_CANDIDATES candidates, so the self-test draws every row number', () => {
    const { moments } = createAudioPickerType(posixPaths).parse(
      samplePickerArgs('/home/sounds', posixPaths),
    );

    expect(moments.map((moment) => moment.candidates.length)).toContain(
      MAX_CANDIDATES,
    );
  });
});

describe('writeSampleSounds', () => {
  it('writes every file the sample and preview pickers name', async () => {
    const files = createMemoryFiles();
    const dataFolder = '/data/audio-picker';
    const dir = sampleSoundsDir(dataFolder, posixPaths);
    const type = createAudioPickerType(posixPaths);

    await writeSampleSounds(scopedFiles(files, dataFolder, posixPaths));

    const named = [
      samplePickerArgs(dir, posixPaths),
      previewPickerArgs(dir, posixPaths),
    ].flatMap((args) =>
      type
        .parse(args)
        .moments.flatMap((moment) =>
          moment.candidates.flatMap((candidate) => candidate.files),
        ),
    );
    const stats = await Promise.all(named.map((path) => files.stat(path)));
    expect(stats.map((stat) => stat?.isFolder)).toEqual(named.map(() => false));
  });
});
