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
// `entries` waits for the last append and returns the file's whole, known lines,
// logging each other line it skips: `[]` for a missing file, and a rejection for
// any other read failure. `settled` resolves when the last append has settled.
export interface SessionEventLog {
  append(entry: SessionLogEntry): Promise<void>;
  entries(): Promise<SessionLogEntry[]>;
  settled(): Promise<void>;
}

const KNOWN_EVENTS: Record<SessionLogEntry['event'], true> = {
  opened: true,
  closed: true,
  cleared: true,
  processEnded: true,
  archived: true,
  terminalConnected: true,
  terminalEnded: true,
};

function isSessionLogEntry(value: unknown): value is SessionLogEntry {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const { event } = value as { event?: unknown };
  return typeof event === 'string' && Object.hasOwn(KNOWN_EVENTS, event);
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
      log(`${SESSION_EVENTS_FILE} line ${index + 1} skipped: not an event`);
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
  return {
    append(entry) {
      const line = JSON.stringify(entry) + '\n';
      lastAppend = lastAppend
        .then(() => deps.files.append(SESSION_EVENTS_FILE, line))
        .catch((error: unknown) => {
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
