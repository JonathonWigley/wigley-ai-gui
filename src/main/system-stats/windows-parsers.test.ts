import { describe, expect, it } from 'vitest';
import { parseWindowsReading } from './windows-parsers';

// Representative documents in WINDOWS_SAMPLE_SCRIPT's shape, built here: the
// script cannot run on the Mac these tests were written on.

const CHROME_PATH =
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const CHROME_PROCESS = {
  pid: 5120,
  ppid: 4880,
  name: 'chrome.exe',
  path: CHROME_PATH,
  cpu100ns: 4567890000,
  rss: 312475648,
};

const CHROME_CHILD_ENGINE = {
  name: 'pid_6200_luid_0x00000000_0x0000D1A6_phys_0_eng_0_engtype_3D',
  runningTime: 1000,
};

const DOCUMENT = {
  processes: [
    {
      pid: 0,
      ppid: 0,
      name: 'System Idle Process',
      path: '',
      cpu100ns: 9876543210000,
      rss: 8192,
    },
    {
      pid: 4,
      ppid: 0,
      name: 'System',
      path: null,
      cpu100ns: 123456789,
      rss: 143360,
    },
    CHROME_PROCESS,
    {
      pid: 6200,
      ppid: 5120,
      name: 'chrome.exe',
      path: CHROME_PATH,
      cpu100ns: 1200000,
      rss: 98304000,
    },
  ],
  memory: { totalKb: 33435224, availableBytes: 12884901888, swapUsedMb: 2048 },
  gpu: {
    utilization: [
      {
        name: 'pid_5120_luid_0x00000000_0x0000D1A6_phys_0_eng_0_engtype_3D',
        percent: 30,
      },
      {
        name: 'pid_6200_luid_0x00000000_0x0000D1A6_phys_0_eng_0_engtype_3D',
        percent: 7.5,
      },
      {
        name: 'pid_7000_luid_0x00000000_0x0000E2B7_phys_0_eng_0_engtype_3D',
        percent: 12,
      },
    ],
    engines: [
      {
        name: 'pid_5120_luid_0x00000000_0x0000D1A6_phys_0_eng_0_engtype_3D',
        runningTime: 250000000,
      },
      {
        name: 'pid_5120_luid_0x00000000_0x0000D1A6_phys_0_eng_1_engtype_3D',
        runningTime: 50000000,
      },
      CHROME_CHILD_ENGINE,
    ],
  },
  network: { received: 987654321, sent: 123456789 },
  disk: { read: 55555555555, written: 4444444444 },
};

// DOCUMENT with `changes` merged over its top level, as one line of stdout.
function stdoutWith(changes: object): string {
  return JSON.stringify({ ...DOCUMENT, ...changes });
}

function utilization(
  ...entries: [adapter: string, percent: number][]
): { name: string; percent: number }[] {
  return entries.map(([adapter, percent], index) => ({
    name: `pid_${5120 + index}_luid_0x00000000_${adapter}_phys_0_eng_0_engtype_3D`,
    percent,
  }));
}

describe('windows-parsers', () => {
  it('parseWindowsReading_ReadsTheScriptDocument', () => {
    expect(parseWindowsReading(stdoutWith({}))).toEqual({
      memory: {
        totalBytes: 34237669376,
        usedBytes: 21352767488,
        swapUsedBytes: 2147483648,
        pressure: null,
      },
      gpuPercent: 37.5,
      network: { receivedBytes: 987654321, sentBytes: 123456789 },
      disk: { readBytes: 55555555555, writtenBytes: 4444444444 },
      processes: [
        {
          pid: 4,
          ppid: 0,
          name: 'System',
          path: '',
          cpuTimeMs: 12346,
          rssBytes: 143360,
          gpuTimeNs: 0,
        },
        {
          pid: 5120,
          ppid: 4880,
          name: 'chrome.exe',
          path: CHROME_PATH,
          cpuTimeMs: 456789,
          rssBytes: 312475648,
          gpuTimeNs: 30000000000,
        },
        {
          pid: 6200,
          ppid: 5120,
          name: 'chrome.exe',
          path: CHROME_PATH,
          cpuTimeMs: 120,
          rssBytes: 98304000,
          gpuTimeNs: 100000,
        },
      ],
    });
  });

  it.each<{ name: string; stdout: string; expected: object }>([
    {
      name: 'no GPU classes',
      stdout: stdoutWith({ gpu: null }),
      expected: {
        gpuPercent: null,
        processes: [
          { gpuTimeNs: null },
          { gpuTimeNs: null },
          { gpuTimeNs: null },
        ],
      },
    },
    {
      name: 'no 3D engines',
      stdout: stdoutWith({ gpu: { utilization: [], engines: [] } }),
      expected: {
        gpuPercent: 0,
        processes: [{ gpuTimeNs: 0 }, { gpuTimeNs: 0 }, { gpuTimeNs: 0 }],
      },
    },
    {
      name: 'one adapter past 100',
      stdout: stdoutWith({
        gpu: {
          ...DOCUMENT.gpu,
          utilization: utilization(['0x0000D1A6', 90], ['0x0000D1A6', 50]),
        },
      }),
      expected: { gpuPercent: 100 },
    },
    {
      name: 'the other adapter busier',
      stdout: stdoutWith({
        gpu: {
          ...DOCUMENT.gpu,
          utilization: utilization(
            ['0x0000D1A6', 30],
            ['0x0000D1A6', 7.5],
            ['0x0000E2B7', 60],
          ),
        },
      }),
      expected: { gpuPercent: 60 },
    },
    {
      name: 'processes as a bare object',
      stdout: stdoutWith({ processes: CHROME_PROCESS }),
      expected: { processes: [{ pid: 5120 }] },
    },
    {
      name: 'engines as a bare object',
      stdout: stdoutWith({
        gpu: { ...DOCUMENT.gpu, engines: CHROME_CHILD_ENGINE },
      }),
      expected: {
        processes: [
          { pid: 4, gpuTimeNs: 0 },
          { pid: 5120, gpuTimeNs: 0 },
          { pid: 6200, gpuTimeNs: 100000 },
        ],
      },
    },
  ])('parseWindowsReading_DocumentVariants ($name)', ({ stdout, expected }) => {
    expect(parseWindowsReading(stdout)).toMatchObject(expected);
  });

  it.each<{ name: string; stdout: string }>([
    { name: 'not JSON', stdout: 'Get-CimInstance : Access denied' },
    {
      name: 'no memory',
      stdout: JSON.stringify({ ...DOCUMENT, memory: undefined }),
    },
  ])('parseWindowsReading_DocumentVariants ($name throws)', ({ stdout }) => {
    expect(() => parseWindowsReading(stdout)).toThrow(/powershell\.exe/);
  });
});
