import type { ProcessRunner } from '../../contracts/processes';
import type { SystemSample, SystemStats } from '../../contracts/system-stats';
import { type CpuTimes, cpuTotals } from './cpu-totals';
import {
  parseBlockStorage,
  parseDeviceUtilisation,
  parseGpuTimes,
  parseNetstat,
  type ProcessRow,
  parsePs,
  parseSysctl,
  parseVmStatUsedBytes,
} from './mac-parsers';
import { requiredStdout } from '../processes/required-stdout';

const RUN_TIMEOUT_MS = 5000;

const PS = '/bin/ps';
const PS_ARGS = ['-axww', '-o', 'pid=,ppid=,time=,rss=,comm='];
const VM_STAT = '/usr/bin/vm_stat';
const SYSCTL = '/usr/sbin/sysctl';
const SYSCTL_ARGS = [
  'hw.memsize',
  'vm.swapusage',
  'kern.memorystatus_vm_pressure_level',
];
const NETSTAT = '/usr/sbin/netstat';
const NETSTAT_ARGS = ['-ibn'];
const IOREG = '/usr/sbin/ioreg';
const IOREG_ACCELERATORS = ['-r', '-d', '1', '-w', '0', '-c', 'IOAccelerator'];
const IOREG_GPU_CLIENTS = [
  '-r',
  '-d',
  '1',
  '-w',
  '0',
  '-c',
  'AGXDeviceUserClient',
];
// `-d 1` keeps each driver's own statistics: `-l` would add the nested APFS
// containers', which count the same bytes again.
const IOREG_BLOCK_STORAGE = [
  '-r',
  '-d',
  '1',
  '-w',
  '0',
  '-c',
  'IOBlockStorageDriver',
];

// The macOS SystemStats: every reading from the OS's own commands, run at once
// through `processes`, and the CPU totals from `cpus`, read as `ps` returns.
// A required command that cannot run, times out or exits non-zero rejects the
// sample naming it and its first stderr line; the GPU readings are null instead.
export function createMacSystemStats(
  processes: ProcessRunner,
  cpus: () => readonly CpuTimes[],
): SystemStats {
  return {
    async sample(): Promise<SystemSample> {
      const [
        ps,
        vmStat,
        sysctl,
        accelerators,
        gpuClients,
        netstat,
        blockStorage,
      ] = await Promise.all([
        requiredStdout(processes, PS, PS_ARGS, {
          timeoutMs: RUN_TIMEOUT_MS,
        }).then((stdout) => ({
          rows: parsePs(stdout),
          cpu: cpuTotals(cpus()),
        })),
        requiredStdout(processes, VM_STAT, [], {
          timeoutMs: RUN_TIMEOUT_MS,
        }),
        sysctlStdout(processes),
        optionalStdout(processes, IOREG, IOREG_ACCELERATORS),
        optionalStdout(processes, IOREG, IOREG_GPU_CLIENTS),
        requiredStdout(processes, NETSTAT, NETSTAT_ARGS, {
          timeoutMs: RUN_TIMEOUT_MS,
        }),
        requiredStdout(processes, IOREG, IOREG_BLOCK_STORAGE, {
          timeoutMs: RUN_TIMEOUT_MS,
        }),
      ]);
      return {
        ...ps.cpu,
        memory: {
          usedBytes: parseVmStatUsedBytes(vmStat),
          ...parseSysctl(sysctl),
        },
        gpuPercent:
          accelerators === null ? null : parseDeviceUtilisation(accelerators),
        network: parseNetstat(netstat),
        disk: parseBlockStorage(blockStorage),
        processes: withGpuTimes(ps.rows, gpuClients),
      };
    },
  };
}

// `rows` with each process's GPU time from the AGX clients' output: 0 for a
// process with no client, and null for every process when the output is
// missing or lists no client (an Intel Mac).
function withGpuTimes(
  rows: ProcessRow[],
  gpuClients: string | null,
): SystemSample['processes'] {
  const times =
    gpuClients === null ? new Map<number, number>() : parseGpuTimes(gpuClients);
  const hasGpuTimes = times.size > 0;
  return rows.map((row) => ({
    ...row,
    gpuTimeNs: hasGpuTimes ? (times.get(row.pid) ?? 0) : null,
  }));
}

// `sysctl` exits 1 when one of its names is unknown but still prints the
// others, so only a timeout fails it.
function sysctlStdout(processes: ProcessRunner): Promise<string> {
  return requiredStdout(processes, SYSCTL, SYSCTL_ARGS, {
    timeoutMs: RUN_TIMEOUT_MS,
    anyExitCode: true,
  });
}

// The stdout of a run the sample can do without; null when it cannot run,
// times out or exits non-zero.
async function optionalStdout(
  processes: ProcessRunner,
  program: string,
  args: string[],
): Promise<string | null> {
  try {
    return await requiredStdout(processes, program, args, {
      timeoutMs: RUN_TIMEOUT_MS,
    });
  } catch {
    return null;
  }
}
