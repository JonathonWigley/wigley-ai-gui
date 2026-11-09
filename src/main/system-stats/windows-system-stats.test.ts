import { describe, expect, it } from 'vitest';
import type { ProcessResult } from '../../contracts/processes';
import { FakeProcesses } from '../../shared/fake-processes';
import {
  createWindowsSystemStats,
  WINDOWS_SAMPLE_SCRIPT,
} from './windows-system-stats';

const POWERSHELL = 'powershell.exe';
const POWERSHELL_ARGS = [
  '-NoProfile',
  '-NonInteractive',
  '-Command',
  WINDOWS_SAMPLE_SCRIPT,
];

const DOCUMENT = JSON.stringify({
  processes: [
    {
      pid: 4,
      ppid: 0,
      name: 'System',
      path: null,
      cpu100ns: 123456789,
      rss: 143360,
    },
  ],
  memory: { totalKb: 33435224, availableBytes: 12884901888, swapUsedMb: 2048 },
  gpu: null,
  network: { received: 987654321, sent: 123456789 },
  disk: { read: 55555555555, written: 4444444444 },
});

const CPUS = [
  { times: { user: 1000, nice: 0, sys: 300, idle: 5000, irq: 7 } },
  { times: { user: 2000, nice: 0, sys: 400, idle: 4000, irq: 3 } },
];

function exited(code: number, stdout: string, stderr = ''): ProcessResult {
  return { code, stdout, stderr, timedOut: false };
}

function powerShell(result: ProcessResult | Error): FakeProcesses {
  const processes = new FakeProcesses();
  processes.script(POWERSHELL, POWERSHELL_ARGS, result);
  return processes;
}

describe('createWindowsSystemStats', () => {
  it('sample_RunsTheScriptAndAddsCpuTotals', async () => {
    const processes = powerShell(exited(0, DOCUMENT));
    const stats = createWindowsSystemStats(processes, () => CPUS);

    const sample = await stats.sample();

    expect(sample).toMatchObject({
      cores: 2,
      cpuBusyMs: 3710,
      cpuTotalMs: 12710,
      processes: [{ pid: 4 }],
    });
    expect(processes.runs).toEqual([
      {
        command: POWERSHELL,
        args: POWERSHELL_ARGS,
        cwd: undefined,
        timeoutMs: 10000,
        unsetEnv: undefined,
      },
    ]);
  });

  it.each<{ name: string; result: ProcessResult | Error }>([
    {
      name: 'exits 1',
      result: exited(1, '', 'Get-CimInstance : Invalid class'),
    },
    { name: 'times out', result: { ...exited(-1, ''), timedOut: true } },
    {
      name: 'cannot run',
      result: new Error('Could not run powershell.exe: ENOENT'),
    },
  ])('sample_PowerShellFailure ($name)', async ({ result }) => {
    const stats = createWindowsSystemStats(powerShell(result), () => CPUS);

    await expect(stats.sample()).rejects.toThrow(/powershell\.exe/);
  });

  it('windowsSampleScript_HoldsNoDoubleQuote', () => {
    expect(WINDOWS_SAMPLE_SCRIPT).not.toContain('"');
  });
});
