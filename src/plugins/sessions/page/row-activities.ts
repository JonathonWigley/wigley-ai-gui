import type { KeyedSlotWriter } from '../../../contracts/state';
import type { RowActivity, RowActivitySource } from '../contract';

// Every session's activities in `sessionsActivitySlot`, one per source, in the
// order they were last set. `set` stores or, for null, removes the source's
// activity and returns whether the session's top changed; a session needs no
// row to hold activities. `top` is the highest-ranked activity, the latest set
// winning a tie; null for none. `forget` drops all of the session's activities.
export interface RowActivities {
  set(
    sessionId: string,
    sourceId: string,
    activity: RowActivity | null,
  ): boolean;
  top(sessionId: string): RowActivity | null;
  forget(sessionId: string): void;
}

export function createRowActivities(
  slot: KeyedSlotWriter<RowActivitySource[]>,
): RowActivities {
  const top = (sessionId: string): RowActivity | null => {
    let found: RowActivity | null = null;
    for (const { activity } of slot.get(sessionId) ?? []) {
      if (found === null || activity.rank >= found.rank) {
        found = activity;
      }
    }
    return found;
  };

  return {
    set(sessionId, sourceId, activity) {
      const before = top(sessionId);
      const others = (slot.get(sessionId) ?? []).filter(
        (source) => source.sourceId !== sourceId,
      );
      const sources =
        activity === null ? others : [...others, { sourceId, activity }];
      if (sources.length === 0) {
        slot.delete(sessionId);
      } else {
        slot.set(sessionId, sources);
      }
      return !sameActivity(before, top(sessionId));
    },
    top,
    forget(sessionId) {
      slot.delete(sessionId);
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
