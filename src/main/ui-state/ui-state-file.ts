import { type Files, readIfPresent } from '../../contracts/files';
import type { Log } from '../../contracts/log';
import { errorText } from '../../shared/error-text';
import { isJsonObject } from '../../shared/json';

// How long a set waits before the file is written, so a burst of sets (a
// drag) is one write.
const WRITE_DELAY_MS = 500;

const LOG_SOURCE = 'ui-state';

// The app's ui state, every plugin's keys qualified by its id, held in memory
// and saved to one JSON file.
export interface UiStateFile {
  // A copy of every key and its value now.
  snapshot(): Record<string, unknown>;
  // Changes the key in memory at once (`undefined` deletes it) and writes the
  // file 500 ms later, unless a write is already scheduled. A failed write is
  // logged, and the next set schedules another.
  set(key: string, value: unknown): void;
  // Writes now when anything changed since the last write, cancelling a
  // scheduled one; otherwise resolves at once. Never rejects.
  flush(): Promise<void>;
  // Flushes, and from then on a set changes nothing and writes nothing, so
  // the flush is the file's last write. Never rejects.
  close(): Promise<void>;
}

// Reads the file at `path` once. A missing file starts empty; a file that is
// not a JSON object, or cannot be read, starts empty and is logged. Writes
// run one at a time, each saving the latest state whole through the atomic
// `files.write`.
export async function loadUiStateFile(deps: {
  files: Files;
  path: string;
  log: Log;
}): Promise<UiStateFile> {
  const { files, path, log } = deps;
  const values = await readSaved(files, path, log);
  let scheduled: ReturnType<typeof setTimeout> | null = null;
  let hasUnwritten = false;
  let lastWrite: Promise<void> = Promise.resolve();
  let isClosed = false;

  const writeLatest = async () => {
    if (!hasUnwritten) {
      return;
    }
    hasUnwritten = false;
    const text = `${JSON.stringify(Object.fromEntries(values), null, 2)}\n`;
    try {
      await files.write(path, text);
    } catch (error) {
      hasUnwritten = true;
      log(LOG_SOURCE, `could not write ui-state.json: ${errorText(error)}`);
    }
  };
  // A write waits for the one before it to finish.
  const queueWrite = () => {
    lastWrite = lastWrite.then(writeLatest);
    return lastWrite;
  };

  const flush = () => {
    if (scheduled !== null) {
      clearTimeout(scheduled);
      scheduled = null;
    }
    return queueWrite();
  };

  return {
    snapshot: () => Object.fromEntries(values),
    set(key, value) {
      if (isClosed) {
        return;
      }
      if (value === undefined) {
        values.delete(key);
      } else {
        values.set(key, value);
      }
      hasUnwritten = true;
      if (scheduled === null) {
        scheduled = setTimeout(() => {
          scheduled = null;
          void queueWrite();
        }, WRITE_DELAY_MS);
      }
    },
    flush,
    close() {
      isClosed = true;
      return flush();
    },
  };
}

// The saved keys and values, or none when the file is missing or unusable.
async function readSaved(
  files: Files,
  path: string,
  log: Log,
): Promise<Map<string, unknown>> {
  let text: string | null;
  try {
    text = await readIfPresent(files, path);
  } catch (error) {
    log(
      LOG_SOURCE,
      `could not read ui-state.json, starting empty: ${errorText(error)}`,
    );
    return new Map();
  }
  if (text === null) {
    return new Map();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    log(
      LOG_SOURCE,
      `ui-state.json is not valid JSON, starting empty: ${(error as SyntaxError).message}`,
    );
    return new Map();
  }
  if (!isJsonObject(parsed)) {
    log(LOG_SOURCE, 'ui-state.json is not a JSON object, starting empty');
    return new Map();
  }
  return new Map(Object.entries(parsed));
}
