import { callEach } from '../../../shared/call-each';
import type { SessionLines } from './session-lines';

// The page's session line instances, one per surface that places the line (the
// Chat status line, usage-tab-line's tab bar). `redraw` and `forget` reach
// every added instance, a throw in one not skipping the rest.
export interface SessionLineParts {
  add(lines: SessionLines): void;
  redraw(): void;
  forget(sessionId: string): void;
}

export function createSessionLineParts(): SessionLineParts {
  const added: SessionLines[] = [];
  return {
    add(lines) {
      added.push(lines);
    },
    redraw() {
      callEach(added, (lines) => lines.redraw());
    },
    forget(sessionId) {
      callEach(added, (lines) => lines.forget(sessionId));
    },
  };
}
