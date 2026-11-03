import type { UserMessage } from '../../../contracts/agent';
import { type Files, readIfPresent } from '../../../contracts/files';
import { isJsonObject } from '../../../shared/json';
import { type SessionTitles, TITLE_SOURCES } from '../../sessions/contract';

export const OPEN_SESSIONS_FILE = 'open-sessions.json';

export interface SavedSession {
  hostSessionId: string;
  projectDir: string;
  profile: string;
  // Whether a message was ever sent in the session.
  sent: boolean;
  // Whether a turn was running when the snapshot was taken.
  busy: boolean;
  // The row's titles when the snapshot was taken.
  titles: SessionTitles;
  // The id of the row's last process start, which the session host knows it by; null when the row never started one.
  processId: string | null;
  // The row's queued messages not yet sent, oldest first, images included.
  queued: UserMessage[];
  // The `AgentStart.controls` the row's last process start passed; {} when the row never started one.
  launchControls: Record<string, string>;
  // The `AgentStart.resume` the row's last process start passed; false when the row never started one.
  launchResume: boolean;
}

// The titles of a session that has none.
export const NO_TITLES: SessionTitles = {
  user: null,
  agent: null,
  firstMessage: null,
};

// A saved session as the file holds it: a file written before a field was
// saved has none.
type StoredSession = Omit<
  SavedSession,
  'titles' | 'processId' | 'queued' | 'launchControls' | 'launchResume'
> &
  Partial<
    Pick<
      SavedSession,
      'titles' | 'processId' | 'queued' | 'launchControls' | 'launchResume'
    >
  >;

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

function isSessionTitles(value: unknown): value is SessionTitles {
  return (
    isJsonObject(value) &&
    TITLE_SOURCES.every(
      (source) => value[source] === null || typeof value[source] === 'string',
    )
  );
}

function isSavedImage(value: unknown): boolean {
  return (
    isJsonObject(value) &&
    typeof value.mediaType === 'string' &&
    typeof value.data === 'string'
  );
}

function isSavedMessage(value: unknown): boolean {
  return (
    isJsonObject(value) &&
    typeof value.text === 'string' &&
    Array.isArray(value.images) &&
    value.images.every(isSavedImage)
  );
}

function isOptionalProcessId(value: unknown): boolean {
  return value === undefined || value === null || typeof value === 'string';
}

function isOptionalQueue(value: unknown): boolean {
  return (
    value === undefined || (Array.isArray(value) && value.every(isSavedMessage))
  );
}

function isOptionalControls(value: unknown): boolean {
  return (
    value === undefined ||
    (isJsonObject(value) &&
      Object.values(value).every((held) => typeof held === 'string'))
  );
}

function isStoredSession(value: unknown): value is StoredSession {
  return (
    isJsonObject(value) &&
    typeof value.hostSessionId === 'string' &&
    typeof value.projectDir === 'string' &&
    typeof value.profile === 'string' &&
    typeof value.sent === 'boolean' &&
    typeof value.busy === 'boolean' &&
    (value.titles === undefined || isSessionTitles(value.titles)) &&
    isOptionalProcessId(value.processId) &&
    isOptionalQueue(value.queued) &&
    isOptionalControls(value.launchControls) &&
    (value.launchResume === undefined ||
      typeof value.launchResume === 'boolean')
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
  const { sessions, selectedHostSessionId } = parsed;
  const hasSessions =
    Array.isArray(sessions) && sessions.every(isStoredSession);
  const hasSelected =
    selectedHostSessionId === null || typeof selectedHostSessionId === 'string';
  if (!hasSessions || !hasSelected) {
    throw unreadable;
  }
  return {
    sessions: (sessions as StoredSession[]).map((stored) => ({
      ...stored,
      titles: stored.titles ?? NO_TITLES,
      processId: stored.processId ?? null,
      queued: stored.queued ?? [],
      launchControls: stored.launchControls ?? {},
      launchResume: stored.launchResume ?? false,
    })),
    selectedHostSessionId,
  };
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
