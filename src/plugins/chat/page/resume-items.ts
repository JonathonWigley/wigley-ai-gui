import type { Paths } from '../../../contracts/paths';
import type {
  PastSessionRow,
  ResumeSectionRow,
  ResumeSectionRows,
} from '../contract';

export type SessionItem =
  | { kind: 'new'; label: string }
  | { kind: 'past'; row: PastSessionRow; label: string }
  | {
      kind: 'section';
      section: string;
      row: PastSessionRow;
      closed: ResumeSectionRow;
      label: string;
    };

// Whether a past session's row is archived, as the archive key acts on it.
export type ArchiveState = 'live' | 'archived';

export const NEW_SESSION_LABEL = 'New session';
export const SESSION_STEP_TITLE = 'Session';
export const SESSIONS_HEADING = 'Sessions';

// Local time as `YYYY-MM-DD HH:mm`.
export function sessionTime(modified: number): string {
  const date = new Date(modified);
  const pad = (value: number) => String(value).padStart(2, '0');
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return `${day} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// Every section's rows in the order given, each session once, under the first
// section that holds it.
export function sectionRowsOnce(
  sections: readonly ResumeSectionRows[],
): { section: string; row: ResumeSectionRow }[] {
  const seen = new Set<string>();
  const once: { section: string; row: ResumeSectionRow }[] = [];
  for (const { title, rows } of sections) {
    for (const row of rows) {
      if (!seen.has(row.hostSessionId)) {
        seen.add(row.hostSessionId);
        once.push({ section: title, row });
      }
    }
  }
  return once;
}

// The session step's lines: the section rows of `step`'s folder and profile
// whose session `rows` holds unarchived, then the new-session line, then the
// other rows in the order given, the archived ones only when `showArchived`.
export function sessionItems(
  rows: readonly PastSessionRow[],
  sections: readonly ResumeSectionRows[],
  step: { projectDir: string; profile: string },
  paths: Paths,
  showArchived: boolean,
): SessionItem[] {
  const sectionItems: SessionItem[] = [];
  const inSection = new Set<string>();
  for (const { section, row: closed } of sectionRowsOnce(sections)) {
    const isInStep =
      paths.samePath(closed.projectDir, step.projectDir) &&
      closed.profile === step.profile;
    const saved = rows.find(
      (row) => row.hostSessionId === closed.hostSessionId && !row.archived,
    );
    if (isInStep && saved !== undefined) {
      inSection.add(closed.hostSessionId);
      sectionItems.push({
        kind: 'section',
        section,
        row: saved,
        closed,
        label: `${closed.title} · ${sessionTime(closed.at)}`,
      });
    }
  }
  const pastItems: SessionItem[] = rows
    .filter(
      (row) =>
        (showArchived || !row.archived) && !inSection.has(row.hostSessionId),
    )
    .map((row) => ({ kind: 'past', row, label: pastLabel(row) }));
  return [
    ...sectionItems,
    { kind: 'new', label: NEW_SESSION_LABEL },
    ...pastItems,
  ];
}

// The heading `item` sits under: its section, else `SESSIONS_HEADING`; null
// for every line of a step that shows no section rows.
export function sessionSection(
  item: SessionItem,
  showsSections: boolean,
): string | null {
  if (item.kind === 'section') {
    return item.section;
  }
  return showsSections ? SESSIONS_HEADING : null;
}

export function newSessionIndex(items: readonly SessionItem[]): number {
  return items.findIndex((item) => item.kind === 'new');
}

// The archive state of a saved session's line, so `live` for a section row,
// which shows only an unarchived session; null for the new-session line.
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

// The cursor index in `after` for the line under `cursor` in `before`: the
// same line, else the first later one `after` still holds, else the last line;
// the new-session line when the cursor was nowhere. A session is one line in
// either kind, past or section.
export function selectedAfterChange(
  before: readonly SessionItem[],
  cursor: number | null,
  after: readonly SessionItem[],
): number {
  const isInRange = cursor !== null && cursor >= 0 && cursor < before.length;
  if (!isInRange) {
    return newSessionIndex(after);
  }
  for (const line of before.slice(cursor)) {
    const index = after.findIndex((item) => isSameLine(item, line));
    if (index !== -1) {
      return index;
    }
  }
  return after.length - 1;
}

function isSameLine(a: SessionItem, b: SessionItem): boolean {
  if (a.kind === 'new' || b.kind === 'new') {
    return a.kind === b.kind;
  }
  return a.row.hostSessionId === b.row.hostSessionId;
}
