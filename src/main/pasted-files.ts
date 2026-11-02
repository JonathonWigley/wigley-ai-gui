import type { Clock } from '../contracts/ambient';
import type { Files } from '../contracts/files';
import type { Paths } from '../contracts/paths';
import { fileStamp } from '../shared/file-stamp';
import { extensionOf } from '../shared/image-types';

// Saves files the page has no path for (a screenshot on the clipboard) into
// one folder.
export interface PastedFiles {
  // Writes `bytes` to `<folder>/<yyyyMMdd-HHmmss>-<n>.<ext>`, `<n>` the lowest
  // number from 1 with no file at that name, and resolves with its full path.
  // Saves run one at a time in the order called; a failed save rejects its own
  // caller only.
  save(bytes: Uint8Array, mediaType: string): Promise<string>;
}

export function createPastedFiles(deps: {
  files: Files;
  clock: Clock;
  paths: Pick<Paths, 'join'>;
  folder: string;
}): PastedFiles {
  const { files, clock, paths, folder } = deps;
  let queue: Promise<unknown> = Promise.resolve();

  const saveNow = async (
    bytes: Uint8Array,
    mediaType: string,
  ): Promise<string> => {
    const stem = fileStamp(clock.now());
    const extension = extensionOf(mediaType);
    let number = 1;
    let filePath = paths.join(folder, `${stem}-${number}.${extension}`);
    while ((await files.stat(filePath)) !== null) {
      number += 1;
      filePath = paths.join(folder, `${stem}-${number}.${extension}`);
    }
    await files.writeBytes(filePath, bytes);
    return filePath;
  };

  return {
    save: (bytes, mediaType) => {
      const run = queue.then(() => saveNow(bytes, mediaType));
      queue = run.catch(() => {});
      return run;
    },
  };
}
