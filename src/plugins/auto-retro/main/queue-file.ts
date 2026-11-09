import { type Files, readIfPresent } from '../../../contracts/files';
import { EMPTY_QUEUE, parseQueue, type RetroQueue } from './retro-queue';

export const QUEUE_FILE = 'queue.json';

// The retro queue in `queue.json` in the plugin's data folder. `load` resolves to `EMPTY_QUEUE` for a missing file
// and rejects for one it cannot read or parse; `save` writes the whole queue after every earlier write settled;
// `settled` resolves once every write asked so far has settled.
export function createQueueFile(data: Files): {
  load(): Promise<RetroQueue>;
  save(queue: RetroQueue): Promise<void>;
  settled(): Promise<void>;
} {
  let lastWrite: Promise<unknown> = Promise.resolve();
  return {
    async load() {
      const text = await readIfPresent(data, QUEUE_FILE);
      return text === null ? EMPTY_QUEUE : parseQueue(text);
    },
    save(queue) {
      const written = lastWrite.then(() =>
        data.write(QUEUE_FILE, JSON.stringify(queue, null, 2)),
      );
      lastWrite = written.catch(() => undefined);
      return written;
    },
    settled: () => lastWrite.then(() => undefined),
  };
}
