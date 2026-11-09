import { describe, expect, it } from 'vitest';
import type { ProcessResult } from '../../contracts/processes';
import { FakeProcesses } from '../../shared/fake-processes';
import { createMacSystemStats } from './mac-system-stats';

const PS: Command = ['/bin/ps', ['-axww', '-o', 'pid=,ppid=,time=,rss=,comm=']];
const VM_STAT: Command = ['/usr/bin/vm_stat', []];
const SYSCTL: Command = [
  '/usr/sbin/sysctl',
  ['hw.memsize', 'vm.swapusage', 'kern.memorystatus_vm_pressure_level'],
];
const ACCELERATORS: Command = [
  '/usr/sbin/ioreg',
  ['-r', '-d', '1', '-w', '0', '-c', 'IOAccelerator'],
];
const GPU_CLIENTS: Command = [
  '/usr/sbin/ioreg',
  ['-r', '-d', '1', '-w', '0', '-c', 'AGXDeviceUserClient'],
];
const NETSTAT: Command = ['/usr/sbin/netstat', ['-ibn']];
const BLOCK_STORAGE: Command = [
  '/usr/sbin/ioreg',
  ['-r', '-d', '1', '-w', '0', '-c', 'IOBlockStorageDriver'],
];

type Command = [program: string, args: string[]];

const SYSCTL_STDOUT = [
  'hw.memsize: 8589934592',
  'vm.swapusage: total = 3.00G  used = 1.50G  free = 1.50G  (encrypted)',
  'kern.memorystatus_vm_pressure_level: 2',
].join('\n');

// Every command's output on a machine running pid 300 under pid 1, with a GPU
// client only for pid 300.
const STDOUTS: [Command, string][] = [
  [
    PS,
    [
      '    1     0   3:00.25   2048 /sbin/launchd',
      '  300     1   0:01.50   1024 claude',
    ].join('\n'),
  ],
  [
    VM_STAT,
    [
      'Mach Virtual Memory Statistics: (page size of 4096 bytes)',
      'Pages wired down:                           500.',
      'Pages purgeable:                            100.',
      'Anonymous pages:                           1000.',
      'Pages occupied by compressor:               200.',
    ].join('\n'),
  ],
  [SYSCTL, SYSCTL_STDOUT],
  [
    ACCELERATORS,
    '+-o AGXAcceleratorG14X  <class AGXAcceleratorG14X>\n    "PerformanceStatistics" = {"Device Utilization %"=37}',
  ],
  [
    GPU_CLIENTS,
    '+-o AGXDeviceUserClient  <class AGXDeviceUserClient>\n    "AppUsage" = ({"API"="Metal","accumulatedGPUTime"=5000})\n    "IOUserClientCreator" = "pid 300, claude"',
  ],
  [
    NETSTAT,
    [
      'Name       Mtu   Network       Address            Ipkts Ierrs     Ibytes    Opkts Oerrs     Obytes  Coll',
      'en0        1500  <Link#14>   fa:2f:f9:2b:4d:f6     900     0      70000      800     0      9000     0',
    ].join('\n'),
  ],
  [
    BLOCK_STORAGE,
    '+-o IOBlockStorageDriver  <class IOBlockStorageDriver>\n    "Statistics" = {"Bytes (Read)"=4096,"Bytes (Write)"=8192}',
  ],
];

const CPUS = [
  { times: { user: 1000, nice: 20, sys: 300, idle: 5000, irq: 7 } },
  { times: { user: 2000, nice: 0, sys: 400, idle: 4000, irq: 3 } },
];

function exited(code: number, stdout: string): ProcessResult {
  return { code, stdout, stderr: '', timedOut: false };
}

// Every command scripted to succeed, then `failure`'s command scripted with its result.
function machine(failure?: [Command, ProcessResult | Error]): FakeProcesses {
  const processes = new FakeProcesses();
  for (const [[program, args], stdout] of STDOUTS) {
    processes.script(program, args, exited(0, stdout));
  }
  if (failure !== undefined) {
    const [[program, args], result] = failure;
    processes.script(program, args, result);
  }
  return processes;
}

describe('createMacSystemStats', () => {
  it('sample_AssemblesOneReadingFromEveryCommand', async () => {
    const processes = machine();
    const stats = createMacSystemStats(processes, () => CPUS);

    const sample = await stats.sample();

    expect(processes.runs.map((run) => run.timeoutMs)).toEqual(
      STDOUTS.map(() => 5000),
    );
    expect(sample).toEqual({
      cores: 2,
      cpuBusyMs: 3730,
      cpuTotalMs: 12730,
      memory: {
        totalBytes: 8589934592,
        usedBytes: 6553600,
        swapUsedBytes: 1610612736,
        pressure: 'warning',
      },
      gpuPercent: 37,
      network: { receivedBytes: 70000, sentBytes: 9000 },
      disk: { readBytes: 4096, writtenBytes: 8192 },
      processes: [
        {
          pid: 1,
          ppid: 0,
          name: 'launchd',
          path: '/sbin/launchd',
          cpuTimeMs: 180250,
          rssBytes: 2097152,
          gpuTimeNs: 0,
        },
        {
          pid: 300,
          ppid: 1,
          name: 'claude',
          path: '',
          cpuTimeMs: 1500,
          rssBytes: 1048576,
          gpuTimeNs: 5000,
        },
      ],
    });
  });

  it.each<{
    name: string;
    failure: [Command, ProcessResult | Error];
    error: RegExp;
  }>([
    {
      name: '/bin/ps exits 1',
      failure: [PS, exited(1, '')],
      error: /\/bin\/ps/,
    },
    {
      name: 'netstat times out',
      failure: [NETSTAT, { ...exited(-1, ''), timedOut: true }],
      error: /netstat/,
    },
    {
      name: 'vm_stat cannot run',
      failure: [VM_STAT, new Error('Could not run /usr/bin/vm_stat: ENOENT')],
      error: /vm_stat/,
    },
  ])('sample_ReadingFailure ($name rejects)', async ({ failure, error }) => {
    const stats = createMacSystemStats(machine(failure), () => CPUS);

    await expect(stats.sample()).rejects.toThrow(error);
  });

  it.each<{
    name: string;
    failure: [Command, ProcessResult | Error];
    expected: object;
  }>([
    {
      name: 'sysctl exits 1 with the full stdout',
      failure: [SYSCTL, exited(1, SYSCTL_STDOUT)],
      expected: { memory: { totalBytes: 8589934592 } },
    },
    {
      name: 'the IOAccelerator ioreg exits 1',
      failure: [ACCELERATORS, exited(1, '')],
      expected: {
        gpuPercent: null,
        processes: [{ gpuTimeNs: 0 }, { gpuTimeNs: 5000 }],
      },
    },
    {
      name: 'the AGXDeviceUserClient ioreg exits 1',
      failure: [GPU_CLIENTS, exited(1, '')],
      expected: { processes: [{ gpuTimeNs: null }, { gpuTimeNs: null }] },
    },
    {
      name: 'the AGXDeviceUserClient ioreg prints nothing',
      failure: [GPU_CLIENTS, exited(0, '')],
      expected: { processes: [{ gpuTimeNs: null }, { gpuTimeNs: null }] },
    },
  ])(
    'sample_ReadingFailure ($name resolves)',
    async ({ failure, expected }) => {
      const stats = createMacSystemStats(machine(failure), () => CPUS);

      expect(await stats.sample()).toMatchObject(expected);
    },
  );
});
