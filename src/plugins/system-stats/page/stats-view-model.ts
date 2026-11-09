import type {
  StatsMeter,
  StatsProcessRow,
  StatsSnapshot,
  StatsSortColumn,
} from '../contract';
import type {
  PanelInput,
  StatsMeterInput,
  StatsRowInput,
} from '../layouts/layout';

export type CursorMove = 'down' | 'up' | 'top' | 'bottom';

// A row as the panel shows it: a top-level row at depth 0, or a process of the open group `parentId` at depth 1.
export interface VisibleRow {
  row: StatsProcessRow;
  depth: 0 | 1;
  parentId: string | null;
}

const MIB = 2 ** 20;
const GIB = 2 ** 30;
const NO_READING = '—';

const NEXT_SORT: Record<StatsSortColumn, StatsSortColumn> = {
  cpu: 'ram',
  ram: 'gpu',
  gpu: 'cpu',
};

export function nextSort(sort: StatsSortColumn): StatsSortColumn {
  return NEXT_SORT[sort];
}

// A group row: an app, or the Claude Code group of Chat sessions, which opens to show its rows.
export function isGroup(row: StatsProcessRow): boolean {
  return row.kind === 'app';
}

// The first `max(1, processRows)` top-level rows sorted by `sort`, each open group followed by its rows sorted the
// same way; `moreRows` counts the top-level rows cut.
export function visibleRows(
  rows: readonly StatsProcessRow[],
  sort: StatsSortColumn,
  openIds: ReadonlySet<string>,
  processRows: number,
): { rows: VisibleRow[]; moreRows: number } {
  const compare = byColumn(sort);
  const shown = [...rows].sort(compare).slice(0, Math.max(1, processRows));
  const visible: VisibleRow[] = [];
  for (const row of shown) {
    visible.push({ row, depth: 0, parentId: null });
    if (openIds.has(row.id)) {
      for (const child of [...row.children].sort(compare)) {
        visible.push({ row: child, depth: 1, parentId: row.id });
      }
    }
  }
  return { rows: visible, moreRows: rows.length - shown.length };
}

// The cursor's index after `move` over `count` rows, clamped at both ends; an index of -1 moves as from 0.
export function movedCursor(
  index: number,
  count: number,
  move: CursorMove,
): number {
  const from = Math.max(0, index);
  const moved = {
    down: from + 1,
    up: from - 1,
    top: 0,
    bottom: count - 1,
  }[move];
  return Math.max(0, Math.min(count - 1, moved));
}

// The group a close acts on: the cursor's own open group, else the group of the process the cursor is on; null for
// a closed group, a lone process, or a cursor on no visible row.
export function closeTarget(
  visible: readonly VisibleRow[],
  cursorId: string,
): string | null {
  const index = visible.findIndex(({ row }) => row.id === cursorId);
  if (index === -1) {
    return null;
  }
  const entry = visible[index];
  if (entry.parentId !== null) {
    return entry.parentId;
  }
  return isOpenAt(visible, index) ? entry.row.id : null;
}

export function formatPercent(percent: number): string {
  return `${percent.toFixed(1)}%`;
}

// Below 1 GiB, whole MiB as `MB`; from it, GiB to one decimal as `GB`.
export function formatBytes(bytes: number): string {
  return bytes < GIB
    ? `${Math.round(bytes / MIB)} MB`
    : `${(bytes / GIB).toFixed(1)} GB`;
}

export function formatRam(bytes: number | null): string {
  return bytes === null ? NO_READING : formatBytes(bytes);
}

export function formatGpu(percent: number | null): string {
  return percent === null ? NO_READING : formatPercent(percent);
}

// The layout's input: `reading` with no snapshot, else the five meters and the visible rows, the cursor on the row
// `cursorId`.
export function panelInput(
  snapshot: StatsSnapshot | null,
  visible: { rows: VisibleRow[]; moreRows: number },
  sort: StatsSortColumn,
  cursorId: string | null,
): PanelInput {
  if (snapshot === null) {
    return {
      reading: true,
      error: null,
      meters: [],
      sort,
      rows: [],
      moreRows: 0,
    };
  }
  const note = snapshot.memoryNote === '' ? null : snapshot.memoryNote;
  return {
    reading: false,
    error: snapshot.error,
    meters: [
      meterInput('CPU', snapshot.cpu, null),
      meterInput('GPU', snapshot.gpu, null),
      meterInput('RAM', snapshot.ram, note),
      meterInput('Network', snapshot.network, null),
      meterInput('Disk', snapshot.disk, null),
    ],
    sort,
    rows: visible.rows.map(({ row, depth }, index): StatsRowInput => ({
      id: row.id,
      name: row.name,
      kind: row.kind,
      depth,
      isOpen: isOpenAt(visible.rows, index),
      cpu: formatPercent(row.cpuPercent),
      ram: formatRam(row.rssBytes),
      gpu: formatGpu(row.gpuPercent),
      isCursor: row.id === cursorId,
    })),
    moreRows: visible.moreRows,
  };
}

function meterInput(
  label: StatsMeterInput['label'],
  meter: StatsMeter,
  note: string | null,
): StatsMeterInput {
  return {
    label,
    percent: meter.percent,
    tone: meter.tone,
    history: meter.history,
    value: meter.label,
    note,
  };
}

// A top-level row followed by one of its own processes: an open group.
function isOpenAt(visible: readonly VisibleRow[], index: number): boolean {
  const entry = visible[index];
  return entry.depth === 0 && visible[index + 1]?.parentId === entry.row.id;
}

// Descending by the column, a null RAM or GPU after every number, then by name in code-unit order, then by id.
function byColumn(
  sort: StatsSortColumn,
): (a: StatsProcessRow, b: StatsProcessRow) => number {
  return (a, b) => {
    const first = columnValue(a, sort);
    const second = columnValue(b, sort);
    if (first !== second) {
      if (first === null) {
        return 1;
      }
      if (second === null) {
        return -1;
      }
      return second - first;
    }
    return compareText(a.name, b.name) || compareText(a.id, b.id);
  };
}

function columnValue(
  row: StatsProcessRow,
  sort: StatsSortColumn,
): number | null {
  switch (sort) {
    case 'cpu':
      return row.cpuPercent;
    case 'ram':
      return row.rssBytes;
    case 'gpu':
      return row.gpuPercent;
  }
}

function compareText(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}
