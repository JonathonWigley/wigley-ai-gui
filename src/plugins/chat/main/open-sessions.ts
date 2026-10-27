import { type Files, readIfPresent } from '../../../contracts/files';
import { isJsonObject } from '../../../shared/json';

export const OPEN_SESSIONS_FILE = 'open-sessions.json';

export interface SavedSession {
  hostSessionId: string;
  projectDir: string;
  profile: string;
  // Whether a message was ever sent in the session.
  sent: boolean;
  // Whether a turn was running when the snapshot was taken.
  busy: boolean;
}

export interface SavedSessions {
  // In row order.
  sessions: SavedSession[];
  selectedHostSessionId: string | null;
}

export interface OpenSessions {
  // An empty snapshot when the file is missing; rejects, naming the file,
  // when it holds anything but a saved-sessions snapshot.
  load(): Promise<SavedSessions>;
  // Writes run one after another. Rejects, writing nothing, while the last
  // `load` rejected.
  save(snapshot: SavedSessions): Promise<void>;
}

function isSavedSession(value: unknown): value is SavedSession {
  return (
    isJsonObject(value) &&
    typeof value.hostSessionId === 'string' &&
    typeof value.projectDir === 'string' &&
    typeof value.profile === 'string' &&
    typeof value.sent === 'boolean' &&
    typeof value.busy === 'boolean'
  );
}

function parseSavedSessions(text: string): SavedSessions {
  const unreadable = new Error(
    `${OPEN_SESSIONS_FILE} is not a saved-sessions snapshot`,
  );
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw unreadable;
  }
  if (!isJsonObject(parsed)) {
    throw unreadable;
  }
  const hasSessions =
    Array.isArray(parsed.sessions) && parsed.sessions.every(isSavedSession);
  const hasSelected =
    parsed.selectedHostSessionId === null ||
    typeof parsed.selectedHostSessionId === 'string';
  if (!hasSessions || !hasSelected) {
    throw unreadable;
  }
  return parsed as unknown as SavedSessions;
}

// The sessions chat has open, in `open-sessions.json` in chat's data folder.
// Chat holds the state and hands over whole snapshots. A file that cannot be
// read is never overwritten: it is the user's state.
export function createOpenSessions(data: Files): OpenSessions {
  let lastWrite: Promise<void> = Promise.resolve();
  let isUnreadable = false;

  async function load(): Promise<SavedSessions> {
    try {
      const text = await readIfPresent(data, OPEN_SESSIONS_FILE);
      const snapshot =
        text === null
          ? { sessions: [], selectedHostSessionId: null }
          : parseSavedSessions(text);
      isUnreadable = false;
      return snapshot;
    } catch (error) {
      isUnreadable = true;
      throw error;
    }
  }

  async function write(snapshot: SavedSessions): Promise<void> {
    if (isUnreadable) {
      throw new Error(
        `${OPEN_SESSIONS_FILE} is unreadable, so it is left as it is`,
      );
    }
    await data.write(OPEN_SESSIONS_FILE, JSON.stringify(snapshot, null, 2));
  }

  return {
    load,
    save(snapshot) {
      const written = lastWrite.then(() => write(snapshot));
      lastWrite = written.catch(() => undefined);
      return written;
    },
  };
}
