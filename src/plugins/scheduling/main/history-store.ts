import { type Files, readIfPresent } from '../../../contracts/files';
import { errorText } from '../../../shared/error-text';
import { isJsonObject } from '../../../shared/json';
import type { RunHistoryEntry, RunOutcome } from '../contract';

export const HISTORY_FILE = 'history.json';
export const HISTORY_PER_TASK = 20;

const OUTCOMES: readonly RunOutcome[] = [
  'running',
  'finished',
  'skipped',
  'failed',
];

// Each task's run history in `history.json` in the plugin data. Every change
// writes the whole file after every earlier write settled; a write that
// rejects is logged and the next change writes every entry again. After a
// `load` that rejects, nothing is written for the rest of the run.
export interface HistoryStore {
  load(): Promise<void>;
  entries(): RunHistoryEntry[]; // newest `at` first
  add(entry: RunHistoryEntry): void;
  update(
    taskId: string,
    occurrence: number,
    change: Partial<RunHistoryEntry>,
  ): void;
  settled(): Promise<void>;
}

export function createHistoryStore(
  files: Files,
  log: (line: string) => void,
): HistoryStore {
  let entries: RunHistoryEntry[] = [];
  let isWritable = true;
  let lastWrite: Promise<void> = Promise.resolve();

  const write = () => {
    if (!isWritable) {
      return;
    }
    const text = JSON.stringify(entries, null, 2);
    lastWrite = lastWrite
      .then(() => files.write(HISTORY_FILE, text))
      .catch((error: unknown) =>
        log(`${HISTORY_FILE} not written: ${errorText(error)}`),
      );
  };

  return {
    async load() {
      try {
        const text = await readIfPresent(files, HISTORY_FILE);
        entries = text === null ? [] : newestFirst(readHistory(text));
      } catch (error) {
        isWritable = false;
        throw error;
      }
    },
    entries: () => [...entries],
    add(entry) {
      const others = entries.filter(
        (kept) => !isSameRun(kept, entry.taskId, entry.occurrence),
      );
      let taskCount = 0;
      entries = newestFirst([...others, entry]).filter((kept) => {
        if (kept.taskId !== entry.taskId) {
          return true;
        }
        taskCount++;
        return taskCount <= HISTORY_PER_TASK;
      });
      write();
    },
    update(taskId, occurrence, change) {
      const index = entries.findIndex((kept) =>
        isSameRun(kept, taskId, occurrence),
      );
      if (index === -1) {
        return;
      }
      const next = [...entries];
      next[index] = { ...entries[index], ...change };
      entries = newestFirst(next);
      write();
    },
    settled: () => lastWrite,
  };
}

function isSameRun(
  entry: RunHistoryEntry,
  taskId: string,
  occurrence: number,
): boolean {
  return entry.taskId === taskId && entry.occurrence === occurrence;
}

function newestFirst(entries: RunHistoryEntry[]): RunHistoryEntry[] {
  return [...entries].sort((a, b) => b.at - a.at);
}

// The entries `text` holds; throws naming the first bad entry and field.
function readHistory(text: string): RunHistoryEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`${HISTORY_FILE} is not JSON: ${errorText(error)}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`${HISTORY_FILE} must be an array of run entries`);
  }
  return parsed.map((value: unknown, index) => {
    const badField = badEntryField(value);
    if (badField !== null) {
      throw new Error(`${HISTORY_FILE} entry ${index + 1}: ${badField}`);
    }
    return value as RunHistoryEntry;
  });
}

// The first field of `value` that a `RunHistoryEntry` cannot hold, or null.
function badEntryField(value: unknown): string | null {
  if (!isJsonObject(value)) {
    return 'must be an object';
  }
  const fieldChecks: [keyof RunHistoryEntry, (field: unknown) => boolean][] = [
    ['taskId', (field) => typeof field === 'string'],
    ['occurrence', (field) => typeof field === 'number'],
    ['at', (field) => typeof field === 'number'],
    ['outcome', (field) => OUTCOMES.includes(field as RunOutcome)],
    ['reason', isStringOrNull],
    ['rowId', isStringOrNull],
    ['processId', isStringOrNull],
    ['viewed', (field) => typeof field === 'boolean'],
  ];
  const bad = fieldChecks.find(([key, isValid]) => !isValid(value[key]));
  return bad === undefined ? null : `${bad[0]} is missing or of the wrong type`;
}

function isStringOrNull(value: unknown): boolean {
  return value === null || typeof value === 'string';
}
