import { callEach } from '../../../shared/call-each';
import type { SessionLines } from './session-lines';

// The page's usage line instances, one per part a host places (the context line,
// the spend, the side-bar row's line and cache mark, usage-tab-line's tab bar).
// `redraw` and `forget` reach every added instance, a throw in one not skipping
// the rest.
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
