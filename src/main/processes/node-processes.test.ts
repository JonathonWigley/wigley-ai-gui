import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ProcessRunOptions } from '../../contracts/processes';
import { createNodeProcesses } from './node-processes';

const processes = createNodeProcesses();

// Runs `script` in the Node that runs the tests.
function runScript(script: string, options?: ProcessRunOptions) {
  return processes.run(process.execPath, ['-e', script], options);
}

describe('createNodeProcesses', () => {
  it('run_ExitThree_ReturnsCodeAndOutput', async () => {
    const result = await runScript(
      'process.stdout.write("out"); process.stderr.write("err"); process.exit(3)',
    );

    expect(result).toEqual({
      code: 3,
      stdout: 'out',
      stderr: 'err',
      timedOut: false,
    });
  });

  it(
    'run_PastTimeout_KillsAndResolvesTimedOut',
    { timeout: 10000 },
    async () => {
      const started = Date.now();

      const result = await runScript(
        'process.stdout.write("partial"); setTimeout(() => {}, 60000)',
        { timeoutMs: 3000 },
      );

      expect(result).toEqual({
        code: -1,
        stdout: 'partial',
        stderr: '',
        timedOut: true,
      });
      expect(Date.now() - started).toBeLessThan(5000);
    },
  );

  it.each([
    { case: 'before the run', abortsFirst: true },
    { case: 'while it runs', abortsFirst: false },
  ])(
    'run_Aborted_RejectsStopped ($case)',
    { timeout: 10000 },
    async ({ abortsFirst }) => {
      const controller = new AbortController();
      const started = Date.now();
      if (abortsFirst) {
        controller.abort();
      }

      const run = runScript('setTimeout(() => {}, 60000)', {
        signal: controller.signal,
      });
      controller.abort();

      await expect(run).rejects.toThrow(`Stopped ${process.execPath}`);
      expect(Date.now() - started).toBeLessThan(5000);
    },
  );

  it('run_EndsBeforeTimeout_NotTimedOut', async () => {
    const result = await runScript('process.exit(0)', { timeoutMs: 10000 });

    expect(result.code).toBe(0);
    expect(result.timedOut).toBe(false);
  });

  it('run_Cwd_RunsInTheFolder', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'wigley-node-processes-'));
    try {
      const result = await runScript('process.stdout.write(process.cwd())', {
        cwd: dir,
      });

      expect(result.stdout).toBe(realpathSync(dir));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('run_UnsetEnv_DropsOnlyThoseNames', async () => {
    const result = await runScript(
      'process.stdout.write(JSON.stringify(["HOME" in process.env, "PATH" in process.env]))',
      { unsetEnv: ['HOME'] },
    );

    expect(JSON.parse(result.stdout)).toEqual([false, true]);
  });

  it('run_LargeOutput_KeepsPastOneMegabyte', async () => {
    const result = await runScript('process.stdout.write("x".repeat(2000000))');

    expect(result.stdout.length).toBe(2000000);
  });

  it('run_MissingProgram_RejectsNamingIt', async () => {
    await expect(processes.run('wigley-no-such-program', [])).rejects.toThrow(
      'wigley-no-such-program',
    );
  });

  it('run_MissingCwd_RejectsNamingTheFolder', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'wigley-node-processes-'));
    rmSync(dir, { recursive: true, force: true });

    await expect(runScript('', { cwd: dir })).rejects.toThrow(dir);
  });
});
