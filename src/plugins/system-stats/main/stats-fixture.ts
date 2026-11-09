import type {
  StatsFixtureVariant,
  StatsMeter,
  StatsProcessRow,
  StatsSnapshot,
  StatsTone,
} from '../contract';
import { otherRow } from './grouping';

export const STATS_FIXTURE_VARIANTS: readonly StatsFixtureVariant[] = [
  'busy',
  'error',
];

const MIB = 1_048_576;
const HISTORY_LENGTH = 30;
const CPU_PERCENT = 48;

// The fixed snapshot a seed writes, taken at `now`: a busy machine with a Chat session and a terminal `claude` in the
// Claude group, whose Other row holds the CPU its process rows don't, and for `error`, the same with a sample error.
export function statsFixture(
  variant: StatsFixtureVariant,
  now: number,
): StatsSnapshot {
  const rows: StatsProcessRow[] = [
    {
      ...processRow(0, 'Google Chrome', 22.5, 1800, 6),
      id: 'app:Google Chrome.app',
      kind: 'app',
      children: [
        processRow(501, 'Google Chrome', 4.0, 600, 1),
        processRow(502, 'Google Chrome Helper (Renderer)', 18.5, 1200, 5),
      ],
    },
    {
      ...processRow(0, 'Claude Code', 9, 700, null),
      id: 'app:claude',
      kind: 'app',
      children: [
        {
          ...processRow(0, 'claude · fix login', 6, 500, null),
          id: 'session:selftest-session',
        },
        processRow(700, 'claude', 3, 200, null),
      ],
    },
    processRow(120, 'WindowServer', 12, 300, 31),
    processRow(300, 'Finder', 0.5, 2600, 0),
  ];
  return {
    takenAt: now,
    cpu: meter(CPU_PERCENT, 'normal', `${CPU_PERCENT}%`),
    gpu: meter(74, 'warning', '74%'),
    ram: meter(67, 'normal', '21.4 / 32 GB'),
    network: meter(52, 'normal', '1.2 MB/s ↓ 80 KB/s ↑'),
    disk: meter(61, 'normal', '3.4 MB/s r 1.0 MB/s w'),
    memoryNote: 'pressure normal · swap 1.2 GB',
    rows: [...rows, otherRow(CPU_PERCENT, rows)],
    error: variant === 'error' ? 'ps exited with code 1' : null,
  };
}

// A meter whose history rises evenly from 0 to `percent`.
function meter(percent: number, tone: StatsTone, label: string): StatsMeter {
  return {
    percent,
    tone,
    history: Array.from(
      { length: HISTORY_LENGTH },
      (_, index) => (percent * index) / (HISTORY_LENGTH - 1),
    ),
    label,
  };
}

function processRow(
  pid: number,
  name: string,
  cpuPercent: number,
  ramMib: number,
  gpuPercent: number | null,
): StatsProcessRow {
  return {
    id: `pid:${pid}`,
    name,
    kind: 'process',
    cpuPercent,
    rssBytes: ramMib * MIB,
    gpuPercent,
    children: [],
  };
}
