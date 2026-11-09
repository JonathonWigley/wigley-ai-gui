import type {
  ProcessSample,
  SystemSample,
  SystemStats,
} from '../contracts/system-stats';

// The pid of the fake `claude` process a Chat session's process tree hangs from.
export const FAKE_SESSION_PID = 4242;

// The fake machine's reading at `step`: fixed processes on a busy machine,
// every cumulative counter grown by a fixed amount per step, so two samples
// one step apart give non-zero rates.
export function fakeSystemSample(step: number): SystemSample {
  return {
    cores: 8,
    cpuTotalMs: 1_000_000 + 16_000 * step,
    cpuBusyMs: 400_000 + 6_000 * step,
    memory: {
      totalBytes: 34_359_738_368,
      usedBytes: 21_474_836_480,
      swapUsedBytes: 1_073_741_824,
      pressure: 'normal',
    },
    gpuPercent: 20 + 10 * (step % 5),
    network: {
      receivedBytes: 5_000_000 + 1_500_000 * step,
      sentBytes: 1_000_000 + 200_000 * step,
    },
    disk: {
      readBytes: 9_000_000 + 3_000_000 * step,
      writtenBytes: 2_000_000 + 800_000 * step,
    },
    processes: fakeProcesses(step),
  };
}

// A SystemStats whose samples are `fakeSystemSample` at steps 0, 1, 2, …
export function createFakeSystemStats(): SystemStats {
  let step = 0;
  return {
    sample: () => Promise.resolve(fakeSystemSample(step++)),
  };
}

function fakeProcesses(step: number): ProcessSample[] {
  return [
    {
      pid: 1,
      ppid: 0,
      name: 'launchd',
      path: '/sbin/launchd',
      cpuTimeMs: 50_000 + 100 * step,
      rssBytes: 10_485_760,
      gpuTimeNs: 0,
    },
    {
      pid: 101,
      ppid: 1,
      name: 'Fake Browser',
      path: '/Applications/Fake Browser.app/Contents/MacOS/Fake Browser',
      cpuTimeMs: 200_000 + 2_400 * step,
      rssBytes: 629_145_600,
      gpuTimeNs: 5_000_000_000 + 400_000_000 * step,
    },
    {
      pid: 102,
      ppid: 101,
      name: 'Fake Browser Helper',
      path: '/Applications/Fake Browser.app/Contents/Frameworks/Fake Browser Helper.app/Contents/MacOS/Fake Browser Helper',
      cpuTimeMs: 80_000 + 1_200 * step,
      rssBytes: 314_572_800,
      gpuTimeNs: 0,
    },
    {
      pid: 201,
      ppid: 1,
      name: 'node',
      path: '/usr/local/bin/node',
      cpuTimeMs: 30_000 + 800 * step,
      rssBytes: 157_286_400,
      gpuTimeNs: 0,
    },
    {
      pid: FAKE_SESSION_PID,
      ppid: 1,
      name: 'claude',
      path: '/Users/fake/.local/bin/claude',
      cpuTimeMs: 10_000 + 1_000 * step,
      rssBytes: 268_435_456,
      gpuTimeNs: 0,
    },
    {
      pid: 4243,
      ppid: FAKE_SESSION_PID,
      name: 'node',
      path: '/usr/local/bin/node',
      cpuTimeMs: 2_000 + 400 * step,
      rssBytes: 104_857_600,
      gpuTimeNs: 0,
    },
  ];
}
