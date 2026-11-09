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

describe('createFakeSystemStats', () => {
  it('fakeSystemStats_EachSampleAdvancesEveryCounter', async () => {
    const stats = createFakeSystemStats();

    const first = countersOf(await stats.sample());
    const second = countersOf(await stats.sample());

    for (const [counter, value] of Object.entries(second)) {
      expect(value, counter).toBeGreaterThan(
        first[counter as keyof typeof first],
      );
    }
  });
});
