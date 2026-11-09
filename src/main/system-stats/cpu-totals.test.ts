import { describe, expect, it } from 'vitest';
import { cpuTotals } from './cpu-totals';

describe('cpuTotals', () => {
  it('cpuTotals_SumsBusyAndIdleOverCores', () => {
    const cpus = [
      { times: { user: 1000, nice: 20, sys: 300, idle: 5000, irq: 7 } },
      { times: { user: 2000, nice: 0, sys: 400, idle: 4000, irq: 3 } },
    ];

    expect(cpuTotals(cpus)).toEqual({
      cores: 2,
      cpuBusyMs: 3730,
      cpuTotalMs: 12730,
    });
  });
});
