import type { ProcessSample, SystemSample } from '../../contracts/system-stats';

// Windows PowerShell 5.1's ConvertTo-Json writes a one-item array as the bare item.
type OneOrMany<T> = T | T[];

// The JSON document `WINDOWS_SAMPLE_SCRIPT` prints. CPU and GPU times are in
// 100 ns units; network and disk are cumulative byte counts.
interface WindowsDocument {
  processes: OneOrMany<{
    pid: number;
    ppid: number;
    name: string;
    path: string | null;
    cpu100ns: number;
    rss: number;
  }>;
  memory: { totalKb: number; availableBytes: number; swapUsedMb: number };
  gpu: null | {
    utilization: OneOrMany<{ name: string; percent: number }>;
    engines: OneOrMany<{ name: string; runningTime: number }>;
  };
  network: { received: number; sent: number };
  disk: { read: number; written: number };
}

const REQUIRED_KEYS = ['processes', 'memory', 'network', 'disk'] as const;

// A GPU engine instance's name: `pid_<pid>_luid_0x…_0x…_phys_<n>_eng_<n>_engtype_3D`.
const ENGINE_PID = /^pid_(\d+)_/;
const ENGINE_ADAPTER = /_(luid_0x[0-9a-f]+_0x[0-9a-f]+_phys_\d+)_/i;

// System Idle Process: its CPU time is the machine's idle time.
const IDLE_PID = 0;

// One reading of the machine from `WINDOWS_SAMPLE_SCRIPT`'s stdout, every
// field but the CPU totals; throws naming `powershell.exe` when the stdout is
// not the script's document.
export function parseWindowsReading(
  stdout: string,
): Omit<SystemSample, 'cores' | 'cpuBusyMs' | 'cpuTotalMs'> {
  const document = parseDocument(stdout);
  const gpuTimes =
    document.gpu === null ? null : gpuTimesByPid(asArray(document.gpu.engines));
  return {
    memory: {
      totalBytes: document.memory.totalKb * 1024,
      usedBytes:
        document.memory.totalKb * 1024 - document.memory.availableBytes,
      swapUsedBytes: document.memory.swapUsedMb * 1048576,
      pressure: null,
    },
    gpuPercent:
      document.gpu === null
        ? null
        : busiestAdapterPercent(asArray(document.gpu.utilization)),
    network: {
      receivedBytes: document.network.received,
      sentBytes: document.network.sent,
    },
    disk: {
      readBytes: document.disk.read,
      writtenBytes: document.disk.written,
    },
    processes: asArray(document.processes)
      .filter((process) => process.pid !== IDLE_PID)
      .map((process): ProcessSample => ({
        pid: process.pid,
        ppid: process.ppid,
        name: process.name,
        path: process.path ?? '',
        cpuTimeMs: Math.round(process.cpu100ns / 10000),
        rssBytes: process.rss,
        gpuTimeNs: gpuTimes === null ? null : (gpuTimes.get(process.pid) ?? 0),
      })),
  };
}

function parseDocument(stdout: string): WindowsDocument {
  let document: unknown;
  try {
    document = JSON.parse(stdout);
  } catch {
    throw new Error(
      `powershell.exe printed no JSON: ${stdout.trim().slice(0, 200)}`,
    );
  }
  const fields: object =
    typeof document === 'object' && document !== null ? document : {};
  const missing = REQUIRED_KEYS.filter((key) => !(key in fields));
  if (missing.length > 0) {
    throw new Error(`powershell.exe printed no ${missing.join(', ')}`);
  }
  return document as WindowsDocument;
}

function asArray<T>(value: OneOrMany<T>): T[] {
  return Array.isArray(value) ? value : [value];
}

// Each pid's summed 3D engine running time, in ns.
function gpuTimesByPid(
  engines: { name: string; runningTime: number }[],
): Map<number, number> {
  const times = new Map<number, number>();
  for (const engine of engines) {
    const match = ENGINE_PID.exec(engine.name);
    if (match === null) {
      continue;
    }
    const pid = Number(match[1]);
    times.set(pid, (times.get(pid) ?? 0) + engine.runningTime * 100);
  }
  return times;
}

// The busiest adapter's summed 3D engine utilization, capped at 100; 0 with
// no entries.
function busiestAdapterPercent(
  utilization: { name: string; percent: number }[],
): number {
  const percents = new Map<string, number>();
  for (const entry of utilization) {
    const match = ENGINE_ADAPTER.exec(entry.name);
    if (match === null) {
      continue;
    }
    const adapter = match[1].toLowerCase();
    percents.set(adapter, (percents.get(adapter) ?? 0) + entry.percent);
  }
  return Math.min(100, Math.max(0, ...percents.values()));
}
