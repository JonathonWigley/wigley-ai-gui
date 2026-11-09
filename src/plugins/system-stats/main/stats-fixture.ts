import type {
  StatsFixtureVariant,
  StatsMeter,
  StatsProcessRow,
  StatsSnapshot,
  StatsTone,
} from '../contract';

export const STATS_FIXTURE_VARIANTS: readonly StatsFixtureVariant[] = [
  'busy',
  'error',
];

const MIB = 1_048_576;
const HISTORY_LENGTH = 30;

// The fixed snapshot a seed writes, taken at `now`: a busy machine whose rows' CPU adds up to the CPU meter, and for
// `error`, the same with a sample error.
export function statsFixture(
  variant: StatsFixtureVariant,
  now: number,
): StatsSnapshot {
  return {
    takenAt: now,
    cpu: meter(44, 'normal', '44%'),
    gpu: meter(74, 'warning', '74%'),
    ram: meter(67, 'normal', '21.4 / 32 GB'),
    network: meter(40, 'normal', '1.2 MB/s ↓ 80 KB/s ↑'),
    disk: meter(15, 'normal', '3.4 MB/s r 1.0 MB/s w'),
    memoryNote: 'pressure normal · swap 1.2 GB',
    rows: [
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
        ...processRow(0, 'claude · fix login', 9, 700, null),
        id: 'session:selftest-session',
        kind: 'session',
        children: [
          processRow(610, 'claude', 6, 500, null),
          processRow(611, 'zsh', 3, 200, null),
        ],
      },
      processRow(120, 'WindowServer', 12, 300, 31),
      processRow(300, 'Finder', 0.5, 2600, 0),
    ],
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
