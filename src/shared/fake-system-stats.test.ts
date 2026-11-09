import { describe, expect, it } from 'vitest';
import type { SystemSample } from '../contracts/system-stats';
import { createFakeSystemStats } from './fake-system-stats';

const CREATED_AT = 40_000;

// The counters a rate is read from.
function countersOf(sample: SystemSample) {
  const browser = sample.processes.find((process) => process.pid === 101);
  return {
    cpuTotal: sample.cpuTotalMs,
    cpuBusy: sample.cpuBusyMs,
    browserCpu: browser?.cpuTimeMs ?? Number.NaN,
    browserGpu: browser?.gpuTimeNs ?? Number.NaN,
    received: sample.network.receivedBytes,
    sent: sample.network.sentBytes,
    read: sample.disk.readBytes,
    written: sample.disk.writtenBytes,
  };
}

type Counters = ReturnType<typeof countersOf>;

// The CPU and GPU-time rates hold through every period.
const STEADY_RATES = {
  cpuTotal: 8_000,
  cpuBusy: 3_000,
  browserCpu: 1_200,
  browserGpu: 200_000_000,
};

const PERIOD_0 = {
  ...STEADY_RATES,
  received: 750_000,
  sent: 100_000,
  read: 1_500_000,
  written: 400_000,
};

describe('createFakeSystemStats', () => {
  it.each<{ case: string; fromMs: number; toMs: number; rates: Counters }>([
    { case: 'period 0, half a second', fromMs: 0, toMs: 500, rates: PERIOD_0 },
    {
      case: 'period 0, a second and a half',
      fromMs: 500,
      toMs: 2_000,
      rates: PERIOD_0,
    },
    {
      case: 'period 2',
      fromMs: 4_500,
      toMs: 5_500,
      rates: {
        ...STEADY_RATES,
        received: 12_000_000,
        sent: 900_000,
        read: 45_000_000,
        written: 8_000_000,
      },
    },
    {
      case: 'half in period 0, half in period 1',
      fromMs: 1_500,
      toMs: 2_500,
      rates: {
        ...STEADY_RATES,
        received: 395_000,
        sent: 54_000,
        read: 760_000,
        written: 202_500,
      },
    },
    {
      case: 'period 0 of the next cycle',
      fromMs: 10_000,
      toMs: 11_000,
      rates: PERIOD_0,
    },
  ])(
    'fakeSystemStats_RatesFollowThePeriodWhateverTheGap: $case',
    async ({ fromMs, toMs, rates }) => {
      const clock = { at: CREATED_AT, now: () => clock.at };
      const stats = createFakeSystemStats(clock);

      clock.at = CREATED_AT + fromMs;
      const before = countersOf(await stats.sample());
      clock.at = CREATED_AT + toMs;
      const after = countersOf(await stats.sample());

      const elapsedSeconds = (toMs - fromMs) / 1000;
      const measured = Object.fromEntries(
        Object.keys(rates).map((name) => {
          const key = name as keyof Counters;
          return [key, (after[key] - before[key]) / elapsedSeconds];
        }),
      );
      expect(measured).toEqual(rates);
    },
  );
});
