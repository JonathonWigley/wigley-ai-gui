import type { Disposable } from '../../../contracts/disposable';
import { callEach } from '../../../shared/call-each';
import type { SessionLines } from './session-lines';

// The page's usage line instances, one per part a host places (the context line,
// the spend, the side-bar row's line and cache mark, usage-tab-line's tab bar).
// `redraw` and `forget` reach every added instance, a throw in one not skipping
// the rest. `add`'s handle removes the instance; a second `dispose` does nothing.
export interface SessionLineParts {
  add(lines: SessionLines): Disposable;
  redraw(): void;
  forget(sessionId: string): void;
}

export function createSessionLineParts(): SessionLineParts {
  const added = new Set<SessionLines>();
  return {
    add(lines) {
      added.add(lines);
      return { dispose: () => added.delete(lines) };
    },
    redraw() {
      callEach([...added], (lines) => lines.redraw());
    },
    forget(sessionId) {
      callEach([...added], (lines) => lines.forget(sessionId));
    },
  };
}
