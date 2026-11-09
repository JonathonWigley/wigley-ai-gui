import type {
  MemoryPressure,
  ProcessSample,
  SystemSample,
} from '../../../contracts/system-stats';
import { percentTone } from '../../../shared/percent-tone';
import type { StatsMeter, StatsSnapshot, StatsTone } from '../contract';
import { groupProcesses, otherRow } from './grouping';

export const MIN_REFRESH_SECONDS = 1;
export const DEFAULT_REFRESH_SECONDS = 2;
export const HISTORY_SECONDS = 60;
export const RATE_SCALE_LOW_BYTES = 1_000; // 1 KB/s: 0% on the network and disk meters' logarithmic scale
export const RATE_SCALE_HIGH_BYTES = 1_000_000_000; // 1 GB/s: 100% on that scale
export const RATE_CEILING_BYTES = 10_000_000_000; // 10 GB/s: a tick above it is a device appearing, read as 0

const GIB = 2 ** 30;
const NO_READING = '—';

// A Chat session's agent process, titled for its group row.
export interface SessionProcess {
  sessionId: string;
  pid: number;
  title: string;
}

// One process's use over the time between two samples, each percent a share of the whole machine.
export interface ProcessRate {
  pid: number;
  ppid: number;
  name: string;
  path: string;
  cpuPercent: number;
  rssBytes: number;
  gpuPercent: number | null;
}

// Raw history, oldest first; `networkRate` and `diskRate` in bytes per second.
export interface StatsHistory {
  capacity: number;
  cpu: number[];
  gpu: number[];
  ram: number[];
  networkRate: number[];
  diskRate: number[];
}

// The refresh the setting asks for, at least `MIN_REFRESH_SECONDS`; a non-finite value (a hand-edited setting)
// reads as the default.
export function refreshSecondsOf(setting: number): number {
  return Number.isFinite(setting)
    ? Math.max(setting, MIN_REFRESH_SECONDS)
    : DEFAULT_REFRESH_SECONDS;
}

// How many readings span `HISTORY_SECONDS` at this refresh, at least 2.
export function historyCapacity(refreshSeconds: number): number {
  return Math.max(
    2,
    Math.round(HISTORY_SECONDS / refreshSecondsOf(refreshSeconds)),
  );
}

export function emptyHistory(capacity: number): StatsHistory {
  return { capacity, cpu: [], gpu: [], ram: [], networkRate: [], diskRate: [] };
}

// The tone of the whole percent a label shows; `normal` with no reading.
export function toneOf(percent: number | null): StatsTone {
  return percent === null ? 'normal' : percentTone(percent);
}

// The memory pressure's tone where the OS reports one, since a healthy Mac counts compressed and wired memory as
// used; else the percent's.
export function ramToneOf(
  percent: number | null,
  pressure: MemoryPressure | null,
): StatsTone {
  return pressure ?? toneOf(percent);
}

const RATE_UNITS = [
  { unit: 'GB/s', size: 1e9 },
  { unit: 'MB/s', size: 1e6 },
  { unit: 'KB/s', size: 1e3 },
] as const;

export function formatRate(bytesPerSecond: number): string {
  const unit = RATE_UNITS.find(({ size }) => bytesPerSecond >= size);
  if (unit === undefined) {
    return `${Math.round(bytesPerSecond)} B/s`;
  }
  const value = bytesPerSecond / unit.size;
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${unit.unit}`;
}

// Each of `next`'s processes with its CPU and GPU share over `elapsedMs`. `prev` lists every process, so a pid with no
// entry there, or whose CPU time went down (the pid reused), started since and grows from zero counters. A GPU counter
// that went down reads 0.
export function processRates(
  prev: readonly ProcessSample[],
  next: readonly ProcessSample[],
  elapsedMs: number,
  cores: number,
): ProcessRate[] {
  const prevByPid = new Map(prev.map((process) => [process.pid, process]));
  return next.map((process) => {
    const before = prevByPid.get(process.pid);
    const isNew = before === undefined || process.cpuTimeMs < before.cpuTimeMs;
    const start = isNew ? startedSincePrev(process) : before;
    const cpuMs = growth(start.cpuTimeMs, process.cpuTimeMs);
    return {
      pid: process.pid,
      ppid: process.ppid,
      name: process.name,
      path: process.path,
      cpuPercent: clampPercent((cpuMs / (elapsedMs * cores)) * 100),
      rssBytes: process.rssBytes,
      gpuPercent: gpuShare(start, process, elapsedMs),
    };
  });
}

// The snapshot of the time between `prev` and `next`, and `history` with this reading appended.
export function buildSnapshot(
  prev: SystemSample,
  next: SystemSample,
  elapsedMs: number,
  sessions: readonly SessionProcess[],
  history: StatsHistory,
  takenAt: number,
): { snapshot: StatsSnapshot; history: StatsHistory } {
  const seconds = elapsedMs / 1000;
  const cpuTotalMs = next.cpuTotalMs - prev.cpuTotalMs;
  const cpu =
    cpuTotalMs > 0
      ? clampPercent(((next.cpuBusyMs - prev.cpuBusyMs) / cpuTotalMs) * 100)
      : 0;
  const gpu = next.gpuPercent === null ? null : clampPercent(next.gpuPercent);
  const { memory } = next;
  const ram = clampPercent((memory.usedBytes / memory.totalBytes) * 100);
  const received = growth(
    prev.network.receivedBytes,
    next.network.receivedBytes,
  );
  const sent = growth(prev.network.sentBytes, next.network.sentBytes);
  const read = growth(prev.disk.readBytes, next.disk.readBytes);
  const written = growth(prev.disk.writtenBytes, next.disk.writtenBytes);
  const networkRate = belowCeiling((received + sent) / seconds);
  const diskRate = belowCeiling((read + written) / seconds);
  const nextHistory: StatsHistory = {
    capacity: history.capacity,
    cpu: appended(history.cpu, cpu, history.capacity),
    gpu:
      gpu === null ? history.gpu : appended(history.gpu, gpu, history.capacity),
    ram: appended(history.ram, ram, history.capacity),
    networkRate: appended(history.networkRate, networkRate, history.capacity),
    diskRate: appended(history.diskRate, diskRate, history.capacity),
  };
  const rows = groupProcesses(
    processRates(prev.processes, next.processes, elapsedMs, next.cores),
    sessions,
  );
  const snapshot: StatsSnapshot = {
    takenAt,
    cpu: percentMeter(cpu, toneOf(cpu), nextHistory.cpu),
    gpu: percentMeter(gpu, toneOf(gpu), nextHistory.gpu),
    ram: {
      percent: ram,
      tone: ramToneOf(ram, memory.pressure),
      history: nextHistory.ram,
      label: `${(memory.usedBytes / GIB).toFixed(1)} / ${Math.round(memory.totalBytes / GIB)} GB`,
    },
    network: rateMeter(
      networkRate,
      nextHistory.networkRate,
      `${formatRate(received / seconds)} ↓ ${formatRate(sent / seconds)} ↑`,
    ),
    disk: rateMeter(
      diskRate,
      nextHistory.diskRate,
      `${formatRate(read / seconds)} r ${formatRate(written / seconds)} w`,
    ),
    memoryNote: memoryNoteOf(memory.pressure, memory.swapUsedBytes),
    rows: [...rows, otherRow(cpu, rows)],
    error: null,
  };
  return { snapshot, history: nextHistory };
}

// `last` with `error` set, or empty meters and rows when there is no last snapshot.
export function errorSnapshot(
  last: StatsSnapshot | null,
  takenAt: number,
  error: string,
): StatsSnapshot {
  if (last !== null) {
    return { ...last, takenAt, error };
  }
  const empty = (): StatsMeter => ({
    percent: null,
    tone: 'normal',
    history: [],
    label: NO_READING,
  });
  return {
    takenAt,
    cpu: empty(),
    gpu: empty(),
    ram: empty(),
    network: empty(),
    disk: empty(),
    memoryNote: '',
    rows: [],
    error,
  };
}

function memoryNoteOf(
  pressure: MemoryPressure | null,
  swapUsedBytes: number,
): string {
  const swap = `swap ${(swapUsedBytes / GIB).toFixed(1)} GB`;
  return pressure === null ? swap : `pressure ${pressure} · ${swap}`;
}

function percentMeter(
  percent: number | null,
  tone: StatsTone,
  history: number[],
): StatsMeter {
  return {
    percent,
    tone,
    history,
    label: percent === null ? NO_READING : `${Math.round(percent)}%`,
  };
}

function rateMeter(rate: number, ring: number[], label: string): StatsMeter {
  return {
    percent: ratePercent(rate),
    tone: 'normal',
    history: ring.map(ratePercent),
    label,
  };
}

// The rate on a logarithmic scale from `RATE_SCALE_LOW_BYTES` at 0% to `RATE_SCALE_HIGH_BYTES` at 100%.
function ratePercent(rate: number): number {
  if (rate <= RATE_SCALE_LOW_BYTES) {
    return 0;
  }
  const decades = Math.log10(rate / RATE_SCALE_LOW_BYTES);
  const scaleDecades = Math.log10(RATE_SCALE_HIGH_BYTES / RATE_SCALE_LOW_BYTES);
  return clampPercent((decades / scaleDecades) * 100);
}

// The process as it stood when it started: every counter at zero.
function startedSincePrev(process: ProcessSample): ProcessSample {
  return { ...process, cpuTimeMs: 0, gpuTimeNs: 0 };
}

// The GPU share since `start`; 0 when `start` has no GPU reading.
function gpuShare(
  start: ProcessSample,
  process: ProcessSample,
  elapsedMs: number,
): number | null {
  if (process.gpuTimeNs === null) {
    return null;
  }
  const gpuNs = growth(start.gpuTimeNs ?? undefined, process.gpuTimeNs);
  return clampPercent((gpuNs / (elapsedMs * 1_000_000)) * 100);
}

// How much a cumulative counter grew; 0 with no earlier reading or when it went down.
function growth(before: number | undefined, after: number): number {
  return before === undefined ? 0 : Math.max(after - before, 0);
}

// A rate above `RATE_CEILING_BYTES` is a device's lifetime bytes arriving in one tick.
function belowCeiling(rate: number): number {
  return Number.isFinite(rate) && rate <= RATE_CEILING_BYTES ? rate : 0;
}

function clampPercent(percent: number): number {
  return Number.isFinite(percent) ? Math.min(Math.max(percent, 0), 100) : 0;
}

function appended(ring: number[], value: number, capacity: number): number[] {
  return [...ring, value].slice(-capacity);
}
