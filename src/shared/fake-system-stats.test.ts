import { describe, expect, it } from 'vitest';
import type { SystemSample } from '../contracts/system-stats';
import { createFakeSystemStats } from './fake-system-stats';

// The counters a rate is read from.
function countersOf(sample: SystemSample) {
  const browser = sample.processes.find((process) => process.pid === 101);
  return {
    cpuBusyMs: sample.cpuBusyMs,
    cpuTotalMs: sample.cpuTotalMs,
    receivedBytes: sample.network.receivedBytes,
    sentBytes: sample.network.sentBytes,
    readBytes: sample.disk.readBytes,
    writtenBytes: sample.disk.writtenBytes,
    browserCpuTimeMs: browser?.cpuTimeMs ?? 0,
    browserGpuTimeNs: browser?.gpuTimeNs ?? 0,
  };
}

type Counters = ReturnType<typeof countersOf>;

// Each counter's growth per second from `before` to `after`.
function ratesOf(before: Counters, after: Counters, elapsedMs: number) {
  return Object.fromEntries(
    Object.entries(after).map(([counter, value]) => [
      counter,
      ((value - before[counter as keyof Counters]) * 1000) / elapsedMs,
    ]),
  );
}

describe('createFakeSystemStats', () => {
  it('fakeSystemStats_RatesHoldWhateverTheGap', async () => {
    const clock = { at: 40_000, now: () => clock.at };
    const stats = createFakeSystemStats(clock);

    const first = countersOf(await stats.sample());
    clock.at += 1_000;
    const second = countersOf(await stats.sample());
    clock.at += 3_000;
    const third = countersOf(await stats.sample());

    const overOneSecond = ratesOf(first, second, 1_000);
    expect(Object.values(overOneSecond).every((rate) => rate > 0)).toBe(true);
    expect(ratesOf(second, third, 3_000)).toEqual(overOneSecond);
  });
});
