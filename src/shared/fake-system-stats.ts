import type { Clock } from '../contracts/ambient';
import type {
  ProcessSample,
  SystemSample,
  SystemStats,
} from '../contracts/system-stats';
import { FAKE_AGENT_PID } from './fake-agent-harness';

// How long each of the fake machine's periods lasts: the GPU total and the
// network and disk rates hold through a period and change at the next one,
// through the five periods of a cycle.
const PERIOD_SECONDS = 2;
const GPU_PERCENTS = [20, 30, 40, 50, 60];
const RECEIVED_RATES = [750_000, 40_000, 12_000_000, 300_000, 2_000];
const SENT_RATES = [100_000, 8_000, 900_000, 60_000, 500];
const READ_RATES = [1_500_000, 20_000, 45_000_000, 400_000, 0];
const WRITTEN_RATES = [400_000, 5_000, 8_000_000, 120_000, 0];

// The fake machine's reading `elapsedMs` after it started: fixed processes on
// a busy machine. The CPU counters grow at a fixed rate per second; the
// network and disk counters at their period's rate. Every reading is a
// function of the time alone, so two samples in one period give that period's
// rates whatever the gap between them.
export function fakeSystemSample(elapsedMs: number): SystemSample {
  const seconds = elapsedMs / 1000;
  return {
    cores: 8,
    cpuTotalMs: 1_000_000 + 8_000 * seconds,
    cpuBusyMs: 400_000 + 3_000 * seconds,
    memory: {
      totalBytes: 34_359_738_368,
      usedBytes: 21_474_836_480,
      swapUsedBytes: 1_073_741_824,
      pressure: 'normal',
    },
    gpuPercent:
      GPU_PERCENTS[Math.floor(seconds / PERIOD_SECONDS) % GPU_PERCENTS.length],
    network: {
      receivedBytes: 5_000_000 + bytesByPeriod(RECEIVED_RATES, seconds),
      sentBytes: 1_000_000 + bytesByPeriod(SENT_RATES, seconds),
    },
    disk: {
      readBytes: 9_000_000 + bytesByPeriod(READ_RATES, seconds),
      writtenBytes: 2_000_000 + bytesByPeriod(WRITTEN_RATES, seconds),
    },
    processes: fakeProcesses(seconds),
  };
}

// A SystemStats whose samples are `fakeSystemSample` at the time since it was
// created, read from `clock`.
export function createFakeSystemStats(clock: Clock): SystemStats {
  const startedAt = clock.now();
  return {
    sample: () => Promise.resolve(fakeSystemSample(clock.now() - startedAt)),
  };
}

// The bytes counted in the first `seconds`, at `rates[i]` bytes per second
// through the i-th period of each cycle.
function bytesByPeriod(rates: readonly number[], seconds: number): number {
  const cycleSeconds = PERIOD_SECONDS * rates.length;
  const cycles = Math.floor(seconds / cycleSeconds);
  const perCycle = PERIOD_SECONDS * rates.reduce((sum, rate) => sum + rate, 0);
  let bytes = cycles * perCycle;
  let left = seconds - cycles * cycleSeconds;
  for (const rate of rates) {
    const span = Math.min(left, PERIOD_SECONDS);
    bytes += rate * span;
    left -= span;
  }
  return bytes;
}

function fakeProcesses(seconds: number): ProcessSample[] {
  return [
    {
      pid: 1,
      ppid: 0,
      name: 'launchd',
      path: '/sbin/launchd',
      cpuTimeMs: 50_000 + 50 * seconds,
      rssBytes: 10_485_760,
      gpuTimeNs: 0,
    },
    {
      pid: 101,
      ppid: 1,
      name: 'Fake Browser',
      path: '/Applications/Fake Browser.app/Contents/MacOS/Fake Browser',
      cpuTimeMs: 200_000 + 1_200 * seconds,
      rssBytes: 629_145_600,
      gpuTimeNs: 5_000_000_000 + 200_000_000 * seconds,
    },
    {
      pid: 102,
      ppid: 101,
      name: 'Fake Browser Helper',
      path: '/Applications/Fake Browser.app/Contents/Frameworks/Fake Browser Helper.app/Contents/MacOS/Fake Browser Helper',
      cpuTimeMs: 80_000 + 600 * seconds,
      rssBytes: 314_572_800,
      gpuTimeNs: 0,
    },
    {
      pid: 201,
      ppid: 1,
      name: 'node',
      path: '/usr/local/bin/node',
      cpuTimeMs: 30_000 + 400 * seconds,
      rssBytes: 157_286_400,
      gpuTimeNs: 0,
    },
    {
      pid: FAKE_AGENT_PID,
      ppid: 1,
      name: 'claude',
      path: '/Users/fake/.local/bin/claude',
      cpuTimeMs: 10_000 + 500 * seconds,
      rssBytes: 268_435_456,
      gpuTimeNs: 0,
    },
    {
      pid: 4243,
      ppid: FAKE_AGENT_PID,
      name: 'node',
      path: '/usr/local/bin/node',
      cpuTimeMs: 2_000 + 200 * seconds,
      rssBytes: 104_857_600,
      gpuTimeNs: 0,
    },
  ];
}
