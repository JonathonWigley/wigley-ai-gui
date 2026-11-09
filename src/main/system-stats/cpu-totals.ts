import type { SystemSample } from '../../contracts/system-stats';

// One core's cumulative times in ms, as Node's `os.cpus()` gives them.
export interface CpuTimes {
  times: { user: number; nice: number; sys: number; idle: number; irq: number };
}

// The core count and the machine's cumulative busy and total CPU time over
// every core in `cpus`.
export function cpuTotals(
  cpus: readonly CpuTimes[],
): Pick<SystemSample, 'cores' | 'cpuBusyMs' | 'cpuTotalMs'> {
  let cpuBusyMs = 0;
  let idleMs = 0;
  for (const { times } of cpus) {
    cpuBusyMs += times.user + times.nice + times.sys + times.irq;
    idleMs += times.idle;
  }
  return { cores: cpus.length, cpuBusyMs, cpuTotalMs: cpuBusyMs + idleMs };
}
