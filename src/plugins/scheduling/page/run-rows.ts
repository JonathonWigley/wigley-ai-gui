import type { Disposable } from '../../../contracts/disposable';
import { callEach } from '../../../shared/call-each';
import { isSameJson } from '../../../shared/json';
import type { RowActivity, SessionsPageExports } from '../../sessions/contract';
import type { SchedulingState } from '../contract';

// A finished scheduled run the user has not viewed: outranks chat's `done` (rank 10), under working (20).
export const SCHEDULED_RUN_DONE: RowActivity = {
  word: 'done',
  tone: 'success',
  rank: 15,
  emphasis: 'raised',
};

// Before auto-retro's Retro (1000): a scheduled run is the user's own work; a retro is housekeeping.
const RUN_SECTION_ORDER = 900;

const ACTIVITY_SOURCE = 'scheduling';

export interface RunRowsDeps {
  sessions: Pick<SessionsPageExports, 'addSection' | 'setActivity'>;
  log(line: string): void;
}

// Adds the Scheduled runs section and sets the done activity on each unviewed run row. `changed` takes the slot's
// value after each change; `dispose` removes the section and every activity it set. Sessions knows no change of
// `claims`, so each change of `runRows` adds the section again; main owns which rows are unviewed, and the marks
// mirror `unviewedRows`.
export function startRunRows(
  deps: RunRowsDeps,
  state: SchedulingState,
): { changed(state: SchedulingState): void; dispose(): void } {
  const { sessions, log } = deps;
  const marked = new Set<string>();

  const addSection = (runRows: readonly string[]): Disposable => {
    const section = sessions.addSection({
      id: 'scheduling',
      label: 'Scheduled runs',
      order: RUN_SECTION_ORDER,
      claims: (row) => runRows.includes(row.sessionId),
    });
    log(`run rows: ${runRows.length}`);
    return section;
  };

  const markUnviewed = (unviewedRows: readonly string[]) => {
    for (const sessionId of marked) {
      if (!unviewedRows.includes(sessionId)) {
        marked.delete(sessionId);
        sessions.setActivity(sessionId, ACTIVITY_SOURCE, null);
        log(`run row viewed: ${sessionId}`);
      }
    }
    for (const sessionId of unviewedRows) {
      if (!marked.has(sessionId)) {
        marked.add(sessionId);
        sessions.setActivity(sessionId, ACTIVITY_SOURCE, SCHEDULED_RUN_DONE);
        log(`run row done: ${sessionId}`);
      }
    }
  };

  let shown = state;
  let section = addSection(shown.runRows);
  markUnviewed(shown.unviewedRows);

  return {
    changed(next) {
      const last = shown;
      shown = next;
      if (!isSameJson(last.runRows, next.runRows)) {
        section.dispose();
        section = addSection(next.runRows);
      }
      markUnviewed(next.unviewedRows);
    },
    dispose() {
      try {
        callEach([...marked], (sessionId) =>
          sessions.setActivity(sessionId, ACTIVITY_SOURCE, null),
        );
      } finally {
        marked.clear();
        section.dispose();
      }
    },
  };
}
