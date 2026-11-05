import type { Clock } from '../../../contracts/ambient';
import type { UiState } from '../../../contracts/ui-state';
import { isJsonObject } from '../../../shared/json';
import type { SessionRow } from '../contract';
import { rowChanges } from './tabs';

const RECENCY_KEY = 'recency';
const PROJECT_RECENCY_KEY = 'projectRecency';

// A stamp whose session never comes back stays until this many newer ones push
// it out.
const MAX_SAVED_STAMPS = 200;

// When each session and each project's group arrived. A session's stamp sits
// under its row's host session id, else its app session id, so it outlasts a
// relaunch, which gives every row a new app id.
//
// `stampsOf` reads the stamps of `rows` by app session id. `projectStamps` reads
// the stamps by project.
// `rowsChanged` takes each state main sends, `before` null for the first one: a
// row in `after` with no stamp is stamped, all of them with one time so they tie
// and keep main's order; a row whose host id changed takes its stamp along; a
// row that left loses its stamp, so it stamps again if it comes back. Two rows
// can share a host id, so a row leaving or moving off a key leaves the stamp
// there while a row in `after` holds that key. A row merely absent keeps its
// stamp, since a relaunch's first state lacks the rows main has yet to resume.
// A project with no stamp takes its newest row's. A later row leaves it alone, so
// the group holds its place, and it goes when a state ends the project's last
// row, so the project stamps again if it comes back.
// A change saves the whole record; a call that alters nothing saves nothing.
export interface SessionRecency {
  stampsOf(rows: readonly SessionRow[]): ReadonlyMap<string, number>;
  projectStamps(): ReadonlyMap<string, number>;
  rowsChanged(
    before: readonly SessionRow[] | null,
    after: readonly SessionRow[],
  ): void;
}

// The records read once from `uiState`'s `recency` and `projectRecency` entries;
// any other saved value, one bad entry included, reads as empty and stays until
// the first change.
export function createSessionRecency(
  clock: Clock,
  uiState: UiState,
): SessionRecency {
  const saved = uiState.get(RECENCY_KEY);
  const stamps = new Map(
    isSavedRecency(saved) ? Object.entries(saved.stamps) : [],
  );
  const savedProjects = uiState.get(PROJECT_RECENCY_KEY);
  const projectStamps = new Map(
    isStampRecord(savedProjects) ? Object.entries(savedProjects) : [],
  );
  const save = () => {
    dropOldestStamps(stamps);
    dropOldestStamps(projectStamps);
    uiState.set(RECENCY_KEY, { stamps: Object.fromEntries(stamps) });
    uiState.set(PROJECT_RECENCY_KEY, Object.fromEntries(projectStamps));
  };
  return {
    stampsOf(rows) {
      const found = new Map<string, number>();
      for (const row of rows) {
        const stamp = stamps.get(stampKey(row));
        if (stamp !== undefined) {
          found.set(row.sessionId, stamp);
        }
      }
      return found;
    },
    projectStamps: () => projectStamps,
    rowsChanged(before, after) {
      const beforeRows = before ?? [];
      const { added, removed, changed } = rowChanges(beforeRows, after);
      const rowsBefore = new Map(beforeRows.map((row) => [row.sessionId, row]));
      const heldKeys = new Set(after.map((row) => stampKey(row)));
      // Moves come first: a row can move off a key a leaving row also held.
      const altered = [
        moveStamps(changed, rowsBefore, heldKeys, stamps),
        dropRows(removed, rowsBefore, heldKeys, stamps),
        stampRows(added, stamps, clock),
        dropProjects(beforeRows, after, projectStamps),
        stampProjects(after, stamps, projectStamps),
      ].includes(true);
      if (altered) {
        save();
      }
    },
  };
}

function stampKey(row: SessionRow): string {
  return row.hostSessionId ?? row.sessionId;
}

// Each of these returns whether it changed anything.

function dropRows(
  removed: readonly string[],
  rowsBefore: ReadonlyMap<string, SessionRow>,
  heldKeys: ReadonlySet<string>,
  stamps: Map<string, number>,
): boolean {
  let altered = false;
  for (const sessionId of removed) {
    const key = stampKey(rowsBefore.get(sessionId)!);
    const stampGone = !heldKeys.has(key) && stamps.delete(key);
    altered = altered || stampGone;
  }
  return altered;
}

// Every stamp is read before any is written, so rows that share a key, or that
// move onto each other's keys in one state, each take their own.
function moveStamps(
  changed: readonly SessionRow[],
  rowsBefore: ReadonlyMap<string, SessionRow>,
  heldKeys: ReadonlySet<string>,
  stamps: Map<string, number>,
): boolean {
  const moves = changed.flatMap((row) => {
    const oldKey = stampKey(rowsBefore.get(row.sessionId)!);
    const stamp = stamps.get(oldKey);
    return stamp === undefined
      ? []
      : [{ oldKey, newKey: stampKey(row), stamp }];
  });
  for (const { oldKey } of moves) {
    if (!heldKeys.has(oldKey)) {
      stamps.delete(oldKey);
    }
  }
  for (const { newKey, stamp } of moves) {
    stamps.set(newKey, stamp);
  }
  return moves.length > 0;
}

function stampRows(
  added: readonly SessionRow[],
  stamps: Map<string, number>,
  clock: Clock,
): boolean {
  const unstamped = added.filter((row) => !stamps.has(stampKey(row)));
  if (unstamped.length === 0) {
    return false;
  }
  const now = clock.now();
  for (const row of unstamped) {
    stamps.set(stampKey(row), now);
  }
  return true;
}

function dropProjects(
  before: readonly SessionRow[],
  after: readonly SessionRow[],
  projectStamps: Map<string, number>,
): boolean {
  const heldProjects = new Set(after.map((row) => row.project));
  let altered = false;
  for (const { project } of before) {
    const stampGone =
      !heldProjects.has(project) && projectStamps.delete(project);
    altered = altered || stampGone;
  }
  return altered;
}

function stampProjects(
  rows: readonly SessionRow[],
  stamps: ReadonlyMap<string, number>,
  projectStamps: Map<string, number>,
): boolean {
  const unstamped = rows.filter((row) => !projectStamps.has(row.project));
  let altered = false;
  for (const row of unstamped) {
    const stamp = stamps.get(stampKey(row));
    if (stamp !== undefined) {
      const held = projectStamps.get(row.project) ?? stamp;
      projectStamps.set(row.project, Math.max(held, stamp));
      altered = true;
    }
  }
  return altered;
}

function dropOldestStamps(stamps: Map<string, number>): void {
  const excess = stamps.size - MAX_SAVED_STAMPS;
  if (excess <= 0) {
    return;
  }
  const oldestFirst = [...stamps].sort(([, left], [, right]) => left - right);
  for (const [key] of oldestFirst.slice(0, excess)) {
    stamps.delete(key);
  }
}

function isSavedRecency(
  value: unknown,
): value is { stamps: Record<string, number> } {
  return isJsonObject(value) && isStampRecord(value.stamps);
}

function isStampRecord(value: unknown): value is Record<string, number> {
  return (
    isJsonObject(value) &&
    Object.values(value).every((stamp) => typeof stamp === 'number')
  );
}
