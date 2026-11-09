import { describe, expect, it } from 'vitest';
import {
  parseBlockStorage,
  parseDeviceUtilisation,
  parseGpuTimes,
  parseNetstat,
  parsePs,
  parseSysctl,
  parseVmStatUsedBytes,
} from './mac-parsers';

// Captured on an M2 Max, macOS 26, on 2026-11-09, and cut down.

const VM_STAT_16K_HEADER =
  'Mach Virtual Memory Statistics: (page size of 16384 bytes)';

const ACCELERATOR_22 =
  '+-o AGXAcceleratorG14X  <class AGXAcceleratorG14X, id 0x100000a1b, registered, matched, active, busy 0 (0 ms), retain 85>\n' +
  '    "PerformanceStatistics" = {"Tiler Utilization %"=22,"Renderer Utilization %"=22,"Device Utilization %"=22,"SplitSceneCount"=0}';

const GPU_CLIENT_HEADER =
  '+-o AGXDeviceUserClient  <class AGXDeviceUserClient, id 0x10000c2f1, !registered, !matched, active, busy 0, retain 5>';

const BLOCK_STORAGE_HEADER =
  '+-o IOBlockStorageDriver  <class IOBlockStorageDriver, id 0x100000412, registered, matched, active, busy 0 (0 ms), retain 7>';

const NETSTAT_HEADER =
  'Name       Mtu   Network       Address            Ipkts Ierrs     Ibytes    Opkts Oerrs     Obytes  Coll';

describe('mac-parsers', () => {
  it('parsePs_ReadsEachProcessLine', () => {
    const stdout = [
      '    1     0 178:05.54  10064 /sbin/launchd',
      '  521     1   2:12.49  12992 /Applications/Splashtop Streamer.app/Contents/MacOS/SRStreamerDaemon',
      '  526     1   3:16.72   6320 Core Audio Driver (BlackHole2ch.driver)',
      ' 7154 19058   0:00.03  22608 (Python)',
      'not a process line',
    ].join('\n');

    expect(parsePs(stdout)).toEqual([
      {
        pid: 1,
        ppid: 0,
        name: 'launchd',
        path: '/sbin/launchd',
        cpuTimeMs: 10685540,
        rssBytes: 10305536,
      },
      {
        pid: 521,
        ppid: 1,
        name: 'SRStreamerDaemon',
        path: '/Applications/Splashtop Streamer.app/Contents/MacOS/SRStreamerDaemon',
        cpuTimeMs: 132490,
        rssBytes: 13303808,
      },
      {
        pid: 526,
        ppid: 1,
        name: 'Core Audio Driver (BlackHole2ch.driver)',
        path: '',
        cpuTimeMs: 196720,
        rssBytes: 6471680,
      },
      {
        pid: 7154,
        ppid: 19058,
        name: '(Python)',
        path: '',
        cpuTimeMs: 30,
        rssBytes: 23150592,
      },
    ]);
  });

  it.each([
    {
      name: '16 KiB pages',
      stdout: [
        VM_STAT_16K_HEADER,
        'Pages free:                              169736.',
        'Pages wired down:                        254080.',
        'Pages purgeable:                           2786.',
        'Anonymous pages:                         328136.',
        'Pages occupied by compressor:            994944.',
      ].join('\n'),
      expected: 25794543616,
    },
    {
      name: '4 KiB pages',
      stdout: [
        'Mach Virtual Memory Statistics: (page size of 4096 bytes)',
        'Pages wired down:                           500.',
        'Pages purgeable:                            100.',
        'Anonymous pages:                           1000.',
        'Pages occupied by compressor:               200.',
      ].join('\n'),
      expected: 6553600,
    },
  ])(
    'parseVmStatUsedBytes_CountsAppWiredAndCompressed ($name)',
    ({ stdout, expected }) => {
      expect(parseVmStatUsedBytes(stdout)).toBe(expected);
    },
  );

  it('parseVmStatUsedBytes_CountsAppWiredAndCompressed (no Anonymous pages line throws)', () => {
    const stdout = [
      VM_STAT_16K_HEADER,
      'Pages wired down:                        254080.',
      'Pages purgeable:                           2786.',
      'Pages occupied by compressor:            994944.',
    ].join('\n');

    expect(() => parseVmStatUsedBytes(stdout)).toThrow(/vm_stat/);
  });

  it.each([
    {
      stdout:
        'hw.memsize: 34359738368\nvm.swapusage: total = 20480.00M  used = 19225.31M  free = 1254.69M  (encrypted)\nkern.memorystatus_vm_pressure_level: 2',
      expected: {
        totalBytes: 34359738368,
        swapUsedBytes: 20159198659,
        pressure: 'warning',
      },
    },
    {
      stdout:
        'hw.memsize: 17179869184\nvm.swapusage: total = 2048.00M  used = 0.00M  free = 2048.00M  (encrypted)\nkern.memorystatus_vm_pressure_level: 4',
      expected: {
        totalBytes: 17179869184,
        swapUsedBytes: 0,
        pressure: 'critical',
      },
    },
    {
      stdout:
        'hw.memsize: 8589934592\nvm.swapusage: total = 3.00G  used = 1.50G  free = 1.50G  (encrypted)\nkern.memorystatus_vm_pressure_level: 1',
      expected: {
        totalBytes: 8589934592,
        swapUsedBytes: 1610612736,
        pressure: 'normal',
      },
    },
    {
      stdout:
        'hw.memsize: 8589934592\nvm.swapusage: total = 3.00G  used = 1.50G  free = 1.50G  (encrypted)',
      expected: {
        totalBytes: 8589934592,
        swapUsedBytes: 1610612736,
        pressure: null,
      },
    },
    {
      stdout: 'hw.memsize: 8589934592\nkern.memorystatus_vm_pressure_level: 0',
      expected: { totalBytes: 8589934592, swapUsedBytes: 0, pressure: null },
    },
  ])(
    'parseSysctl_ReadsTotalSwapAndPressure ($expected)',
    ({ stdout, expected }) => {
      expect(parseSysctl(stdout)).toEqual(expected);
    },
  );

  it('parseSysctl_ReadsTotalSwapAndPressure (no hw.memsize throws)', () => {
    expect(() =>
      parseSysctl('vm.swapusage: total = 3.00G  used = 1.50G  free = 1.50G'),
    ).toThrow(/sysctl/);
  });

  it.each([
    { name: 'one accelerator', stdout: ACCELERATOR_22, expected: 22 },
    {
      name: 'two accelerators',
      stdout: [
        ACCELERATOR_22,
        '+-o AGXAcceleratorG14X  <class AGXAcceleratorG14X, id 0x100000a1c>',
        '    "PerformanceStatistics" = {"Tiler Utilization %"=41,"Device Utilization %"=41}',
      ].join('\n'),
      expected: 41,
    },
    {
      name: 'no PerformanceStatistics',
      stdout:
        '+-o AGXAcceleratorG14X  <class AGXAcceleratorG14X, id 0x100000a1b>\n    "IOClass" = "AGXAcceleratorG14X"',
      expected: null,
    },
  ])(
    'parseDeviceUtilisation_TakesTheHighestAccelerator ($name)',
    ({ stdout, expected }) => {
      expect(parseDeviceUtilisation(stdout)).toBe(expected);
    },
  );

  it.each([
    {
      name: 'four clients',
      stdout: [
        GPU_CLIENT_HEADER,
        '    "AppUsage" = ({"API"="Metal","lastSubmittedTime"=1023476042612375,"accumulatedGPUTime"=19573540866708},{"API"="Metal","lastSubmittedTime"=1016434221431375,"accumulatedGPUTime"=192926375})',
        '    "IOUserClientCreator" = "pid 404, WindowServer"',
        GPU_CLIENT_HEADER,
        '    "AppUsage" = ()',
        '    "IOUserClientCreator" = "pid 404, WindowServer"',
        GPU_CLIENT_HEADER,
        '    "AppUsage" = ({"API"="Metal","lastSubmittedTime"=981394498800291,"accumulatedGPUTime"=16928291})',
        '    "IOUserClientCreator" = "pid 15342, Notion Calendar "',
        GPU_CLIENT_HEADER,
        '    "AppUsage" = ()',
        '    "IOUserClientCreator" = "pid 407, runningboardd"',
      ].join('\n'),
      expected: [
        [404, 19573733793083],
        [15342, 16928291],
        [407, 0],
      ],
    },
    { name: 'empty output', stdout: '', expected: [] },
  ])('parseGpuTimes_SumsEachPidsClients ($name)', ({ stdout, expected }) => {
    expect([...parseGpuTimes(stdout)]).toEqual(expected);
  });

  it.each([
    {
      name: 'en0 and en7 only',
      stdout: [
        NETSTAT_HEADER,
        'lo0        16384 <Link#1>                      12269687     0 14475283033 12269687     0 14475283033     0',
        'lo0        16384 127           127.0.0.1       12269687     - 14475283033 12269687     - 14475283033     -',
        'en0        1500  <Link#14>   fa:2f:f9:2b:4d:f6 57002800     0 44908680502 37582319     0 16569714501     0',
        'en0        1500  192.168.1     192.168.1.20    57002800     - 44908680502 37582319     - 16569714501     -',
        'utun0      1380  <Link#18>                            0     0          0     2395     0     162781     0',
        'bridge0    1500  <Link#15>   36:e9:70:32:96:c0        0     0      70000        0     0      90000     0',
        'en7        1500  <Link#23>   6c:6e:07:12:b6:5c 22756893     0 17956098904 14704677     0 5235511512     0',
      ].join('\n'),
      expected: { receivedBytes: 62864779406, sentBytes: 21805226013 },
    },
    {
      name: 'header only',
      stdout: NETSTAT_HEADER,
      expected: { receivedBytes: 0, sentBytes: 0 },
    },
  ])('parseNetstat_SumsPhysicalLinkRows ($name)', ({ stdout, expected }) => {
    expect(parseNetstat(stdout)).toEqual(expected);
  });

  it.each([
    {
      name: 'two drivers',
      stdout: [
        BLOCK_STORAGE_HEADER,
        '    "Statistics" = {"Operations (Write)"=138447617,"Bytes (Read)"=109060200710144,"Bytes (Write)"=7874327449600,"Operations (Read)"=23440236787}',
        BLOCK_STORAGE_HEADER,
        '    "Statistics" = {"Bytes (Read)"=371620864,"Bytes (Write)"=0}',
      ].join('\n'),
      expected: { readBytes: 109060572331008, writtenBytes: 7874327449600 },
    },
    {
      name: 'empty output',
      stdout: '',
      expected: { readBytes: 0, writtenBytes: 0 },
    },
  ])('parseBlockStorage_SumsEveryDriver ($name)', ({ stdout, expected }) => {
    expect(parseBlockStorage(stdout)).toEqual(expected);
  });

  it('parseBlockStorage_SumsEveryDriver (a driver with no Statistics throws)', () => {
    const stdout = `${BLOCK_STORAGE_HEADER}\n    "IOClass" = "IOBlockStorageDriver"`;

    expect(() => parseBlockStorage(stdout)).toThrow(/ioreg/);
  });
});
