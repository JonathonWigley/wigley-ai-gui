import { type Files, readIfPresent } from '../../../contracts/files';

export const ARCHIVED_SESSIONS_FILE = 'archived-sessions.json';

export interface ArchivedSessions {
  // Rejects when the file holds anything but a JSON array of strings, naming the file.
  ids(): Promise<ReadonlySet<string>>;
  // Writes run one after another, each reading the file the last one wrote.
  set(hostSessionId: string, archived: boolean): Promise<void>;
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === 'string')
  );
}

function parseArchivedIds(text: string): string[] {
  const unreadable = new Error(
    `${ARCHIVED_SESSIONS_FILE} is not a JSON array of session ids`,
  );
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw unreadable;
  }
  if (!isStringArray(parsed)) {
    throw unreadable;
  }
  return parsed;
}

// The host session ids the user archived, in archiving order, in
// `archived-sessions.json` in chat's data folder. A file that cannot be read
// is never overwritten: it is the user's state.
export function createArchivedSessions(data: Files): ArchivedSessions {
  let lastWrite: Promise<void> = Promise.resolve();

  // [] when the file is missing.
  async function readSaved(): Promise<string[]> {
    const text = await readIfPresent(data, ARCHIVED_SESSIONS_FILE);
    return text === null ? [] : parseArchivedIds(text);
  }

  async function write(hostSessionId: string, archived: boolean) {
    const saved = await readSaved();
    const isArchived = saved.includes(hostSessionId);
    if (isArchived === archived) {
      return;
    }
    const ids = archived
      ? [...saved, hostSessionId]
      : saved.filter((id) => id !== hostSessionId);
    await data.write(ARCHIVED_SESSIONS_FILE, JSON.stringify(ids, null, 2));
  }

  return {
    ids: async () => new Set(await readSaved()),
    set(hostSessionId, archived) {
      const written = lastWrite.then(() => write(hostSessionId, archived));
      lastWrite = written.catch(() => undefined);
      return written;
    },
  };
}
