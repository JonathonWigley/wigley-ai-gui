import { type Files, readIfPresent } from '../../../contracts/files';
import type { PluginLog } from '../../../contracts/log';
import { errorText } from '../../../shared/error-text';
import type {
  ProcessEndReason,
  SessionCloseReason,
  SessionOrigin,
} from '../../chat/contract';
import type { Harness, SessionTitles } from '../../sessions/contract';

export const SESSION_EVENTS_FILE = 'session-events.jsonl';

// One line of the log. A null in a terminal line is what the relay did not say.
// An `opened` and a `closed` line do not pair: a restored row whose profile is
// missing logs no `opened`, and a closed or cleared row's process logs no
// `processEnded`.
export type SessionLogEntry =
  | {
      at: number;
      event: 'opened';
      sessionId: string;
      hostSessionId: string;
      projectDir: string;
      profile: string;
      origin: SessionOrigin;
    }
  | {
      at: number;
      event: 'closed';
      sessionId: string;
      hostSessionId: string;
      projectDir: string;
      profile: string;
      titles: SessionTitles;
      sent: boolean;
      reason: SessionCloseReason;
    }
  | {
      at: number;
      event: 'cleared';
      sessionId: string;
      oldHostSessionId: string;
      newHostSessionId: string;
      projectDir: string;
      profile: string;
      titles: SessionTitles;
      sent: boolean;
    }
  | {
      at: number;
      event: 'processEnded';
      sessionId: string;
      hostSessionId: string;
      reason: ProcessEndReason;
      code: number | null;
      error: string | null;
    }
  | {
      at: number;
      event: 'archived';
      hostSessionId: string;
      archived: boolean;
    }
  | {
      at: number;
      event: 'terminalConnected';
      sessionId: string;
      hostSessionId: string | null;
      projectDir: string | null;
      harness: Harness | null;
    }
  | {
      at: number;
      event: 'terminalEnded';
      sessionId: string;
      hostSessionId: string | null;
      projectDir: string | null;
    };

// The append-only log file. Appends run in call order, each after the last
// settles; `append` never rejects, a failed one logged and the next still run.
// A crash or a failed write can leave the last line cut with no newline, so a
// log's first write, and the next after a failed one, leads with a newline: the
// new line would otherwise join the cut one and neither would parse.
// `entries` waits for the last append and returns the file's whole, known lines,
// logging each other non-blank line it skips: `[]` for a missing file, and a
// rejection for any other read failure. `settled` resolves when the last append
// has settled.
export interface SessionEventLog {
  append(entry: SessionLogEntry): Promise<void>;
  entries(): Promise<SessionLogEntry[]>;
  settled(): Promise<void>;
}

type EventFields = {
  [Event in SessionLogEntry['event']]: readonly Exclude<
    keyof Extract<SessionLogEntry, { event: Event }>,
    'at' | 'event'
  >[];
};

const EVENT_FIELDS: EventFields = {
  opened: ['sessionId', 'hostSessionId', 'projectDir', 'profile', 'origin'],
  closed: [
    'sessionId',
    'hostSessionId',
    'projectDir',
    'profile',
    'titles',
    'sent',
    'reason',
  ],
  cleared: [
    'sessionId',
    'oldHostSessionId',
    'newHostSessionId',
    'projectDir',
    'profile',
    'titles',
    'sent',
  ],
  processEnded: ['sessionId', 'hostSessionId', 'reason', 'code', 'error'],
  archived: ['hostSessionId', 'archived'],
  terminalConnected: ['sessionId', 'hostSessionId', 'projectDir', 'harness'],
  terminalEnded: ['sessionId', 'hostSessionId', 'projectDir'],
};

function isSessionLogEntry(value: unknown): value is SessionLogEntry {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const { event } = value as { event?: unknown };
  if (typeof event !== 'string' || !Object.hasOwn(EVENT_FIELDS, event)) {
    return false;
  }
  const fields: readonly string[] =
    EVENT_FIELDS[event as SessionLogEntry['event']];
  return ['at', ...fields].every((field) => Object.hasOwn(value, field));
}

function parsedEntry(line: string): SessionLogEntry | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  return isSessionLogEntry(value) ? value : null;
}

function parsedEntries(text: string, log: PluginLog): SessionLogEntry[] {
  const entries: SessionLogEntry[] = [];
  for (const [index, line] of text.split('\n').entries()) {
    if (line === '') {
      continue;
    }
    const entry = parsedEntry(line);
    if (entry === null) {
      log(
        `${SESSION_EVENTS_FILE} line ${index + 1} skipped: not a whole, known event`,
      );
    } else {
      entries.push(entry);
    }
  }
  return entries;
}

export function createSessionEventLog(deps: {
  files: Pick<Files, 'append' | 'read'>;
  log: PluginLog;
}): SessionEventLog {
  let lastAppend: Promise<void> = Promise.resolve();
  let tailMayBeCut = true;
  return {
    append(entry) {
      const line = JSON.stringify(entry) + '\n';
      lastAppend = lastAppend
        .then(async () => {
          await deps.files.append(
            SESSION_EVENTS_FILE,
            tailMayBeCut ? '\n' + line : line,
          );
          tailMayBeCut = false;
        })
        .catch((error: unknown) => {
          tailMayBeCut = true;
          deps.log(`event not logged: ${errorText(error)}`);
        });
      return lastAppend;
    },
    async entries() {
      await lastAppend;
      const text = await readIfPresent(deps.files, SESSION_EVENTS_FILE);
      return text === null ? [] : parsedEntries(text, deps.log);
    },
    settled: () => lastAppend,
  };
}
