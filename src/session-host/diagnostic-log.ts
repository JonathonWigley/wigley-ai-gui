import { appendFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Clock } from '../contracts/ambient';
import {
  hostLogFile,
  SESSION_HOST_PROTOCOL,
} from '../contracts/session-host-protocol';

// The host's own log in the host folder. Creating one touches no file: a host that does not own the channel writes
// only the error that ends it.
export interface DiagnosticLog {
  append(message: string): void;
  empty(): void;
}

export function createDiagnosticLog(
  folder: string,
  clock: Clock,
): DiagnosticLog {
  const file = path.join(folder, hostLogFile(SESSION_HOST_PROTOCOL));
  return {
    append(message) {
      appendFileSync(
        file,
        `${new Date(clock.now()).toISOString()} ${message}\n`,
      );
    },
    empty() {
      writeFileSync(file, '');
    },
  };
}
