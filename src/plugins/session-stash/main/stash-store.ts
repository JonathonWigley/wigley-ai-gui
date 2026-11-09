import { type Files, readIfPresent } from '../../../contracts/files';
import { isJsonObject } from '../../../shared/json';

export const STASHED_FILE = 'stashed.json';

// One stashed session: what resuming it needs, the title its side-bar row
// had, the user's note (absent for none), when it was stashed, and `headless`
// true when the row was headless (absent when not).
export interface StashRecord {
  hostSessionId: string;
  projectDir: string;
  profile: string;
  title: string;
  note?: string;
  at: number;
  headless?: boolean;
}

export interface StashStore {
  // In stash order, oldest first. Rejects when the file holds anything but a
  // JSON array of records, naming the file.
  records(): Promise<StashRecord[]>;
  // Adds `record` last, replacing an earlier record of its session.
  add(record: StashRecord): Promise<void>;
  // Removes the record of `hostSessionId`; resolves to it, null for none.
  remove(hostSessionId: string): Promise<StashRecord | null>;
  // Resolves once every write asked so far has settled.
  settled(): Promise<void>;
}

const STRING_FIELDS = [
  'hostSessionId',
  'projectDir',
  'profile',
  'title',
] as const;

function isStashRecord(value: unknown): value is StashRecord {
  if (!isJsonObject(value)) {
    return false;
  }
  const hasStrings = STRING_FIELDS.every(
    (field) => typeof value[field] === 'string',
  );
  const hasNote = value.note === undefined || typeof value.note === 'string';
  const hasHeadless =
    value.headless === undefined || typeof value.headless === 'boolean';
  return hasStrings && hasNote && hasHeadless && typeof value.at === 'number';
}

function parseRecords(text: string): StashRecord[] {
  const unreadable = new Error(
    `${STASHED_FILE} is not a JSON array of stashed sessions`,
  );
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw unreadable;
  }
  if (!Array.isArray(parsed) || !parsed.every(isStashRecord)) {
    throw unreadable;
  }
  return parsed;
}

// The stashed sessions in `stashed.json` in the plugin's data folder. A file
// that cannot be read is never overwritten: it is the user's state.
export function createStashStore(data: Files): StashStore {
  let lastWrite: Promise<unknown> = Promise.resolve();

  // [] when the file is missing.
  async function readSaved(): Promise<StashRecord[]> {
    const text = await readIfPresent(data, STASHED_FILE);
    return text === null ? [] : parseRecords(text);
  }

  async function save(records: readonly StashRecord[]) {
    await data.write(STASHED_FILE, JSON.stringify(records, null, 2));
  }

  // Runs `change` after every earlier write has settled, so each reads the
  // file the last one wrote.
  function queued<T>(change: () => Promise<T>): Promise<T> {
    const written = lastWrite.then(change);
    lastWrite = written.catch(() => undefined);
    return written;
  }

  return {
    records: readSaved,
    add: (record) =>
      queued(async () => {
        const others = (await readSaved()).filter(
          (saved) => saved.hostSessionId !== record.hostSessionId,
        );
        await save([...others, record]);
      }),
    remove: (hostSessionId) =>
      queued(async () => {
        const saved = await readSaved();
        const removed = saved.find(
          (record) => record.hostSessionId === hostSessionId,
        );
        if (removed === undefined) {
          return null;
        }
        await save(saved.filter((record) => record !== removed));
        return removed;
      }),
    settled: () => lastWrite.then(() => undefined),
  };
}
