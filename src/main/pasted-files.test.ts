import { describe, expect, it } from 'vitest';
import type { Files } from '../contracts/files';
import type { Paths } from '../contracts/paths';
import { createMemoryFiles } from '../shared/memory-files';
import { createPastedFiles } from './pasted-files';

const FOLDER = '/home/me/pasted';
const STAMP = '20261102-090507';
// POSIX joining; the layer rules keep src/main tests off src/shared/paths.
const paths: Pick<Paths, 'join'> = {
  join: (folder, ...segments) => [folder, ...segments].join('/'),
};
const clock = { now: () => new Date(2026, 10, 2, 9, 5, 7).getTime() };

function pastedFilesOver(files: Files) {
  return createPastedFiles({ files, clock, paths, folder: FOLDER });
}

describe('createPastedFiles', () => {
  it.each([
    { existing: [], saved: `${STAMP}-1.png` },
    { existing: [`${STAMP}-1.png`], saved: `${STAMP}-2.png` },
    { existing: [`${STAMP}-1.png`, `${STAMP}-2.png`], saved: `${STAMP}-3.png` },
    { existing: [`${STAMP}-1.jpg`], saved: `${STAMP}-1.png` },
  ])(
    'names a pasted file by its time and the first free number: $existing → $saved',
    async ({ existing, saved }) => {
      const files = createMemoryFiles();
      for (const name of existing) {
        await files.writeBytes(`${FOLDER}/${name}`, new Uint8Array([9]));
      }

      const path = await pastedFilesOver(files).save(
        new Uint8Array([1]),
        'image/png',
      );

      expect(path).toBe(`${FOLDER}/${saved}`);
    },
  );

  it('writes the bytes it was given', async () => {
    const files = createMemoryFiles();

    const path = await pastedFilesOver(files).save(
      new Uint8Array([1, 2, 3]),
      'image/png',
    );

    expect([...(await files.readBytes(path))]).toEqual([1, 2, 3]);
  });

  it.each([
    {
      failsFirstWrite: false,
      firstPath: `${FOLDER}/${STAMP}-1.png`,
      secondPath: `${FOLDER}/${STAMP}-2.png`,
    },
    {
      failsFirstWrite: true,
      firstPath: null,
      secondPath: `${FOLDER}/${STAMP}-1.png`,
    },
  ])(
    'numbers two saves started in the same second apart: first write fails $failsFirstWrite',
    async ({ failsFirstWrite, firstPath, secondPath }) => {
      const memory = createMemoryFiles();
      let writes = 0;
      const files: Files = {
        ...memory,
        writeBytes: (path, bytes) => {
          writes += 1;
          return failsFirstWrite && writes === 1
            ? Promise.reject(new Error('disk full'))
            : memory.writeBytes(path, bytes);
        },
      };
      const pasted = pastedFilesOver(files);

      const first = pasted.save(new Uint8Array([1]), 'image/png');
      const second = pasted.save(new Uint8Array([2]), 'image/png');

      if (firstPath === null) {
        await expect(first).rejects.toThrow('disk full');
      } else {
        expect(await first).toBe(firstPath);
      }
      expect(await second).toBe(secondPath);
    },
  );
});
