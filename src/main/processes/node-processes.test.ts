import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ProcessRunOptions, SpawnExit } from '../../contracts/processes';
import { createNodeProcesses } from './node-processes';

const processes = createNodeProcesses();

// Runs `script` in the Node that runs the tests.
function runScript(script: string, options?: ProcessRunOptions) {
  return processes.run(process.execPath, ['-e', script], options);
}

// Spawns `command` with `args` in `env`, collecting its output and every
// `closed`; `ended` settles at the first `closed`.
function spawnCollecting(
  command: string,
  args: readonly string[],
  env: Readonly<Record<string, string>> = {},
) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const exits: SpawnExit[] = [];
  let resolveEnded: (exit: SpawnExit) => void = () => {};
  const ended = new Promise<SpawnExit>((resolve) => {
    resolveEnded = resolve;
  });
  const spawned = processes.spawn(command, args, {
    cwd: tmpdir(),
    env,
    events: {
      stdout: (chunk) => stdout.push(chunk),
      stderr: (chunk) => stderr.push(chunk),
      closed: (exit) => {
        exits.push(exit);
        resolveEnded(exit);
      },
    },
  });
  return { spawned, stdout, stderr, exits, ended };
}

// Waits a turn of the event loop, so a second `closed` would arrive.
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

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
    // Names of the test's own, so the absence proves the option on every OS.
    process.env.UNSET_ENV_TEST_DROPPED = '1';
    process.env.UNSET_ENV_TEST_KEPT = '1';
    try {
      const result = await runScript(
        'process.stdout.write(JSON.stringify(["UNSET_ENV_TEST_DROPPED" in process.env, "UNSET_ENV_TEST_KEPT" in process.env]))',
        { unsetEnv: ['UNSET_ENV_TEST_DROPPED'] },
      );

      expect(JSON.parse(result.stdout)).toEqual([false, true]);
    } finally {
      delete process.env.UNSET_ENV_TEST_DROPPED;
      delete process.env.UNSET_ENV_TEST_KEPT;
    }
  });

  it.each<{
    unsetEnv: string[] | undefined;
    setEnv: Record<string, string>;
    sees: (string | null)[];
  }>([
    {
      unsetEnv: ['SET_ENV_TEST_A', 'SET_ENV_TEST_B'],
      setEnv: { SET_ENV_TEST_A: '2' },
      sees: ['2', null, '1'],
    },
    {
      unsetEnv: undefined,
      setEnv: { SET_ENV_TEST_A: '3' },
      sees: ['3', '1', '1'],
    },
  ])(
    'run_SetEnv_SetsAfterUnset: unsetEnv $unsetEnv',
    async ({ unsetEnv, setEnv, sees }) => {
      process.env.SET_ENV_TEST_A = '1';
      process.env.SET_ENV_TEST_B = '1';
      process.env.SET_ENV_TEST_KEPT = '1';
      try {
        const result = await runScript(
          'const env = process.env; process.stdout.write(JSON.stringify([env.SET_ENV_TEST_A ?? null, env.SET_ENV_TEST_B ?? null, env.SET_ENV_TEST_KEPT ?? null]))',
          { unsetEnv, setEnv },
        );

        expect(JSON.parse(result.stdout)).toEqual(sees);
      } finally {
        delete process.env.SET_ENV_TEST_A;
        delete process.env.SET_ENV_TEST_B;
        delete process.env.SET_ENV_TEST_KEPT;
      }
    },
  );

  it('run_LargeOutput_KeepsPastOneMegabyte', async () => {
    const result = await runScript('process.stdout.write("x".repeat(2000000))');

    expect(result.stdout.length).toBe(2000000);
    expect(result.truncated).toBeUndefined();
  });

  it('run_OutputPastMaxOutputBytes_KeepsTheCapAndMarksTruncated', async () => {
    const result = await runScript(
      'process.stdout.write("x".repeat(2000000)); process.stderr.write("err")',
      { maxOutputBytes: 1000 },
    );

    expect(result).toEqual({
      code: 0,
      stdout: 'x'.repeat(1000),
      stderr: 'err',
      timedOut: false,
      truncated: true,
    });
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

  it(
    'startDetached_Started_AppendsOutputToTheLog',
    { timeout: 10000 },
    async () => {
      const dir = mkdtempSync(path.join(tmpdir(), 'wigley-node-processes-'));
      const logPath = path.join(dir, 'logs', 'run.log');
      const donePath = path.join(dir, 'done');
      try {
        mkdirSync(path.dirname(logPath));
        writeFileSync(logPath, 'before\n');
        await processes.startDetached(
          process.execPath,
          [
            '-e',
            `process.stdout.write("out "); process.stderr.write("err"); require("node:fs").writeFileSync(${JSON.stringify(donePath)}, "")`,
          ],
          { cwd: dir, logPath },
        );
        const deadline = Date.now() + 8000;
        while (!existsSync(donePath) && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }

        expect(readFileSync(logPath, 'utf8')).toBe('before\nout err');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );

  // The install it starts must outlive the app it quits, so it leads its own
  // process group.
  it.skipIf(process.platform === 'win32')(
    'startDetached_Started_LeadsItsOwnProcessGroup',
    { timeout: 10000 },
    async () => {
      const dir = mkdtempSync(path.join(tmpdir(), 'wigley-node-processes-'));
      const pidPath = path.join(dir, 'pid');
      try {
        await processes.startDetached(
          process.execPath,
          [
            '-e',
            `require("node:fs").writeFileSync(${JSON.stringify(pidPath)}, String(process.pid)); setTimeout(() => {}, 3000)`,
          ],
          { cwd: dir, logPath: path.join(dir, 'run.log') },
        );
        const deadline = Date.now() + 8000;
        while (!existsSync(pidPath) && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        const pid = readFileSync(pidPath, 'utf8');
        const groupOf = (target: string) =>
          execFileSync('ps', ['-o', 'pgid=', '-p', target], {
            encoding: 'utf8',
          }).trim();

        expect(groupOf(pid)).toBe(pid);
        expect(groupOf(String(process.pid))).not.toBe(pid);
        process.kill(-Number(pid), 'SIGKILL');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );

  it('startDetached_MissingProgram_RejectsNamingIt', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'wigley-node-processes-'));
    try {
      await expect(
        processes.startDetached('wigley-no-such-program', [], {
          logPath: path.join(dir, 'run.log'),
        }),
      ).rejects.toThrow('Could not run wigley-no-such-program');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('spawn_WritesAndStreams_ClosesWithTheCode', async () => {
    const run = spawnCollecting(process.execPath, [
      '-e',
      'process.stdin.pipe(process.stdout); process.stderr.write("err"); process.stdin.on("end", () => process.exit(3))',
    ]);

    run.spawned.write('hello\n');
    run.spawned.endInput();
    await run.ended;
    await settle();

    expect(run.stdout.join('')).toBe('hello\n');
    expect(run.stderr.join('')).toBe('err');
    expect(run.exits).toEqual([{ code: 3, signal: null, startError: null }]);
  });

  it('spawn_Env_IsTheWholeEnvironment', async () => {
    const run = spawnCollecting(
      process.execPath,
      ['-e', 'process.stdout.write(`${process.env.ONLY} ${process.env.HOME}`)'],
      { ONLY: 'x' },
    );

    await run.ended;

    expect(run.stdout.join('')).toBe('x undefined');
  });

  it('spawn_Kill_ClosesWithTheSignal', async () => {
    const run = spawnCollecting(process.execPath, [
      '-e',
      'setTimeout(() => {}, 60000)',
    ]);

    run.spawned.kill('SIGKILL');
    const exit = await run.ended;

    expect(exit).toEqual({ code: null, signal: 'SIGKILL', startError: null });
    expect(() => run.spawned.write('x')).not.toThrow();
  });

  it('spawn_MissingProgram_ClosesOnceNotFound', async () => {
    const run = spawnCollecting('/no/such/program', []);

    await run.ended;
    await settle();

    expect(run.exits).toHaveLength(1);
    expect(run.exits[0]).toMatchObject({
      code: null,
      signal: null,
      startError: { notFound: true },
    });
    expect(run.exits[0].startError?.message).toContain('ENOENT');
  });
});
