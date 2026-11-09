import { describe, expect, it } from 'vitest';
import type {
  StatsMeter,
  StatsProcessRow,
  StatsSnapshot,
  StatsSortColumn,
} from '../contract';
import {
  type CursorMove,
  closeTarget,
  formatBytes,
  formatGpu,
  formatPercent,
  movedCursor,
  panelInput,
  visibleRows,
} from './stats-view-model';

const MIB = 2 ** 20;

function proc(
  id: string,
  cpuPercent: number,
  ramMib: number,
  gpuPercent: number | null,
  children: StatsProcessRow[] = [],
): StatsProcessRow {
  return {
    id,
    name: id,
    kind: children.length === 0 ? 'process' : 'app',
    cpuPercent,
    rssBytes: ramMib * MIB,
    gpuPercent,
    children,
  };
}

function meter(percent: number, label: string): StatsMeter {
  return { percent, tone: 'normal', history: [1, percent], label };
}

function snapshot(changes: Partial<StatsSnapshot> = {}): StatsSnapshot {
  return {
    takenAt: 0,
    cpu: meter(41, '41%'),
    gpu: meter(12, '12%'),
    ram: meter(63, '20.1 / 32 GB'),
    network: meter(7, '70 KB/s ↓ 3 KB/s ↑'),
    disk: meter(3, '30 KB/s r 0 B/s w'),
    memoryNote: 'pressure normal · swap 0 B',
    rows: [],
    error: null,
    ...changes,
  };
}

// Five top-level rows, no two equal in a column: by CPU e d c b a, by RAM a b c d e, by GPU c e a d, then b's null.
const ROWS = [
  proc('a', 1.5, 900, 7),
  proc('b', 3.25, 700, null),
  proc('c', 5, 500, 33),
  proc('d', 8.75, 300, 2),
  proc('e', 13, 100, 18),
];
const GROUP = proc('g', 30, 1200, 4, [
  proc('g1', 4, 800, 1),
  proc('g2', 26, 400, 3),
]);

// A Chat session's group: by CPU it sorts below every row in ROWS; s1 sorts above them all.
function session(
  id: string,
  cpuPercent: number,
  ramMib: number,
  children: StatsProcessRow[],
): StatsProcessRow {
  return { ...proc(id, cpuPercent, ramMib, null, children), kind: 'session' };
}
const IDLE_SESSION = session('s0', 0, 315, [proc('s0a', 0, 315, null)]);
const BUSY_SESSION = session('s1', 40, 600, [proc('s1a', 40, 600, null)]);

const names = (shown: { rows: { row: StatsProcessRow; depth: number }[] }) =>
  shown.rows.map(({ row, depth }) => `${depth}:${row.name}`);

describe('visibleRows', () => {
  it.each<{
    name: string;
    rows: StatsProcessRow[];
    sort: StatsSortColumn;
    openIds: string[];
    processRows: number;
    shown: string[];
    moreRows: number;
  }>([
    {
      name: 'CPU sort cut to 3 of 5',
      rows: ROWS,
      sort: 'cpu',
      openIds: [],
      processRows: 3,
      shown: ['0:e', '0:d', '0:c'],
      moreRows: 2,
    },
    {
      name: 'RAM sort',
      rows: ROWS,
      sort: 'ram',
      openIds: [],
      processRows: 10,
      shown: ['0:a', '0:b', '0:c', '0:d', '0:e'],
      moreRows: 0,
    },
    {
      name: 'GPU sort, a null GPU last',
      rows: ROWS,
      sort: 'gpu',
      openIds: [],
      processRows: 10,
      shown: ['0:c', '0:e', '0:a', '0:d', '0:b'],
      moreRows: 0,
    },
    {
      name: 'a CPU tie ordered by name',
      rows: [proc('n', 2, 100, 1), proc('m', 2, 200, 3), proc('o', 9, 50, 2)],
      sort: 'cpu',
      openIds: [],
      processRows: 10,
      shown: ['0:o', '0:m', '0:n'],
      moreRows: 0,
    },
    {
      name: 'an open group in the cut, its children sorted by the column',
      rows: [...ROWS, GROUP],
      sort: 'ram',
      openIds: ['g'],
      processRows: 2,
      shown: ['0:g', '1:g1', '1:g2', '0:a'],
      moreRows: 4,
    },
    {
      name: 'an open group cut off',
      rows: [...ROWS, proc('h', 0.5, 50, 0, [proc('h1', 0.5, 50, 0)])],
      sort: 'cpu',
      openIds: ['h'],
      processRows: 2,
      shown: ['0:e', '0:d'],
      moreRows: 4,
    },
    {
      name: 'processRows 0 shows one',
      rows: ROWS,
      sort: 'cpu',
      openIds: [],
      processRows: 0,
      shown: ['0:e'],
      moreRows: 4,
    },
    {
      name: 'a session past the cut still shown, in its sort position',
      rows: [IDLE_SESSION, ...ROWS],
      sort: 'cpu',
      openIds: [],
      processRows: 3,
      shown: ['0:e', '0:d', '0:c', '0:s0'],
      moreRows: 2,
    },
    {
      name: 'sessions take no place from the other rows, an open one shows its processes',
      rows: [...ROWS, IDLE_SESSION, BUSY_SESSION],
      sort: 'cpu',
      openIds: ['s0'],
      processRows: 2,
      shown: ['0:s1', '0:e', '0:d', '0:s0', '1:s0a'],
      moreRows: 3,
    },
  ])('visibleRows_SortCutAndOpen: $name', (row) => {
    const shown = visibleRows(
      row.rows,
      row.sort,
      new Set(row.openIds),
      row.processRows,
    );

    expect({ shown: names(shown), moreRows: shown.moreRows }).toEqual({
      shown: row.shown,
      moreRows: row.moreRows,
    });
  });
});

describe('panelInput', () => {
  it('panelInput_MapsSnapshotToRows: null snapshot is reading', () => {
    const input = panelInput(null, { rows: [], moreRows: 0 }, 'gpu', null);

    expect(input).toEqual({
      reading: true,
      error: null,
      meters: [],
      sort: 'gpu',
      rows: [],
      moreRows: 0,
    });
  });

  it('panelInput_MapsSnapshotToRows: an error snapshot with no rows', () => {
    const input = panelInput(
      snapshot({ error: 'ps exited with code 1' }),
      { rows: [], moreRows: 0 },
      'cpu',
      null,
    );

    expect({ error: input.error, rows: input.rows }).toEqual({
      error: 'ps exited with code 1',
      rows: [],
    });
  });

  it('panelInput_MapsSnapshotToRows: meters in order, RAM note null when empty', () => {
    const input = panelInput(
      snapshot({ memoryNote: '' }),
      { rows: [], moreRows: 0 },
      'cpu',
      null,
    );

    expect(
      input.meters.map(({ label, value, note }) => ({ label, value, note })),
    ).toEqual([
      { label: 'CPU', value: '41%', note: null },
      { label: 'GPU', value: '12%', note: null },
      { label: 'RAM', value: '20.1 / 32 GB', note: null },
      { label: 'Network', value: '70 KB/s ↓ 3 KB/s ↑', note: null },
      { label: 'Disk', value: '30 KB/s r 0 B/s w', note: null },
    ]);
  });

  it('panelInput_MapsSnapshotToRows: RAM carries the memory note', () => {
    const input = panelInput(
      snapshot(),
      { rows: [], moreRows: 0 },
      'cpu',
      null,
    );

    expect(input.meters.map(({ note }) => note)).toEqual([
      null,
      null,
      'pressure normal · swap 0 B',
      null,
      null,
    ]);
  });

  it('panelInput_MapsSnapshotToRows: an open group, the cursor on its child, a cut list', () => {
    const rows = [...ROWS, GROUP];
    const visible = visibleRows(rows, 'cpu', new Set(['g']), 2);

    const input = panelInput(snapshot({ rows }), visible, 'cpu', 'g2');

    expect({ rows: input.rows, moreRows: input.moreRows }).toEqual({
      rows: [
        {
          id: 'g',
          name: 'g',
          kind: 'app',
          depth: 0,
          isOpen: true,
          cpu: '30.0%',
          ram: '1.2 GB',
          gpu: '4.0%',
          isCursor: false,
        },
        {
          id: 'g2',
          name: 'g2',
          kind: 'process',
          depth: 1,
          isOpen: false,
          cpu: '26.0%',
          ram: '400 MB',
          gpu: '3.0%',
          isCursor: true,
        },
        {
          id: 'g1',
          name: 'g1',
          kind: 'process',
          depth: 1,
          isOpen: false,
          cpu: '4.0%',
          ram: '800 MB',
          gpu: '1.0%',
          isCursor: false,
        },
        {
          id: 'e',
          name: 'e',
          kind: 'process',
          depth: 0,
          isOpen: false,
          cpu: '13.0%',
          ram: '100 MB',
          gpu: '18.0%',
          isCursor: false,
        },
      ],
      moreRows: 4,
    });
  });
});

describe('movedCursor', () => {
  it.each<[number, number, CursorMove, number]>([
    [2, 5, 'down', 3],
    [4, 5, 'down', 4],
    [0, 5, 'up', 0],
    [3, 5, 'top', 0],
    [1, 5, 'bottom', 4],
    [-1, 5, 'down', 1],
  ])(
    'movedCursor_ClampsAtEnds: (%i, %i, %s) -> %i',
    (index, count, move, moved) => {
      expect(movedCursor(index, count, move)).toBe(moved);
    },
  );
});

describe('closeTarget', () => {
  const visible = visibleRows(
    [
      GROUP,
      proc('k', 2, 50, 1, [proc('k1', 1, 20, 0), proc('k2', 1.5, 30, 1)]),
      proc('p', 1, 10, 0),
    ],
    'cpu',
    new Set(['g']),
    10,
  ).rows;

  it.each([
    { name: 'an open group', cursorId: 'g', target: 'g' },
    { name: "an open group's child", cursorId: 'g1', target: 'g' },
    { name: 'a closed group', cursorId: 'k', target: null },
    { name: 'a lone process', cursorId: 'p', target: null },
  ])('closeTarget_OwnGroupOrParent: $name', ({ cursorId, target }) => {
    expect(closeTarget(visible, cursorId)).toBe(target);
  });
});

describe('formats', () => {
  it.each<[string, string, string]>([
    ['formatPercent 22.5', formatPercent(22.5), '22.5%'],
    ['formatPercent 0.04', formatPercent(0.04), '0.0%'],
    ['formatBytes 1023 MiB', formatBytes(1_072_693_248), '1023 MB'],
    ['formatBytes just under 1 GiB', formatBytes(1_073_700_000), '1024 MB'],
    ['formatBytes 1 GiB', formatBytes(1_073_741_824), '1.0 GB'],
    ['formatBytes 2.54 GiB', formatBytes(2_726_297_600), '2.5 GB'],
    ['formatGpu null', formatGpu(null), '—'],
    ['formatGpu 31', formatGpu(31), '31.0%'],
  ])('formats_Cells: %s', (_name, formatted, expected) => {
    expect(formatted).toBe(expected);
  });
});
