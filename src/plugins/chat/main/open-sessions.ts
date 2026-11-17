import type { SessionControl, UserMessage } from '../../../contracts/agent';
import { type Files, readIfPresent } from '../../../contracts/files';
import { isJsonObject } from '../../../shared/json';
import { type SessionTitles, TITLE_SOURCES } from '../../sessions/contract';
import { UNRECORDED_HARNESS_ID } from './lookups';

export const OPEN_SESSIONS_FILE = 'open-sessions.json';

export interface SavedSession {
  hostSessionId: string;
  projectDir: string;
  // The id of the harness the row ran on. A file written without it reads as
  // UNRECORDED_HARNESS_ID.
  harness: string;
  profile: string;
  // Whether a message was ever sent in the session.
  sent: boolean;
  // Whether a turn was running when the snapshot was taken.
  busy: boolean;
  // The row's titles when the snapshot was taken.
  titles: SessionTitles;
  // The id of the row's last process start, which the session host knows it
  // by; null when the row never started one.
  processId: string | null;
  // The row's queued messages not yet sent, oldest first, images included.
  queued: UserMessage[];
  // The messages returned to the box that the page had not placed, oldest
  // first, images included.
  returned: UserMessage[];
  // The `AgentStart.controls` the row's last process start passed; {} when
  // the row never started one.
  launchControls: Record<string, string>;
  // The `AgentStart.resume` the row's last process start passed; false when
  // the row never started one.
  launchResume: boolean;
  // Whether the row's last process start carried the headless note; the
  // row's `headless` when the row never started one.
  launchHeadless: boolean;
  // The controls the row held, as its process last reported them; [] when no
  // process reported any.
  controls: SessionControl[];
  // Control id → the value the user picked in this row that a report confirmed.
  confirmedPicks: Record<string, string>;
  // The entry ids of the messages the last process dropped that chat has
  // already returned to the page.
  returnedDrops: string[];
  // The row's active time at the snapshot, its open span included. A restored
  // row's clock starts paused at it; a file written without it reads as 0.
  activeMs: number;
  // The row's id when the snapshot was taken, which the restored row takes
  // back on a restart of chat or sessions and on a relaunch. The kept id keeps
  // chat's kept slot keys, the main-side readers keyed by row, and the
  // WIGLEY_SESSION_ROW of a detached process; it does not keep the pages'
  // places. Null in a file written without it.
  rowId: string | null;
  // The row was launched unattended: each permission prompt is denied at once.
  // A file written without it reads as false.
  unattended: boolean;
  // The row is headless, as the user or its launching session set it. A file
  // written without it reads as false.
  headless: boolean;
  // The texts the row carries to its harness after the global ones. A file
  // written without it reads as [].
  instructions: string[];
  // The plugin the row belongs to; null for a row with none, and in a file
  // written without it.
  owner: string | null;
}

// The titles of a session that has none.
export const NO_TITLES: SessionTitles = {
  user: null,
  agent: null,
  firstMessage: null,
};

// A saved session as the file holds it: a file written before a field was
// saved has none.
type LaterSavedField =
  | 'harness'
  | 'titles'
  | 'processId'
  | 'queued'
  | 'returned'
  | 'launchControls'
  | 'launchResume'
  | 'launchHeadless'
  | 'controls'
  | 'confirmedPicks'
  | 'returnedDrops'
  | 'activeMs'
  | 'rowId'
  | 'unattended'
  | 'headless'
  | 'instructions'
  | 'owner';

type StoredSession = Omit<SavedSession, LaterSavedField> &
  Partial<Pick<SavedSession, LaterSavedField>>;

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

function isOptionalId(value: unknown): boolean {
  return value === undefined || value === null || typeof value === 'string';
}

function isOptionalMessages(value: unknown): boolean {
  return (
    value === undefined || (Array.isArray(value) && value.every(isSavedMessage))
  );
}

function isOptionalStringRecord(value: unknown): boolean {
  return (
    value === undefined ||
    (isJsonObject(value) &&
      Object.values(value).every((held) => typeof held === 'string'))
  );
}

function isSavedChoice(value: unknown): boolean {
  return (
    isJsonObject(value) &&
    typeof value.value === 'string' &&
    typeof value.label === 'string'
  );
}

function isSavedControl(value: unknown): boolean {
  return (
    isJsonObject(value) &&
    typeof value.id === 'string' &&
    typeof value.label === 'string' &&
    Array.isArray(value.choices) &&
    value.choices.every(isSavedChoice) &&
    (value.value === null || typeof value.value === 'string')
  );
}

function isOptionalControlList(value: unknown): boolean {
  return (
    value === undefined || (Array.isArray(value) && value.every(isSavedControl))
  );
}

function isOptionalStrings(value: unknown): boolean {
  return (
    value === undefined ||
    (Array.isArray(value) && value.every((held) => typeof held === 'string'))
  );
}

function isOptionalActiveMs(value: unknown): boolean {
  return (
    value === undefined ||
    (typeof value === 'number' && Number.isFinite(value) && value >= 0)
  );
}

function isStoredSession(value: unknown): value is StoredSession {
  return (
    isJsonObject(value) &&
    typeof value.hostSessionId === 'string' &&
    typeof value.projectDir === 'string' &&
    (value.harness === undefined || typeof value.harness === 'string') &&
    typeof value.profile === 'string' &&
    typeof value.sent === 'boolean' &&
    typeof value.busy === 'boolean' &&
    (value.titles === undefined || isSessionTitles(value.titles)) &&
    isOptionalId(value.processId) &&
    isOptionalMessages(value.queued) &&
    isOptionalMessages(value.returned) &&
    isOptionalStringRecord(value.launchControls) &&
    (value.launchResume === undefined ||
      typeof value.launchResume === 'boolean') &&
    (value.launchHeadless === undefined ||
      typeof value.launchHeadless === 'boolean') &&
    isOptionalControlList(value.controls) &&
    isOptionalStringRecord(value.confirmedPicks) &&
    isOptionalStrings(value.returnedDrops) &&
    isOptionalActiveMs(value.activeMs) &&
    isOptionalId(value.rowId) &&
    (value.unattended === undefined || typeof value.unattended === 'boolean') &&
    (value.headless === undefined || typeof value.headless === 'boolean') &&
    isOptionalStrings(value.instructions) &&
    isOptionalId(value.owner)
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
      hostSessionId: stored.hostSessionId,
      projectDir: stored.projectDir,
      harness: stored.harness ?? UNRECORDED_HARNESS_ID,
      profile: stored.profile,
      sent: stored.sent,
      busy: stored.busy,
      titles: stored.titles ?? NO_TITLES,
      processId: stored.processId ?? null,
      queued: stored.queued ?? [],
      returned: stored.returned ?? [],
      launchControls: stored.launchControls ?? {},
      launchResume: stored.launchResume ?? false,
      launchHeadless: stored.launchHeadless ?? stored.headless ?? false,
      controls: stored.controls ?? [],
      confirmedPicks: stored.confirmedPicks ?? {},
      returnedDrops: stored.returnedDrops ?? [],
      activeMs: stored.activeMs ?? 0,
      rowId: stored.rowId ?? null,
      unattended: stored.unattended ?? false,
      headless: stored.headless ?? false,
      instructions: stored.instructions ?? [],
      owner: stored.owner ?? null,
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
