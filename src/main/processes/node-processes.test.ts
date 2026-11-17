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
import { type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import type { FileStat } from '../../contracts/files';
import type {
  ProcessRunner,
  ProcessRunOptions,
  SpawnExit,
} from '../../contracts/processes';
import { posixPaths } from '../../shared/paths/posix-paths';
import { windowsPaths } from '../../shared/paths/windows-paths';
import { fakePlatform } from '../../shared/platform.test-support';
import { createNodeProcesses, type StartProgram } from './node-processes';
import { hostNodeProcesses } from './node-processes.test-support';

const processes = hostNodeProcesses();

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

  // Breaks when `setEnv` is dropped, or an unset `logPath` is opened as a file.
  it(
    'startDetached_NoLogPath_StartsWithTheSetEnv',
    { timeout: 10000 },
    async () => {
      const dir = mkdtempSync(path.join(tmpdir(), 'wigley-node-processes-'));
      const seenPath = path.join(dir, 'seen');
      try {
        await processes.startDetached(
          process.execPath,
          [
            '-e',
            'require("node:fs").writeFileSync(process.argv[1], String(process.env.DETACHED_ENV_TEST))',
            seenPath,
          ],
          { setEnv: { DETACHED_ENV_TEST: 'yes' } },
        );

        await vi.waitFor(
          () => expect(readFileSync(seenPath, 'utf8')).toBe('yes'),
          { timeout: 8000 },
        );
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );

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

describe('resolveProgram', () => {
  it.each<{
    setting: string;
    python: { command: string; args: string[] }[];
    expected: { command: string; args: string[] } | null;
  }>([
    {
      setting: '~/py',
      python: [{ command: process.execPath, args: [] }],
      expected: { command: '/h/py', args: [] },
    },
    {
      setting: '',
      python: [{ command: 'wigley-no-such-python', args: [] }],
      expected: null,
    },
    {
      setting: '',
      python: [
        { command: 'wigley-no-such-python', args: [] },
        { command: process.execPath, args: ['-v'] },
      ],
      expected: { command: process.execPath, args: ['-v'] },
    },
  ])(
    'resolves python from setting "$setting" as $expected',
    async ({ setting, python, expected }) => {
      const runner = hostNodeProcesses({
        paths: posixPaths,
        homeDir: '/h',
        programs: { python, claude: [] },
        programSetting: (name) => (name === 'python' ? setting : ''),
      });

      expect(await runner.resolveProgram('python')).toEqual(expected);
    },
  );
});

// A child the Windows branch starts in place of a real one: its stdin
// records each write and end, and a kill records its signal.
function fakeChild() {
  const stdinCalls: string[] = [];
  const child = Object.assign(new EventEmitter(), {
    pid: 7 as number | undefined,
    stdin: Object.assign(new EventEmitter(), {
      write: (text: string) => stdinCalls.push(`write ${text}`),
      end: () => stdinCalls.push('end'),
    }),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kills: [] as string[],
    kill(signal: string) {
      child.kills.push(signal);
      return true;
    },
    unref() {},
  });
  return { child, stdinCalls };
}

interface Started {
  file: string;
  args: readonly string[];
  options: Parameters<StartProgram>[2];
  child: ReturnType<typeof fakeChild>;
}

const COM_SPEC = 'C:\\Windows\\system32\\cmd.exe';
const WINDOWS_PATH = { PATH: 'C:\\T', PATHEXT: '.EXE;.CMD' };
// The host's own PATH names, so the lookup reads only `WINDOWS_PATH`.
const HOST_PATH_NAMES = ['PATH', 'Path', 'PATHEXT'];

// The node adapter on Windows over a `stat` of `present` files and a `start`
// that records each start and hands a fake child, which starts on a
// microtask. `holdStats` makes every `stat` wait until `releaseStats`.
function windowsSetUp(present: string[], holdStats = false) {
  const started: Started[] = [];
  const statted: string[] = [];
  const held: (() => void)[] = [];
  let failsNextStart = false;
  const stat = async (file: string): Promise<FileStat | null> => {
    statted.push(file);
    if (holdStats) {
      await new Promise<void>((resolve) => held.push(resolve));
    }
    return present.includes(file) ? { isFolder: false, isLink: false } : null;
  };
  const start: StartProgram = (file, args, options) => {
    const fake = fakeChild();
    started.push({ file, args, options, child: fake });
    const { child } = fake;
    if (failsNextStart) {
      failsNextStart = false;
      child.pid = undefined;
      queueMicrotask(() =>
        child.emit(
          'error',
          Object.assign(new Error(`spawn ${file} ENOENT`), { code: 'ENOENT' }),
        ),
      );
    } else {
      queueMicrotask(() => child.emit('spawn'));
    }
    return child as unknown as ChildProcess;
  };
  const runner = createNodeProcesses({
    files: { stat },
    paths: windowsPaths,
    os: 'windows',
    homeDir: 'C:\\Users\\u',
    programs: fakePlatform('windows').programs,
    programSetting: () => '',
    start,
  });
  return {
    runner,
    started,
    statted,
    releaseStats: () => held.splice(0).forEach((release) => release()),
    failNextStart: () => {
      failsNextStart = true;
    },
  };
}

// Runs `command` on the Windows PATH and ends its child with exit 0 once it
// starts; a child whose start fails is left to its `error`. Settles with the
// rejection's message, if any.
async function runToExit(
  setUp: ReturnType<typeof windowsSetUp>,
  command: string,
): Promise<string | null> {
  const startsBefore = setUp.started.length;
  const run = setUp.runner.run(command, [], {
    unsetEnv: HOST_PATH_NAMES,
    setEnv: WINDOWS_PATH,
  });
  await vi.waitFor(() => expect(setUp.started.length).toBe(startsBefore + 1));
  const { child } = setUp.started[startsBefore].child;
  if (child.pid !== undefined) {
    child.emit('close', 0);
  }
  return run.then(
    () => null,
    (error: Error) => error.message,
  );
}

function spawnOn(runner: ProcessRunner, command: string, exits: SpawnExit[]) {
  return runner.spawn(command, ['a'], {
    cwd: 'C:\\',
    env: WINDOWS_PATH,
    events: {
      stdout() {},
      stderr() {},
      closed: (exit) => exits.push(exit),
    },
  });
}

describe('createNodeProcesses on Windows', () => {
  const comSpecBefore = process.env.ComSpec;

  // ComSpec is read from the app's environment at each start.
  function withComSpec<T>(body: () => Promise<T>): Promise<T> {
    process.env.ComSpec = COM_SPEC;
    return body().finally(() => {
      if (comSpecBefore === undefined) {
        delete process.env.ComSpec;
      } else {
        process.env.ComSpec = comSpecBefore;
      }
    });
  }

  it.each<{
    name: string;
    present: string;
    begin: (runner: ProcessRunner) => unknown;
    expected: {
      file: string;
      args: string[];
      windowsVerbatimArguments: boolean;
      detached?: boolean;
    };
  }>([
    {
      name: 'run of an .exe',
      present: 'C:\\T\\git.EXE',
      begin: (runner) =>
        runner.run('git', ['a'], {
          unsetEnv: HOST_PATH_NAMES,
          setEnv: WINDOWS_PATH,
        }),
      expected: {
        file: 'C:\\T\\git.EXE',
        args: ['a'],
        windowsVerbatimArguments: false,
      },
    },
    {
      name: 'run of a .cmd',
      present: 'C:\\T\\tool.CMD',
      begin: (runner) =>
        runner.run('tool', ['a'], {
          unsetEnv: HOST_PATH_NAMES,
          setEnv: WINDOWS_PATH,
        }),
      expected: {
        file: COM_SPEC,
        args: ['/d', '/s', '/c', '"C:\\T\\tool.CMD ^"a^""'],
        windowsVerbatimArguments: true,
      },
    },
    {
      name: 'spawn of a .cmd, looked up in its env',
      present: 'C:\\T\\tool.CMD',
      begin: (runner) => spawnOn(runner, 'tool', []),
      expected: {
        file: COM_SPEC,
        args: ['/d', '/s', '/c', '"C:\\T\\tool.CMD ^"a^""'],
        windowsVerbatimArguments: true,
      },
    },
    {
      name: 'startDetached of a .cmd, looked up in its setEnv',
      present: 'C:\\T\\tool.CMD',
      begin: (runner) =>
        runner.startDetached('tool', ['a'], { setEnv: WINDOWS_PATH }),
      expected: {
        file: COM_SPEC,
        args: ['/d', '/s', '/c', '"C:\\T\\tool.CMD ^"a^""'],
        windowsVerbatimArguments: true,
        detached: true,
      },
    },
  ])('starts the $name as Node is handed it', ({ present, begin, expected }) =>
    withComSpec(async () => {
      const setUp = windowsSetUp([present]);

      void Promise.resolve(begin(setUp.runner)).catch(() => {});
      await vi.waitFor(() => expect(setUp.started).toHaveLength(1));

      const [{ file, args, options }] = setUp.started;
      expect({
        file,
        args,
        windowsVerbatimArguments: options.windowsVerbatimArguments,
        ...(expected.detached === undefined
          ? {}
          : { detached: options.detached }),
      }).toEqual(expected);
    }),
  );

  it('looks a command up once, and again after a start of it fails', async () => {
    const setUp = windowsSetUp(['C:\\T\\git.EXE']);

    await runToExit(setUp, 'git');
    const afterFirst = setUp.statted.length;
    await runToExit(setUp, 'git');
    const afterSecond = setUp.statted.length;
    setUp.failNextStart();
    expect(await runToExit(setUp, 'git')).toContain('Could not run git');
    const afterFailed = setUp.statted.length;
    await runToExit(setUp, 'git');

    expect(afterFirst).toBeGreaterThan(0);
    expect(afterSecond).toBe(afterFirst);
    expect(afterFailed).toBe(afterFirst);
    expect(setUp.statted.length).toBeGreaterThan(afterFailed);
  });

  it('rejects Stopped and starts nothing when the signal aborts during the lookup', async () => {
    const setUp = windowsSetUp(['C:\\T\\git.EXE'], true);
    const controller = new AbortController();

    const run = setUp.runner.run('git', [], {
      signal: controller.signal,
      unsetEnv: HOST_PATH_NAMES,
      setEnv: WINDOWS_PATH,
    });
    await vi.waitFor(() => expect(setUp.statted.length).toBeGreaterThan(0));
    controller.abort();
    setUp.releaseStats();

    await expect(run).rejects.toThrow('Stopped git');
    expect(setUp.started).toEqual([]);
  });

  it('applies a write and an endInput made before the start, in order', async () => {
    const setUp = windowsSetUp(['C:\\T\\tool.EXE'], true);

    const spawned = spawnOn(setUp.runner, 'tool', []);
    spawned.write('one');
    spawned.write('two');
    spawned.endInput();
    await vi.waitFor(() => expect(setUp.statted.length).toBeGreaterThan(0));
    setUp.releaseStats();
    await vi.waitFor(() => expect(setUp.started).toHaveLength(1));

    expect(setUp.started[0].child.stdinCalls).toEqual([
      'write one',
      'write two',
      'end',
    ]);
  });

  it('closes with the signal and starts nothing on a kill before the start', async () => {
    const setUp = windowsSetUp(['C:\\T\\tool.EXE'], true);
    const exits: SpawnExit[] = [];

    const spawned = spawnOn(setUp.runner, 'tool', exits);
    spawned.kill('SIGKILL');
    await vi.waitFor(() => expect(setUp.statted.length).toBeGreaterThan(0));
    setUp.releaseStats();
    await settle();

    expect(exits).toEqual([
      { code: null, signal: 'SIGKILL', startError: null },
    ]);
    expect(setUp.started).toEqual([]);
  });
});
