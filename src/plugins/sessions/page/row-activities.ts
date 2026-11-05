import type { RowActivity } from '../contract';

// Every session's activities, one per source. `set` stores or, for null,
// removes the source's activity and returns whether the session's top changed;
// a session needs no row to hold activities. `top` is the highest-ranked
// activity, the latest set winning a tie; null for none. `forget` drops all of
// the session's activities.
export interface RowActivities {
  set(
    sessionId: string,
    sourceId: string,
    activity: RowActivity | null,
  ): boolean;
  top(sessionId: string): RowActivity | null;
  forget(sessionId: string): void;
}

export function createRowActivities(): RowActivities {
  // Each session's activities by source, in the order they were last set.
  const bySession = new Map<string, Map<string, RowActivity>>();

  const top = (sessionId: string): RowActivity | null => {
    let found: RowActivity | null = null;
    for (const activity of bySession.get(sessionId)?.values() ?? []) {
      if (found === null || activity.rank >= found.rank) {
        found = activity;
      }
    }
    return found;
  };

  return {
    set(sessionId, sourceId, activity) {
      const before = top(sessionId);
      const sources = bySession.get(sessionId) ?? new Map();
      sources.delete(sourceId);
      if (activity !== null) {
        sources.set(sourceId, activity);
      }
      if (sources.size === 0) {
        bySession.delete(sessionId);
      } else {
        bySession.set(sessionId, sources);
      }
      return !sameActivity(before, top(sessionId));
    },
    top,
    forget(sessionId) {
      bySession.delete(sessionId);
    },
  };
}

function sameActivity(
  first: RowActivity | null,
  second: RowActivity | null,
): boolean {
  if (first === null || second === null) {
    return first === second;
  }
  return (
    first.word === second.word &&
    first.tone === second.tone &&
    first.emphasis === second.emphasis
  );
}
