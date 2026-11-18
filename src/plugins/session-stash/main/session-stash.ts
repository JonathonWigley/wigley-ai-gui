import { DEMO_HARNESS_ID, DEMO_PROFILE } from '../../../contracts/demo';
import type { PluginLog } from '../../../contracts/log';
import { errorText } from '../../../shared/error-text';
import {
  type ChatMainEvents,
  isUserClose,
  type ResumeSectionRow,
} from '../../chat/contract';
import { editableTitle } from '../../sessions/contract';
import type { StashRequest } from '../contract';
import type { StashRecord, StashStore } from './stash-store';

// `ownsSession` is whether chat owns the row, so its close fires
// `chat.sessionClosed`. `isDemoRunning` is whether the demo harness is
// registered; `sampleProjectDir` is the folder the demo's sample rows name.
export interface SessionStashDeps {
  store: StashStore;
  log: PluginLog;
  now: () => number;
  ownsSession: (sessionId: string) => boolean;
  isDemoRunning(): boolean;
  sampleProjectDir: string;
}

// The stash flow over chat's events. `request` keeps a note for a session chat
// owns in memory until its close and returns true; for any other session it
// keeps nothing, logs the refusal and returns false. `drop` forgets a kept note
// whose close did not happen; `forgetKept` forgets every kept note, for a page
// that started again. `closed` writes the stash of a kept session the
// user closed after sending it a message, and drops the kept note of any close;
// an ephemeral session's kept note is dropped with a log line, never written.
// A headless session's stash keeps the flag, and its row resumes it headless.
// `opened` removes the stash of a session resumed from the start prompt.
// `rows` is the Stashed section's rows: the resumable stashes, newest last;
// while the demo runs, the sample rows instead, with no read of the store. A
// failed write is logged.
export interface SessionStash {
  request(request: StashRequest): boolean;
  drop(sessionId: string): void;
  forgetKept(): void;
  closed(closed: ChatMainEvents['sessionClosed']): void;
  opened(opened: ChatMainEvents['sessionOpened']): void;
  rows(
    isResumable: (hostSessionId: string) => boolean,
  ): Promise<ResumeSectionRow[]>;
}

function rowOf(record: StashRecord): ResumeSectionRow {
  const row: ResumeSectionRow = {
    hostSessionId: record.hostSessionId,
    projectDir: record.projectDir,
    profile: record.profile,
    title: record.title,
    at: record.at,
  };
  if (record.note !== undefined) {
    row.note = record.note;
  }
  if (record.headless === true) {
    row.headless = true;
  }
  return row;
}

export function createSessionStash(deps: SessionStashDeps): SessionStash {
  const { store, log } = deps;
  const pending = new Map<string, string | null>();

  const recordOf = (
    closed: ChatMainEvents['sessionClosed'],
    note: string | null,
  ): StashRecord => {
    const record: StashRecord = {
      hostSessionId: closed.hostSessionId,
      projectDir: closed.projectDir,
      profile: closed.profile,
      title: editableTitle(closed.titles) || 'Untitled session',
      at: deps.now(),
    };
    if (note !== null) {
      record.note = note;
    }
    if (closed.headless) {
      record.headless = true;
    }
    return record;
  };

  return {
    request({ sessionId, note }) {
      if (!deps.ownsSession(sessionId)) {
        log(`stash refused: ${sessionId} is not a session the app started`);
        return false;
      }
      pending.set(sessionId, note);
      return true;
    },
    drop(sessionId) {
      if (pending.delete(sessionId)) {
        log(`stash dropped: ${sessionId} stayed open`);
      }
    },
    forgetKept() {
      if (pending.size > 0) {
        log(`stash dropped: ${pending.size} kept when the page started`);
        pending.clear();
      }
    },
    closed(closed) {
      const note = pending.get(closed.sessionId);
      if (note === undefined) {
        return;
      }
      pending.delete(closed.sessionId);
      if (closed.ephemeral === true) {
        log(`stash dropped: ${closed.sessionId} is ephemeral`);
        return;
      }
      if (!isUserClose(closed.reason)) {
        return;
      }
      const record = recordOf(closed, note);
      if (!closed.sent) {
        log(`closed without a stash, never sent a message: "${record.title}"`);
        return;
      }
      store.add(record).then(
        () => log(`stashed "${record.title}"`),
        (error: unknown) =>
          log(`stash of "${record.title}" not written: ${errorText(error)}`),
      );
    },
    opened(opened) {
      if (opened.origin !== 'resumed') {
        return;
      }
      store.remove(opened.hostSessionId).then(
        (removed) => {
          if (removed !== null) {
            log(`stash removed: "${removed.title}"`);
          }
        },
        (error: unknown) =>
          log(`stash not removed on resume: ${errorText(error)}`),
      );
    },
    rows: async (isResumable) => {
      if (deps.isDemoRunning()) {
        return sampleStashRows(deps.now(), deps.sampleProjectDir, isResumable);
      }
      return (await store.records())
        .filter((record) => isResumable(record.hostSessionId))
        .map(rowOf);
    },
  };
}

// The demo's stashed sessions, oldest first; `ago` is how long before now each
// was stashed.
const SAMPLE_STASHES = [
  {
    hostSessionId: 'demo-stash-1',
    title: 'Spike the offline cache',
    note: 'Paused until the sync API settles.',
    ago: 172_800_000,
  },
  {
    hostSessionId: 'demo-stash-2',
    title: 'Tidy the settings form',
    note: 'Halfway through the field layout.',
    ago: 10_800_000,
  },
];

// The Stashed rows while the demo runs, on the demo profile in the sample
// folder `projectDir`, oldest first, the ones `isResumable` refuses left out.
export function sampleStashRows(
  now: number,
  projectDir: string,
  isResumable: (hostSessionId: string) => boolean,
): ResumeSectionRow[] {
  return SAMPLE_STASHES.filter((sample) =>
    isResumable(sample.hostSessionId),
  ).map((sample) => ({
    hostSessionId: sample.hostSessionId,
    projectDir,
    harness: DEMO_HARNESS_ID,
    profile: DEMO_PROFILE,
    title: sample.title,
    note: sample.note,
    at: now - sample.ago,
  }));
}
