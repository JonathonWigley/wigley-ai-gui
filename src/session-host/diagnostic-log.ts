import { appendFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import type { Clock } from '../contracts/ambient';
import {
  hostLogFile,
  previousHostLogFile,
  SESSION_HOST_PROTOCOL,
} from '../contracts/session-host-protocol';

// The host's own log in the host folder. Creating one touches no file: a host that does not own the channel writes
// only the error that ends it. Neither method throws: a host keeps its sessions over a log it cannot write.
export interface DiagnosticLog {
  append(message: string): void;
  // Keeps the last host's log as `previousHostLogFile`, replacing the one before.
  setAsidePrevious(): void;
}

export function createDiagnosticLog(
  folder: string,
  clock: Clock,
): DiagnosticLog {
  const file = path.join(folder, hostLogFile(SESSION_HOST_PROTOCOL));
  const previous = path.join(
    folder,
    previousHostLogFile(SESSION_HOST_PROTOCOL),
  );
  return {
    append(message) {
      try {
        appendFileSync(
          file,
          `${new Date(clock.now()).toISOString()} ${message}\n`,
        );
      } catch {
        // Nothing is left to report it to.
      }
    },
    setAsidePrevious() {
      try {
        renameSync(file, previous);
      } catch {
        // The first host of a folder has no log to set aside.
      }
    },
  };
}
