import type { PastSessionRow } from '../contract';

export type SessionItem =
  | { kind: 'new'; label: string }
  | { kind: 'past'; row: PastSessionRow; label: string };

// Whether a past session's row is archived, as the archive key acts on it.
export type ArchiveState = 'live' | 'archived';

export const NEW_SESSION_LABEL = 'New session';
export const SESSION_STEP_TITLE = 'Session';

// Local time as `YYYY-MM-DD HH:mm`.
export function sessionTime(modified: number): string {
  const date = new Date(modified);
  const pad = (value: number) => String(value).padStart(2, '0');
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return `${day} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// The session step's lines: the new-session line, then the rows in the order
// given, the archived ones only when `showArchived`.
export function sessionItems(
  rows: readonly PastSessionRow[],
  showArchived: boolean,
): SessionItem[] {
  const pastItems: SessionItem[] = rows
    .filter((row) => showArchived || !row.archived)
    .map((row) => ({ kind: 'past', row, label: pastLabel(row) }));
  return [{ kind: 'new', label: NEW_SESSION_LABEL }, ...pastItems];
}

// The archive state of a past session's line; null for the new-session line.
export function archiveStateOf(item: SessionItem): ArchiveState | null {
  if (item.kind === 'new') {
    return null;
  }
  return item.row.archived ? 'archived' : 'live';
}

function pastLabel(row: PastSessionRow): string {
  const label = `${row.title} · ${sessionTime(row.modified)}`;
  return row.archived ? `${label} · archived` : label;
}

// A copy of `rows` with the `hostSessionId` row's `archived` set.
export function withArchived(
  rows: readonly PastSessionRow[],
  hostSessionId: string,
  archived: boolean,
): PastSessionRow[] {
  return rows.map((row) =>
    row.hostSessionId === hostSessionId ? { ...row, archived } : row,
  );
}

// The cursor index in `after` for the item under `cursor` in `before`: the
// same past session, else the first later one `after` still holds, else the
// last line; 0 when the cursor was on the new-session line or nowhere.
export function selectedAfterChange(
  before: readonly SessionItem[],
  cursor: number | null,
  after: readonly SessionItem[],
): number {
  const isInRange = cursor !== null && cursor >= 0 && cursor < before.length;
  if (!isInRange || before[cursor].kind === 'new') {
    return 0;
  }
  for (const item of before.slice(cursor)) {
    const index = indexOfPast(after, item);
    if (index !== -1) {
      return index;
    }
  }
  return after.length - 1;
}

function indexOfPast(
  items: readonly SessionItem[],
  wanted: SessionItem,
): number {
  if (wanted.kind !== 'past') {
    return -1;
  }
  return items.findIndex(
    (item) =>
      item.kind === 'past' &&
      item.row.hostSessionId === wanted.row.hostSessionId,
  );
}
