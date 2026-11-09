import { describe, expect, it } from 'vitest';
import type {
  ProcessSample,
  SystemSample,
} from '../../../contracts/system-stats';
import type { StatsSnapshot } from '../contract';
import {
  buildSnapshot,
  emptyHistory,
  errorSnapshot,
  formatRate,
  historyCapacity,
  processRates,
  type StatsHistory,
  toneOf,
} from './snapshot';
import { statsFixture } from './stats-fixture';

const ELAPSED_MS = 2000;
const CORES = 8;

function process(overrides: Partial<ProcessSample> = {}): ProcessSample {
  return {
    pid: 610,
    ppid: 1,
    name: 'node',
    path: '/usr/local/bin/node',
    cpuTimeMs: 10_000,
    rssBytes: 52_428_800,
    gpuTimeNs: 2_000_000_000,
    ...overrides,
  };
}

// The earlier reading every `buildSnapshot` row grows from.
const PREV: SystemSample = {
  cores: CORES,
  cpuBusyMs: 1_000,
  cpuTotalMs: 4_000,
  memory: {
    totalBytes: 34_359_738_368,
    usedBytes: 17_179_869_184,
    swapUsedBytes: 0,
    pressure: null,
  },
  gpuPercent: 30,
  network: { receivedBytes: 5_000_000, sentBytes: 1_000_000 },
  disk: { readBytes: 9_000_000, writtenBytes: 2_000_000 },
  processes: [],
};

function next(overrides: Partial<SystemSample>): SystemSample {
  return {
    ...PREV,
    cpuBusyMs: 3_000,
    cpuTotalMs: 12_000,
    ...overrides,
  };
}

function built(
  nextSample: SystemSample,
  history: StatsHistory = emptyHistory(30),
): StatsSnapshot {
  return buildSnapshot(PREV, nextSample, ELAPSED_MS, [], history, 7_000)
    .snapshot;
}

function memory(
  usedPercent: number,
  pressure: SystemSample['memory']['pressure'],
): SystemSample['memory'] {
  return {
    totalBytes: 10_000_000_000,
    usedBytes: usedPercent * 100_000_000,
    swapUsedBytes: 0,
    pressure,
  };
}

describe('processRates', () => {
  it.each<{
    case: string;
    prev: ProcessSample[];
    next: ProcessSample;
    cpuPercent: number;
    gpuPercent: number | null;
  }>([
    {
      case: 'matched pid',
      prev: [process({ cpuTimeMs: 10_000 })],
      next: process({ cpuTimeMs: 14_000 }),
      cpuPercent: 25,
      gpuPercent: 0,
    },
    {
      // `ps`: ` 75078  7827   0:02.10 …/bin/node`, started since the last sample.
      case: 'new pid counts its whole time',
      prev: [process({ pid: 77 })],
      next: process({ pid: 75078, cpuTimeMs: 2_100, gpuTimeNs: 1e9 }),
      cpuPercent: 13.125,
      gpuPercent: 50,
    },
    {
      case: 'same pid, other name counts its whole time',
      prev: [process({ name: 'zsh', cpuTimeMs: 100 })],
      next: process({ cpuTimeMs: 1_200, gpuTimeNs: 5e8 }),
      cpuPercent: 7.5,
      gpuPercent: 25,
    },
    {
      case: 'CPU time went down',
      prev: [process({ cpuTimeMs: 14_000 })],
      next: process({ cpuTimeMs: 10_000 }),
      cpuPercent: 0,
      gpuPercent: 0,
    },
    {
      case: 'GPU time grew',
      prev: [process({ gpuTimeNs: 2e9 })],
      next: process({ gpuTimeNs: 2.5e9 }),
      cpuPercent: 0,
      gpuPercent: 25,
    },
    {
      case: 'next GPU null',
      prev: [process({ gpuTimeNs: 2e9 })],
      next: process({ gpuTimeNs: null }),
      cpuPercent: 0,
      gpuPercent: null,
    },
    {
      case: 'prev GPU null',
      prev: [process({ gpuTimeNs: null })],
      next: process({ gpuTimeNs: 2.5e9 }),
      cpuPercent: 0,
      gpuPercent: 0,
    },
    {
      case: 'share past 100',
      prev: [process({ cpuTimeMs: 0, gpuTimeNs: 0 })],
      next: process({ cpuTimeMs: 50_000, gpuTimeNs: 9e9 }),
      cpuPercent: 100,
      gpuPercent: 100,
    },
  ])(
    'processRates_SharesTheMachine: $case',
    ({ prev, next: nextProcess, cpuPercent, gpuPercent }) => {
      const [rate] = processRates(prev, [nextProcess], ELAPSED_MS, CORES);

      expect({
        cpuPercent: rate.cpuPercent,
        gpuPercent: rate.gpuPercent,
      }).toEqual({
        cpuPercent,
        gpuPercent,
      });
    },
  );
});

describe('buildSnapshot', () => {
  it.each<{
    case: string;
    next: SystemSample;
    history?: StatsHistory;
    pick(snapshot: StatsSnapshot): unknown;
    expected: unknown;
  }>([
    {
      case: 'CPU busy over total',
      next: next({ cpuBusyMs: 4_000, cpuTotalMs: 12_000 }),
      pick: ({ cpu }) => cpu,
      expected: {
        percent: 37.5,
        tone: 'normal',
        history: [37.5],
        label: '38%',
      },
    },
    {
      case: 'RAM label and tone',
      next: next({
        memory: {
          totalBytes: 34_359_738_368,
          usedBytes: 22_978_666_496,
          swapUsedBytes: 0,
          pressure: null,
        },
      }),
      pick: ({ ram }) => ({ label: ram.label, tone: ram.tone }),
      expected: { label: '21.4 / 32 GB', tone: 'normal' },
    },
    {
      case: 'CPU label and tone agree at 90%',
      next: next({ cpuBusyMs: 8_184, cpuTotalMs: 12_000 }),
      pick: ({ cpu }) => ({ label: cpu.label, tone: cpu.tone }),
      expected: { label: '90%', tone: 'critical' },
    },
    {
      case: 'GPU critical',
      next: next({ gpuPercent: 92 }),
      pick: ({ gpu }) => gpu,
      expected: { percent: 92, tone: 'critical', history: [92], label: '92%' },
    },
    {
      case: 'GPU null',
      next: next({ gpuPercent: null }),
      history: { ...emptyHistory(30), gpu: [10, 20] },
      pick: ({ gpu }) => gpu,
      expected: {
        percent: null,
        tone: 'normal',
        history: [10, 20],
        label: '—',
      },
    },
    {
      case: 'CPU total unchanged',
      next: next({ cpuBusyMs: 1_000, cpuTotalMs: 4_000 }),
      pick: ({ cpu }) => cpu.percent,
      expected: 0,
    },
    {
      case: 'RAM total 0',
      next: next({
        memory: { ...PREV.memory, totalBytes: 0, usedBytes: 5_000 },
      }),
      pick: ({ ram }) => ram.percent,
      expected: 0,
    },
    {
      case: 'RAM 89% at pressure normal',
      next: next({ memory: memory(89, 'normal') }),
      pick: ({ ram }) => ram.tone,
      expected: 'normal',
    },
    {
      case: 'RAM 40% at pressure critical',
      next: next({ memory: memory(40, 'critical') }),
      pick: ({ ram }) => ram.tone,
      expected: 'critical',
    },
    {
      case: 'RAM 75% with no pressure',
      next: next({ memory: memory(75, null) }),
      pick: ({ ram }) => ram.tone,
      expected: 'warning',
    },
  ])(
    'buildSnapshot_Meters: $case',
    ({ next: nextSample, history, pick, expected }) => {
      expect(pick(built(nextSample, history))).toEqual(expected);
    },
  );

  it.each<{
    case: string;
    next: SystemSample;
    ring: number[];
    meter: 'network' | 'disk';
    percent: number;
    history: number[];
  }>([
    {
      case: 'below the floor',
      next: next({
        network: { receivedBytes: 5_600_000, sentBytes: 1_200_000 },
      }),
      ring: [200_000],
      meter: 'network',
      percent: 40,
      history: [20, 40],
    },
    {
      case: 'highest in the window',
      next: next({
        network: { receivedBytes: 7_000_000, sentBytes: 2_000_000 },
      }),
      ring: [3_000_000],
      meter: 'network',
      percent: 50,
      history: [100, 50],
    },
    {
      case: 'counter went down',
      next: next({
        network: { receivedBytes: 1_000, sentBytes: 1_000_000 },
      }),
      ring: [],
      meter: 'network',
      percent: 0,
      history: [0],
    },
    {
      case: 'device appeared',
      next: next({
        network: { receivedBytes: 1_000_005_000_000, sentBytes: 1_000_000 },
      }),
      ring: [],
      meter: 'network',
      percent: 0,
      history: [0],
    },
    {
      case: 'disk read and written',
      next: next({ disk: { readBytes: 10_500_000, writtenBytes: 2_100_000 } }),
      ring: [1_600_000],
      meter: 'disk',
      percent: 50,
      history: [100, 50],
    },
  ])(
    'networkScale_HighestInWindowWithFloor: $case',
    ({ next: nextSample, ring, meter, percent, history }) => {
      const before: StatsHistory = {
        ...emptyHistory(30),
        networkRate: meter === 'network' ? ring : [],
        diskRate: meter === 'disk' ? ring : [],
      };

      const snapshot = built(nextSample, before);

      expect({
        percent: snapshot[meter].percent,
        history: snapshot[meter].history,
      }).toEqual({ percent, history });
    },
  );

  it.each([
    { refreshSeconds: 2, capacity: 30 },
    { refreshSeconds: 1, capacity: 60 },
    { refreshSeconds: 7, capacity: 9 },
    { refreshSeconds: 0.5, capacity: 60 },
    { refreshSeconds: 120, capacity: 2 },
  ])(
    'history_RingAndCapacity: capacity at $refreshSeconds s',
    ({ refreshSeconds, capacity }) => {
      expect(historyCapacity(refreshSeconds)).toBe(capacity);
    },
  );

  it('history_RingAndCapacity: an append at capacity drops the oldest', () => {
    const history = { ...emptyHistory(3), cpu: [5, 6, 7] };

    const result = buildSnapshot(
      PREV,
      next({ cpuBusyMs: 1_008, cpuTotalMs: 4_100 }),
      ELAPSED_MS,
      [],
      history,
      7_000,
    );

    expect(result.history.cpu).toEqual([6, 7, 8]);
  });

  it.each<{ memory: SystemSample['memory']; note: string }>([
    {
      memory: {
        ...PREV.memory,
        swapUsedBytes: 1_288_490_189,
        pressure: 'warning',
      },
      note: 'pressure warning · swap 1.2 GB',
    },
    {
      memory: { ...PREV.memory, swapUsedBytes: 0, pressure: null },
      note: 'swap 0.0 GB',
    },
  ])('memoryNote_PressureAndSwap: $note', ({ memory: reading, note }) => {
    expect(built(next({ memory: reading })).memoryNote).toBe(note);
  });
});

describe('toneOf', () => {
  it.each([
    { percent: 69.4, tone: 'normal' },
    { percent: 69.5, tone: 'warning' },
    { percent: 89.4, tone: 'warning' },
    { percent: 89.5, tone: 'critical' },
    { percent: null, tone: 'normal' },
  ])('toneOf_Thresholds: $percent', ({ percent, tone }) => {
    expect(toneOf(percent)).toBe(tone);
  });
});

describe('formatRate', () => {
  it.each([
    { bytes: 0, text: '0 B/s' },
    { bytes: 512, text: '512 B/s' },
    { bytes: 1234, text: '1.2 KB/s' },
    { bytes: 80_400, text: '80 KB/s' },
    { bytes: 12_345_678, text: '12 MB/s' },
    { bytes: 2_500_000_000, text: '2.5 GB/s' },
  ])('formatRate_Units: $bytes', ({ bytes, text }) => {
    expect(formatRate(bytes)).toBe(text);
  });
});

describe('errorSnapshot', () => {
  it('errorSnapshot_KeepsLastOrEmpties: with a last snapshot', () => {
    const last = statsFixture('busy', 1_000);

    expect(errorSnapshot(last, 5_000, 'ps exited')).toEqual({
      ...last,
      takenAt: 5_000,
      error: 'ps exited',
    });
  });

  it('errorSnapshot_KeepsLastOrEmpties: with none', () => {
    const snapshot = errorSnapshot(null, 5_000, 'ps exited');
    const meters = [
      snapshot.cpu,
      snapshot.gpu,
      snapshot.ram,
      snapshot.network,
      snapshot.disk,
    ];

    expect({
      meters: meters.map(({ percent, label }) => ({ percent, label })),
      rows: snapshot.rows,
      error: snapshot.error,
    }).toEqual({
      meters: Array(5).fill({ percent: null, label: '—' }),
      rows: [],
      error: 'ps exited',
    });
  });
});
