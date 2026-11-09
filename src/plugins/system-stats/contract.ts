import type { ChannelShape } from '../../contracts/plugin';
import type { SlotKey } from '../../contracts/state';

// The kit's MeterTone values: a plugin contract cannot import the kit, and the layout contract passes this to
// kit.meter.
export type StatsTone = 'normal' | 'warning' | 'critical';

export type StatsSortColumn = 'cpu' | 'ram' | 'gpu';

export interface StatsMeter {
  percent: number | null; // 0–100; null when unreadable
  tone: StatsTone;
  history: number[]; // last 60 s of percent, oldest first
  label: string; // the value text, e.g. '38%', '21.4 / 32 GB', '1.2 MB/s ↓ 80 KB/s ↑'
}

export interface StatsProcessRow {
  id: string; // stable across samples: 'app:<bundle or exe>', 'session:<sessionId>', 'pid:<pid>', 'other'
  name: string; // app name, 'claude · <session title>', process name, or the Other row's name
  kind: 'app' | 'session' | 'process' | 'other'; // 'other': the CPU no process row holds, never opened
  cpuPercent: number; // share of the whole machine
  rssBytes: number | null; // null on the Other row
  gpuPercent: number | null;
  children: StatsProcessRow[]; // the group's processes, [] for a lone process
}

export interface StatsSnapshot {
  takenAt: number; // epoch ms
  cpu: StatsMeter;
  gpu: StatsMeter;
  ram: StatsMeter;
  network: StatsMeter;
  disk: StatsMeter;
  memoryNote: string; // the line under RAM: pressure and swap used
  rows: StatsProcessRow[]; // every group and lone process, then the Other row, unsorted; the page sorts and cuts
  error: string | null; // the last sample()'s rejection message; null after a good sample
}

// The machine's readings while a page shows the panel; null before the first snapshot and from each show until its
// second sample.
export const systemStatsSnapshotSlot: SlotKey<
  StatsSnapshot | null,
  'main',
  'system-stats'
> = { id: 'system-stats.snapshot', process: 'main', kind: 'value' };

// The drive and self-test seed: `error` is `busy` with a sample error.
export type StatsFixtureVariant = 'busy' | 'error';

// `setShown` tells main the panel showed or hid; the last report wins, since a handler gets no page identity.
// `seeded` is sent after a seed writes the slot.
export interface SystemStatsChannel extends ChannelShape {
  invoke: { setShown(shown: boolean): void };
  messages: { seeded: StatsFixtureVariant };
}
