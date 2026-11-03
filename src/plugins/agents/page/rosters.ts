import type { Disposable } from '../../../contracts/disposable';
import { callEach } from '../../../shared/call-each';
import { errorText } from '../../../shared/error-text';
import type { AgentsPageExports, Roster } from '../contract';

// The page's copy of every session's roster, and what agents' page part
// writes into it. `set` stores a `rosterChanged` roster; `fill` stores the
// one `rosters` read's rosters, skipping each session a `set` named while the
// read ran, since that `set` is newer; `settle` ends that read window; `forget`
// drops a session that left, telling no listener.
export interface PageRosters extends AgentsPageExports {
  set(sessionId: string, roster: Roster): void;
  fill(rosters: Record<string, Roster>): void;
  settle(): void;
  forget(sessionId: string): void;
}

// The read window is open from creation until `settle`. A listener's throw
// is logged as `roster listener failed: <error>` and the others still run.
export function createPageRosters(deps: {
  log: (line: string) => void;
}): PageRosters {
  const rosters = new Map<string, Roster>();
  const listeners = new Set<{ heard: (sessionId: string) => void }>();
  // Each session a `set` named while the read window is open; null once it
  // settles.
  let setWhileReading: Set<string> | null = new Set<string>();

  const tell = (sessionId: string) => {
    try {
      callEach([...listeners], (listener) => {
        if (listeners.has(listener)) {
          listener.heard(sessionId);
        }
      });
    } catch (error) {
      deps.log(`roster listener failed: ${errorText(error)}`);
    }
  };

  return {
    roster: (sessionId) => rosters.get(sessionId) ?? { agents: [], tasks: [] },
    onRosterChanged: (heard): Disposable => {
      const listener = { heard };
      listeners.add(listener);
      return { dispose: () => listeners.delete(listener) };
    },
    set(sessionId, roster) {
      rosters.set(sessionId, roster);
      setWhileReading?.add(sessionId);
      tell(sessionId);
    },
    fill(read) {
      for (const [sessionId, roster] of Object.entries(read)) {
        if (setWhileReading?.has(sessionId)) {
          continue;
        }
        rosters.set(sessionId, roster);
        tell(sessionId);
      }
    },
    settle() {
      setWhileReading = null;
    },
    forget(sessionId) {
      rosters.delete(sessionId);
    },
  };
}
