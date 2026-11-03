import type { Disposable } from '../../../contracts/disposable';
import { callEach } from '../../../shared/call-each';
import type { SessionLines } from './session-lines';

// The page's session line instances, one per surface that places the line (the
// Chat status line, usage-tab-line's tab bar). `redraw` and `forget` reach
// every added instance, a throw in one not skipping the rest. `add`'s handle
// removes the instance; a second `dispose` does nothing.
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
