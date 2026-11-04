import type { Clock } from '../../../contracts/ambient';
import type { UiState } from '../../../contracts/ui-state';
import { isJsonObject } from '../../../shared/json';

const RECENCY_KEY = 'recency';

// When each session last arrived or turned to needs you, by app session id.
// `stamps()` is the live map, read and never changed by callers. `noteArrived`
// stamps only a session with no stamp and returns whether it stamped, since a
// page reload re-sends every row. `noteNeedsYou` always stamps. `keepOnly` drops
// every stamp outside the ids, so a row that leaves and comes back stamps again.
// A change saves the whole record; a call that alters nothing saves nothing.
export interface SessionRecency {
  stamps(): ReadonlyMap<string, number>;
  noteArrived(sessionId: string): boolean;
  noteNeedsYou(sessionId: string): void;
  keepOnly(sessionIds: Iterable<string>): void;
}

// The stamps read once from `uiState`'s `recency` record; any other saved value,
// one bad entry included, reads as no stamps and stays until the first change.
export function createSessionRecency(
  clock: Clock,
  uiState: UiState,
): SessionRecency {
  const saved = uiState.get(RECENCY_KEY);
  const stamps = new Map(isStampRecord(saved) ? Object.entries(saved) : []);
  const save = () => uiState.set(RECENCY_KEY, Object.fromEntries(stamps));
  const stamp = (sessionId: string) => {
    stamps.set(sessionId, clock.now());
    save();
  };
  return {
    stamps: () => stamps,
    noteArrived(sessionId) {
      if (stamps.has(sessionId)) {
        return false;
      }
      stamp(sessionId);
      return true;
    },
    noteNeedsYou: stamp,
    keepOnly(sessionIds) {
      const kept = new Set(sessionIds);
      const dropped = [...stamps.keys()].filter((id) => !kept.has(id));
      if (dropped.length === 0) {
        return;
      }
      for (const id of dropped) {
        stamps.delete(id);
      }
      save();
    },
  };
}

function isStampRecord(value: unknown): value is Record<string, number> {
  return (
    isJsonObject(value) &&
    Object.values(value).every((stamp) => typeof stamp === 'number')
  );
}
