import type {
  MemoryPressure,
  ProcessSample,
  SystemSample,
} from '../../../contracts/system-stats';
import type { StatsMeter, StatsSnapshot, StatsTone } from '../contract';
import { groupProcesses } from './grouping';

export const MIN_REFRESH_SECONDS = 1;
export const DEFAULT_REFRESH_SECONDS = 2;
export const HISTORY_SECONDS = 60;
export const RATE_FLOOR_BYTES = 1_000_000; // 1 MB/s: the least full scale of the network and disk meters
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

export function toneOf(percent: number | null): StatsTone {
  if (percent === null || percent < 70) {
    return 'normal';
  }
  return percent < 90 ? 'warning' : 'critical';
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

// Each of `next`'s processes with its CPU and GPU share over `elapsedMs`. A process with no entry in `prev` of the
// same pid and name, or whose counter went down, reads 0.
export function processRates(
  prev: readonly ProcessSample[],
  next: readonly ProcessSample[],
  elapsedMs: number,
  cores: number,
): ProcessRate[] {
  const prevByPid = new Map(prev.map((process) => [process.pid, process]));
  return next.map((process) => {
    const before = prevByPid.get(process.pid);
    const match = before?.name === process.name ? before : undefined;
    const cpuMs = growth(match?.cpuTimeMs, process.cpuTimeMs);
    return {
      pid: process.pid,
      ppid: process.ppid,
      name: process.name,
      path: process.path,
      cpuPercent: clampPercent((cpuMs / (elapsedMs * cores)) * 100),
      rssBytes: process.rssBytes,
      gpuPercent: gpuShare(match, process, elapsedMs),
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
    rows: groupProcesses(
      processRates(prev.processes, next.processes, elapsedMs, next.cores),
      sessions,
    ),
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

// The rate against the highest rate in the ring, with `RATE_FLOOR_BYTES` the least full scale; the ring is
// rescaled each time, so the line keeps its shape when the scale moves.
function rateMeter(rate: number, ring: number[], label: string): StatsMeter {
  const fullScale = Math.max(...ring, RATE_FLOOR_BYTES);
  return {
    percent: clampPercent((rate / fullScale) * 100),
    tone: 'normal',
    history: ring.map((each) => clampPercent((each / fullScale) * 100)),
    label,
  };
}

function gpuShare(
  match: ProcessSample | undefined,
  process: ProcessSample,
  elapsedMs: number,
): number | null {
  if (process.gpuTimeNs === null) {
    return null;
  }
  const gpuNs = growth(match?.gpuTimeNs ?? undefined, process.gpuTimeNs);
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
