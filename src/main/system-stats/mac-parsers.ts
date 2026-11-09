import type {
  MemoryPressure,
  ProcessSample,
  SystemSample,
} from '../../contracts/system-stats';

// A process as `ps` reads it; GPU time comes from `ioreg`.
export type ProcessRow = Omit<ProcessSample, 'gpuTimeNs'>;

// `ps -o pid=,ppid=,time=,rss=,comm=`: `time` is `<minutes>:<seconds>.<hundredths>`
// (minutes past 60 included), `rss` is in KiB, `comm` runs to the line's end.
const PS_LINE = /^\s*(\d+)\s+(\d+)\s+(\d+):(\d+)[.,](\d+)\s+(\d+)\s+(.+)$/;

const VM_STAT_PAGE_SIZE = /\(page size of (\d+) bytes\)/;

const SWAP_UNIT_POWERS: Record<string, number> = { K: 1, M: 2, G: 3 };

// `kern.memorystatus_vm_pressure_level`'s values.
const PRESSURE_LEVELS: Record<string, MemoryPressure> = {
  '1': 'normal',
  '2': 'warning',
  '4': 'critical',
};

// Ethernet and Wi-Fi; loopback, VPN tunnels, bridges and Apple's private links
// would count the same bytes again.
const PHYSICAL_INTERFACE = /^en\d+$/;

const ACCUMULATED_GPU_TIME = /"accumulatedGPUTime"=(\d+)/g;
const BYTES_READ = /"Bytes \(Read\)"=(\d+)/g;
const BYTES_WRITTEN = /"Bytes \(Write\)"=(\d+)/g;

// One row per process line of `/bin/ps -axww -o pid=,ppid=,time=,rss=,comm=`;
// any other line is skipped.
export function parsePs(stdout: string): ProcessRow[] {
  const rows: ProcessRow[] = [];
  for (const line of stdout.split('\n')) {
    const match = PS_LINE.exec(line);
    if (match === null) {
      continue;
    }
    const [, pid, ppid, minutes, seconds, hundredths, rssKib, rest] = match;
    const comm = rest.trim();
    const hasPath = comm.startsWith('/');
    rows.push({
      pid: Number(pid),
      ppid: Number(ppid),
      name: hasPath ? comm.slice(comm.lastIndexOf('/') + 1) : comm,
      path: hasPath ? comm : '',
      cpuTimeMs:
        Number(minutes) * 60_000 +
        Number(seconds) * 1_000 +
        Number(hundredths) * 10,
      rssBytes: Number(rssKib) * 1024,
    });
  }
  return rows;
}

// Memory used as Activity Monitor counts it, from `vm_stat`: app memory
// (anonymous less purgeable), wired and compressed. Throws naming `vm_stat`
// when its page size or one of those lines is missing.
export function parseVmStatUsedBytes(stdout: string): number {
  const pageSize = VM_STAT_PAGE_SIZE.exec(stdout);
  if (pageSize === null) {
    throw new Error('vm_stat printed no page size');
  }
  const pages = (label: string) => vmStatPages(stdout, label);
  const usedPages =
    pages('Anonymous pages') -
    pages('Pages purgeable') +
    pages('Pages wired down') +
    pages('Pages occupied by compressor');
  return usedPages * Number(pageSize[1]);
}

// The total RAM, swap used and memory pressure from `sysctl hw.memsize
// vm.swapusage kern.memorystatus_vm_pressure_level`. No swap line reads as 0
// used; a pressure level it does not know, or none, as null. Throws naming
// `sysctl` when `hw.memsize` is missing.
export function parseSysctl(stdout: string): {
  totalBytes: number;
  swapUsedBytes: number;
  pressure: MemoryPressure | null;
} {
  const total = /^hw\.memsize:\s*(\d+)/m.exec(stdout);
  if (total === null) {
    throw new Error('sysctl printed no hw.memsize');
  }
  const swapUsed = /^vm\.swapusage:.*\bused = ([\d.]+)([KMG])/m.exec(stdout);
  const level = /^kern\.memorystatus_vm_pressure_level:\s*(\d+)/m.exec(stdout);
  return {
    totalBytes: Number(total[1]),
    swapUsedBytes:
      swapUsed === null
        ? 0
        : Math.round(
            Number(swapUsed[1]) * 1024 ** SWAP_UNIT_POWERS[swapUsed[2]],
          ),
    pressure:
      level !== null && Object.hasOwn(PRESSURE_LEVELS, level[1])
        ? PRESSURE_LEVELS[level[1]]
        : null,
  };
}

// The busiest GPU's `Device Utilization %` from `ioreg -c IOAccelerator`; null
// when no accelerator reports one.
export function parseDeviceUtilisation(stdout: string): number | null {
  let highest: number | null = null;
  for (const match of stdout.matchAll(/"Device Utilization %"=(\d+)/g)) {
    highest = Math.max(highest ?? 0, Number(match[1]));
  }
  return highest;
}

// Each pid's GPU time in ns from `ioreg -c AGXDeviceUserClient`: the sum of
// `accumulatedGPUTime` over every client the pid created. A client with no
// usage still lists its pid, with 0.
export function parseGpuTimes(stdout: string): Map<number, number> {
  const times = new Map<number, number>();
  for (const block of ioregBlocks(stdout)) {
    const creator = /"IOUserClientCreator" = "pid (\d+),/.exec(block);
    if (creator === null) {
      continue;
    }
    const pid = Number(creator[1]);
    times.set(pid, (times.get(pid) ?? 0) + sumOf(block, ACCUMULATED_GPU_TIME));
  }
  return times;
}

// The bytes received and sent over the physical interfaces in `netstat -ibn`,
// one `<Link#…>` row per interface.
export function parseNetstat(stdout: string): SystemSample['network'] {
  let receivedBytes = 0;
  let sentBytes = 0;
  for (const line of stdout.split('\n')) {
    const tokens = line.trim().split(/\s+/);
    const isLinkRow = tokens[2]?.startsWith('<Link#') ?? false;
    const isPhysical = PHYSICAL_INTERFACE.test(tokens[0].replace(/\*$/, ''));
    if (!isLinkRow || !isPhysical) {
      continue;
    }
    // The Address column is empty on some rows, so the byte columns are
    // counted from the line's end.
    receivedBytes += Number(tokens[tokens.length - 5]);
    sentBytes += Number(tokens[tokens.length - 2]);
  }
  return { receivedBytes, sentBytes };
}

// The bytes read and written over every driver in `ioreg -c
// IOBlockStorageDriver`; no driver at all reads as 0 and 0. Throws naming
// `ioreg` when a driver has no `Statistics`.
export function parseBlockStorage(stdout: string): SystemSample['disk'] {
  for (const block of ioregBlocks(stdout)) {
    if (!block.includes('"Statistics"')) {
      throw new Error(
        'ioreg printed an IOBlockStorageDriver with no Statistics',
      );
    }
  }
  return {
    readBytes: sumOf(stdout, BYTES_READ),
    writtenBytes: sumOf(stdout, BYTES_WRITTEN),
  };
}

// The count `vm_stat` prints on its `<label>:` line.
function vmStatPages(stdout: string, label: string): number {
  const line = new RegExp(`^${label}:\\s+(\\d+)\\.?\\s*$`, 'm').exec(stdout);
  if (line === null) {
    throw new Error(`vm_stat printed no "${label}" line`);
  }
  return Number(line[1]);
}

// `ioreg -r` output split into one text per object, each opening at its
// `+-o ` line; text before the first object is dropped.
function ioregBlocks(stdout: string): string[] {
  const blocks: string[] = [];
  for (const line of stdout.split('\n')) {
    if (line.trimStart().startsWith('+-o ')) {
      blocks.push(line);
    } else if (blocks.length > 0) {
      blocks[blocks.length - 1] += `\n${line}`;
    }
  }
  return blocks;
}

// The sum of every number the global `pattern` captures in `text`.
function sumOf(text: string, pattern: RegExp): number {
  let sum = 0;
  for (const match of text.matchAll(pattern)) {
    sum += Number(match[1]);
  }
  return sum;
}
