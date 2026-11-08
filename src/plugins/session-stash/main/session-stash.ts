import type { PluginLog } from '../../../contracts/log';
import { errorText } from '../../../shared/error-text';
import type { ChatMainEvents, ResumeSectionRow } from '../../chat/contract';
import { editableTitle } from '../../sessions/contract';
import type { StashRequest } from '../contract';
import type { StashRecord, StashStore } from './stash-store';

export interface SessionStashDeps {
  store: StashStore;
  log: PluginLog;
  now: () => number;
}

// The stash flow over chat's events. `request` keeps a note for the session
// in memory until its close; `closed` writes the stash of a pending session the
// user closed after sending it a message, and drops the pending note of any
// close; `messageSent` drops a pending note, since a send means the user
// carried on (a close confirm they turned down); `opened` removes the stash of
// a session resumed from the start prompt. `rows` is the Stashed section's
// rows: the resumable stashes, newest last. A failed write is logged.
export interface SessionStash {
  request(request: StashRequest): void;
  closed(closed: ChatMainEvents['sessionClosed']): void;
  messageSent(sessionId: string): void;
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
  return record.note === undefined ? row : { ...row, note: record.note };
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
    return note === null ? record : { ...record, note };
  };

  return {
    request({ sessionId, note }) {
      pending.set(sessionId, note);
    },
    closed(closed) {
      const note = pending.get(closed.sessionId);
      if (note === undefined) {
        return;
      }
      pending.delete(closed.sessionId);
      if (closed.reason !== 'user') {
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
    messageSent(sessionId) {
      if (pending.delete(sessionId)) {
        log('stash dropped: a message was sent');
      }
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
    rows: async (isResumable) =>
      (await store.records())
        .filter((record) => isResumable(record.hostSessionId))
        .map(rowOf),
  };
}
