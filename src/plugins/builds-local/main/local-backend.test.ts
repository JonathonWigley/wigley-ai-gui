import { describe, expect, it, vi } from 'vitest';
import type { Git } from '../../../contracts/git';
import type { ProcessResult } from '../../../contracts/processes';
import { FakeProcesses } from '../../../shared/fake-processes';
import { fakeTimers } from '../../../shared/fake-timers.test-support';
import { createMemoryFiles } from '../../../shared/memory-files';
import { posixPaths } from '../../../shared/paths/posix-paths';
import { windowsPaths } from '../../../shared/paths/windows-paths';
import { fakePlatform } from '../../../shared/platform.test-support';
import { deferred } from '../../../shared/plugin-part-harness.test-support';
import type {
  BackendEntry,
  BackendServices,
  BuildBackend,
  BuildRecord,
  GameEntry,
} from '../../builds/contract';
import { KEPT_RUNS, localBackendKind, PID_GRACE_MS } from './local-backend';

// Written out, not imported, so a changed script turns the queue test red.
const POSIX_WRAPPER =
  'echo $$ > "$1"; exit_file="$2"; shift 2; "$@"; code=$?; echo "$code" > "$exit_file.tmp"; mv "$exit_file.tmp" "$exit_file"';
const REVISION = '2993a9e4b92724916453c6e2a3257c4838ce0777';
const FIRST_ID = 'demo/ok/1000000';
const FIRST_FOLDER = `runs/${FIRST_ID}`;
const PS_ARGS = ['-o', 'command=', '-p', '4321'];
const KILL_ARGS = ['-TERM', '--', '-4321'];
const QUEUE_OK = { kind: 'ok', branch: 'ignored', revision: null };
const QUEUE_BAD = { kind: 'bad', branch: 'ignored', revision: null };
const KINDS: GameEntry['kinds'] = {
  ok: {
    label: 'OK',
    target: { command: './build.sh', args: ['--env', 'dev'] },
    downloads: [],
  },
  bad: {
    label: 'Bad',
    target: { command: './fail.sh', args: [] },
    downloads: [],
  },
};

function result(fields: Partial<ProcessResult>): ProcessResult {
  return { code: 0, stdout: '', stderr: '', timedOut: false, ...fields };
}

// The alive check's answer on macOS while the wrapper of the run `id` holds pid 4321.
function aliveAnswer(id: string): ProcessResult {
  return result({
    stdout: `/bin/sh -c sh-script builds-local /data/runs/${id}/pid /data/runs/${id}/exit-code ./build.sh --env dev\n`,
  });
}

// The scripted answers of the alive check of pid 4321 on macOS.
const ALIVE = aliveAnswer(FIRST_ID);
const ANOTHER_PROGRAM = result({ stdout: '/usr/bin/vim notes.txt\n' });
const GONE = result({ code: 1 });
const TIMED_OUT = result({ code: -1, timedOut: true });
const REJECTS = new Error('Could not run ps: ENOENT');

function testGame(overrides: Partial<GameEntry> = {}): GameEntry {
  return {
    id: 'demo',
    label: 'Demo',
    clone: '/clones/demo',
    defaultBranch: 'main',
    kinds: KINDS,
    sets: [],
    ...overrides,
  };
}

function testEntry(game: GameEntry, config: unknown = {}): BackendEntry {
  return { id: 'home', kind: 'local', label: 'Home', config, games: [game] };
}

// One run as `runs.json` keeps it, finished unless `finishedAt` is null.
function storedRun(
  kind: string,
  startedAt: number,
  finishedAt: number | null,
  exitCode: number | null,
) {
  return {
    id: `demo/${kind}/${startedAt}`,
    gameId: 'demo',
    kind,
    branch: 'main',
    revision: null,
    startedAt,
    finishedAt,
    exitCode,
    cancelled: false,
    lastLine: null,
  };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

function setup(os: 'macos' | 'windows' = 'macos') {
  let now = 0;
  const clock = { now: () => now };
  const processes = new FakeProcesses();
  const dataFiles = createMemoryFiles(clock);
  const git = {
    currentBranch: vi.fn(async (): Promise<string | null> => 'feature/x'),
    resolveCommit: vi.fn(async (): Promise<string | null> => REVISION),
  } as Partial<Git> as Git;
  const logs: string[] = [];
  const isWindows = os === 'windows';
  const services: BackendServices = {
    processes,
    git,
    files: createMemoryFiles(clock),
    dataFiles,
    dataFolder: isWindows ? 'C:\\data' : '/data',
    paths: isWindows ? windowsPaths : posixPaths,
    clock,
    timers: fakeTimers().timers,
    homeDir: isWindows ? 'C:\\Users\\u' : '/Users/u',
    platform: fakePlatform(os),
    log: (message) => logs.push(message),
  };
  const game = testGame(isWindows ? { clone: 'C:\\clones\\demo' } : {});
  const create = async (): Promise<BuildBackend> => {
    const made = await localBackendKind.create(testEntry(game), services);
    if ('problem' in made) {
      throw new Error(made.problem);
    }
    return made;
  };
  const setClock = (ms: number) => {
    now = ms;
  };
  const writeRunsJson = (runs: unknown[]) =>
    dataFiles.write('runs.json', JSON.stringify({ runs }));
  const storedRuns = async () =>
    JSON.parse(await dataFiles.read('runs.json')).runs as {
      id: string;
      finishedAt: number | null;
      exitCode: number | null;
      lastLine: string | null;
    }[];
  const recordOf = async (
    backend: BuildBackend,
    id: string,
  ): Promise<BuildRecord | undefined> =>
    (await backend.list(game, 20)).find((record) => record.id === id);
  // Queues `ok` at clock 1_000_000 with its pid file written, the alive check scripted as `aliveCheck`.
  const startFirstRun = async (aliveCheck: ProcessResult | Error = ALIVE) => {
    const backend = await create();
    setClock(1_000_000);
    await backend.queue(game, QUEUE_OK);
    await dataFiles.write(`${FIRST_FOLDER}/pid`, '4321\n');
    processes.script('ps', PS_ARGS, aliveCheck);
    return backend;
  };
  const commandsRun = () => processes.runs.map(({ command }) => command);
  return {
    processes,
    dataFiles,
    git,
    logs,
    services,
    game,
    create,
    setClock,
    writeRunsJson,
    storedRuns,
    recordOf,
    startFirstRun,
    commandsRun,
  };
}

describe('localBackendKind.create', () => {
  it.each<{
    name: string;
    game?: Partial<GameEntry>;
    config?: unknown;
    contains: string[];
  }>([
    {
      name: 'a config that is not an object',
      config: [],
      contains: ['config'],
    },
    {
      name: 'a game with no clone',
      game: { clone: null },
      contains: ['demo'],
    },
    {
      name: 'a target with no command',
      game: {
        kinds: {
          ...KINDS,
          ok: { label: 'OK', target: { args: [] }, downloads: [] },
        },
      },
      contains: ['demo', 'ok'],
    },
    {
      name: 'an empty command',
      game: {
        kinds: {
          ...KINDS,
          ok: {
            label: 'OK',
            target: { command: '', args: [] },
            downloads: [],
          },
        },
      },
      contains: ['demo', 'ok'],
    },
    {
      name: 'args that are not strings',
      game: {
        kinds: {
          ...KINDS,
          bad: {
            label: 'Bad',
            target: { command: './fail.sh', args: [1] },
            downloads: [],
          },
        },
      },
      contains: ['demo', 'bad'],
    },
    {
      name: 'a target that is a string',
      game: {
        kinds: {
          ...KINDS,
          bad: { label: 'Bad', target: './fail.sh', downloads: [] },
        },
      },
      contains: ['demo', 'bad'],
    },
    { name: 'a game id with a slash', game: { id: 'a/b' }, contains: ['a/b'] },
    { name: 'a game id of ..', game: { id: '..' }, contains: ['..'] },
    {
      name: 'a game id with a colon',
      game: { id: 'c:demo' },
      contains: ['c:demo'],
    },
    {
      name: 'a kind key that climbs',
      game: { kinds: { ...KINDS, '../x': KINDS.ok } },
      contains: ['demo', '../x'],
    },
    {
      name: 'a kind key of .',
      game: { kinds: { ...KINDS, '.': KINDS.ok } },
      contains: ['demo', '.'],
    },
    {
      name: 'a newline in an arg',
      game: {
        kinds: {
          ...KINDS,
          ok: {
            label: 'OK',
            target: { command: './build.sh', args: ['--env\ndev'] },
            downloads: [],
          },
        },
      },
      contains: ['demo', 'ok'],
    },
    {
      name: 'a newline in the command',
      game: {
        kinds: {
          ...KINDS,
          ok: {
            label: 'OK',
            target: { command: './build.sh\r', args: [] },
            downloads: [],
          },
        },
      },
      contains: ['demo', 'ok'],
    },
  ])('gives a problem for $name', async ({ game, config, contains }) => {
    const { services } = setup();

    const made = await localBackendKind.create(
      testEntry(testGame(game), config ?? {}),
      services,
    );

    expect(made).toEqual({ problem: expect.any(String) });
    const { problem } = made as { problem: string };
    for (const part of contains) {
      expect(problem).toContain(part);
    }
  });

  it('gives a backend for names of letters, digits, ., _ and -', async () => {
    const { services } = setup();

    const made = await localBackendKind.create(
      testEntry(testGame({ id: 'my-game.v2', kinds: { dev_1: KINDS.ok } })),
      services,
    );

    expect(made).not.toHaveProperty('problem');
  });

  it('creates a backend that cancels and builds the folder as it stands', async () => {
    const backend = await setup().create();

    expect(backend.capabilities).toEqual({
      cancel: true,
      choosesBranch: false,
      saveLog: false,
    });
  });
});

describe('queue', () => {
  it('starts the target detached through the wrapper and records the run', async () => {
    const t = setup();
    const backend = await t.create();
    t.setClock(1_000_000);

    const queued = await backend.queue(t.game, QUEUE_OK);

    expect(queued).toEqual({ id: FIRST_ID });
    expect(await t.dataFiles.stat(FIRST_FOLDER)).toEqual({
      isFolder: true,
      isLink: false,
    });
    expect(t.processes.detachedStarts).toEqual([
      {
        command: '/bin/sh',
        args: [
          '-c',
          POSIX_WRAPPER,
          'builds-local',
          '/data/runs/demo/ok/1000000/pid',
          '/data/runs/demo/ok/1000000/exit-code',
          './build.sh',
          '--env',
          'dev',
        ],
        options: {
          cwd: '/clones/demo',
          logPath: '/data/runs/demo/ok/1000000/log.txt',
        },
      },
    ]);
    expect(JSON.parse(await t.dataFiles.read('runs.json'))).toEqual({
      runs: [
        {
          id: FIRST_ID,
          gameId: 'demo',
          kind: 'ok',
          branch: 'feature/x',
          revision: REVISION,
          startedAt: 1000000,
          finishedAt: null,
          exitCode: null,
          cancelled: false,
          lastLine: null,
        },
      ],
    });
  });

  it.each<{
    name: string;
    verify(t: ReturnType<typeof setup>): Promise<void>;
  }>([
    {
      name: 'rejects a second run of a running kind',
      async verify(t) {
        const backend = await t.startFirstRun(ALIVE);
        t.setClock(1_300_000);

        const queued = backend.queue(t.game, QUEUE_OK);

        await expect(queued).rejects.toThrow(/OK.*Demo/);
        expect(t.processes.detachedStarts).toHaveLength(1);
      },
    },
    {
      name: 'allows another kind beside a running one',
      async verify(t) {
        const backend = await t.startFirstRun(ALIVE);
        t.setClock(1_300_000);

        expect(await backend.queue(t.game, QUEUE_BAD)).toEqual({
          id: 'demo/bad/1300000',
        });
      },
    },
    {
      name: 'starts after a dead pid',
      async verify(t) {
        const backend = await t.startFirstRun(GONE);
        t.setClock(1_300_000);

        expect(await backend.queue(t.game, QUEUE_OK)).toEqual({
          id: 'demo/ok/1300000',
        });
        expect(await t.recordOf(backend, FIRST_ID)).toMatchObject({
          state: 'finished',
          result: 'failure',
          statusText: 'ended without an exit code',
          finishedAt: 1_300_000,
        });
        expect(t.processes.detachedStarts).toHaveLength(2);
      },
    },
    {
      name: 'records nothing when the start fails',
      async verify(t) {
        const backend = await t.create();
        t.setClock(1_000_000);
        t.processes.failDetachedStarts(
          new Error('Could not run /bin/sh: EACCES'),
        );

        await expect(backend.queue(t.game, QUEUE_OK)).rejects.toThrow(
          'Could not run /bin/sh: EACCES',
        );
        expect(await t.dataFiles.stat('runs.json')).toBeNull();

        t.processes.failDetachedStarts(null);
        expect(await backend.queue(t.game, QUEUE_OK)).toEqual({
          id: FIRST_ID,
        });
      },
    },
    {
      name: 'records the short commit on a detached head',
      async verify(t) {
        vi.mocked(t.git.currentBranch).mockResolvedValue('2993a9e');
        const backend = await t.create();

        const { id } = await backend.queue(t.game, QUEUE_OK);

        expect((await t.recordOf(backend, id))?.branch).toBe('2993a9e');
      },
    },
    {
      name: 'rejects outside a git clone',
      async verify(t) {
        vi.mocked(t.git.currentBranch).mockResolvedValue(null);
        const backend = await t.create();

        await expect(backend.queue(t.game, QUEUE_OK)).rejects.toThrow(
          '/clones/demo',
        );
        expect(t.processes.detachedStarts).toEqual([]);
        expect(await t.dataFiles.stat('runs.json')).toBeNull();
      },
    },
    {
      name: 'rejects an unknown kind',
      async verify(t) {
        const backend = await t.create();

        await expect(
          backend.queue(t.game, { ...QUEUE_OK, kind: 'qa' }),
        ).rejects.toThrow('qa');
      },
    },
  ])('queue $name', async ({ verify }) => {
    await verify(setup());
  });

  it('starts one build for two queue calls of one kind at once', async () => {
    const t = setup();
    const backend = await t.create();
    t.setClock(1_000_000);

    const first = backend.queue(t.game, QUEUE_OK);
    const second = backend.queue(t.game, QUEUE_OK);

    expect(await first).toEqual({ id: FIRST_ID });
    await expect(second).rejects.toThrow(/OK.*Demo/);
    expect(t.processes.detachedStarts).toHaveLength(1);
    expect(await t.storedRuns()).toHaveLength(1);
  });
});

describe('list settles a running run', () => {
  it.each<{
    name: string;
    exitCode: string | null;
    pid: string | null;
    aliveCheck: ProcessResult | Error | null;
    now: number;
    state: BuildRecord['state'];
    result: BuildRecord['result'];
    statusText: string | null;
    finishedAt: number | null;
    storedExitCode: number | null;
  }>([
    {
      name: 'an exit code of 0',
      exitCode: '0\n',
      pid: '4321\n',
      aliveCheck: null,
      now: 1_300_000,
      state: 'finished',
      result: 'success',
      statusText: null,
      finishedAt: 1_200_000,
      storedExitCode: 0,
    },
    {
      name: 'a non-zero exit code',
      exitCode: '2\n',
      pid: '4321\n',
      aliveCheck: null,
      now: 1_300_000,
      state: 'finished',
      result: 'failure',
      statusText: 'Exited with code 2',
      finishedAt: 1_200_000,
      storedExitCode: 2,
    },
    {
      name: 'a negative Windows exit code',
      exitCode: '-1073741510\r\n',
      pid: '4321\n',
      aliveCheck: null,
      now: 1_300_000,
      state: 'finished',
      result: 'failure',
      statusText: 'Exited with code -1073741510',
      finishedAt: 1_200_000,
      storedExitCode: -1073741510,
    },
    {
      name: 'an exit file that is not a number',
      exitCode: '2abc\n',
      pid: '4321\n',
      aliveCheck: GONE,
      now: 1_300_000,
      state: 'finished',
      result: 'failure',
      statusText: 'ended without an exit code',
      finishedAt: 1_300_000,
      storedExitCode: null,
    },
    {
      name: 'a live pid',
      exitCode: null,
      pid: '4321\n',
      aliveCheck: ALIVE,
      now: 1_300_000,
      state: 'running',
      result: null,
      statusText: null,
      finishedAt: null,
      storedExitCode: null,
    },
    {
      name: 'an exit file not yet whole',
      exitCode: '',
      pid: '4321\n',
      aliveCheck: ALIVE,
      now: 1_300_000,
      state: 'running',
      result: null,
      statusText: null,
      finishedAt: null,
      storedExitCode: null,
    },
    {
      name: 'a gone pid, no exit code',
      exitCode: null,
      pid: '4321\n',
      aliveCheck: GONE,
      now: 1_300_000,
      state: 'finished',
      result: 'failure',
      statusText: 'ended without an exit code',
      finishedAt: 1_300_000,
      storedExitCode: null,
    },
    {
      name: 'a pid of another program',
      exitCode: null,
      pid: '4321\n',
      aliveCheck: ANOTHER_PROGRAM,
      now: 1_300_000,
      state: 'finished',
      result: 'failure',
      statusText: 'ended without an exit code',
      finishedAt: 1_300_000,
      storedExitCode: null,
    },
    {
      name: 'no pid yet, inside the grace',
      exitCode: null,
      pid: null,
      aliveCheck: null,
      now: 1_000_000 + PID_GRACE_MS - 1,
      state: 'running',
      result: null,
      statusText: null,
      finishedAt: null,
      storedExitCode: null,
    },
    {
      name: 'no pid past the grace',
      exitCode: null,
      pid: null,
      aliveCheck: null,
      now: 1_000_000 + PID_GRACE_MS,
      state: 'finished',
      result: 'failure',
      statusText: 'ended without an exit code',
      finishedAt: 1_000_000 + PID_GRACE_MS,
      storedExitCode: null,
    },
    {
      name: 'an alive check that rejects',
      exitCode: null,
      pid: '4321\n',
      aliveCheck: REJECTS,
      now: 1_300_000,
      state: 'running',
      result: null,
      statusText: null,
      finishedAt: null,
      storedExitCode: null,
    },
    {
      name: 'an alive check that times out',
      exitCode: null,
      pid: '4321\n',
      aliveCheck: TIMED_OUT,
      now: 1_300_000,
      state: 'running',
      result: null,
      statusText: null,
      finishedAt: null,
      storedExitCode: null,
    },
  ])('$name', async (row) => {
    const t = setup();
    const backend = await t.create();
    t.setClock(1_000_000);
    await backend.queue(t.game, QUEUE_OK);
    t.setClock(1_200_000);
    if (row.exitCode !== null) {
      await t.dataFiles.write(`${FIRST_FOLDER}/exit-code`, row.exitCode);
    }
    if (row.pid !== null) {
      await t.dataFiles.write(`${FIRST_FOLDER}/pid`, row.pid);
    }
    if (row.aliveCheck !== null) {
      t.processes.script('ps', PS_ARGS, row.aliveCheck);
    }
    t.setClock(row.now);

    const record = await t.recordOf(backend, FIRST_ID);

    expect(record).toMatchObject({
      state: row.state,
      result: row.result,
      statusText: row.statusText,
      finishedAt: row.finishedAt,
    });
    expect(t.commandsRun()).toEqual(row.aliveCheck === null ? [] : ['ps']);
    if (row.state === 'finished') {
      expect((await t.storedRuns())[0]).toMatchObject({
        finishedAt: row.finishedAt,
        exitCode: row.storedExitCode,
      });
    }
  });

  it('reads the exit code again when the pid is gone', async () => {
    const t = setup();
    const backend = await t.startFirstRun(GONE);
    const run = t.processes.run.bind(t.processes);
    t.processes.run = async (command, args, options) => {
      const answer = await run(command, args, options);
      await t.dataFiles.write(`${FIRST_FOLDER}/exit-code`, '3\n');
      return answer;
    };
    t.setClock(1_300_000);

    const record = await t.recordOf(backend, FIRST_ID);

    expect(record?.statusText).toBe('Exited with code 3');
  });

  it('leaves runs.json unwritten when a list has nothing to settle', async () => {
    const t = setup();
    t.setClock(1_000_000);
    await t.writeRunsJson([storedRun('ok', 500_000, 900_000, 0)]);
    const backend = await t.create();
    t.setClock(1_300_000);

    await backend.list(t.game, 20);

    expect(await t.dataFiles.modified('runs.json')).toBe(1_000_000);
  });
});

describe('progress', () => {
  it.each<{
    name: string;
    earlier: ReturnType<typeof storedRun>[];
    now: number;
    percent: number | null;
    leftSeconds: number | null;
  }>([
    {
      name: 'half of the last success',
      earlier: [storedRun('ok', 1_000_000, 1_600_000, 0)],
      now: 2_300_000,
      percent: 50,
      leftSeconds: 300,
    },
    {
      name: 'just under the end',
      earlier: [storedRun('ok', 1_000_000, 1_600_000, 0)],
      now: 2_599_000,
      percent: 99,
      leftSeconds: 1,
    },
    {
      name: 'past the last success',
      earlier: [storedRun('ok', 1_000_000, 1_600_000, 0)],
      now: 2_900_000,
      percent: 99,
      leftSeconds: 0,
    },
    {
      name: 'the newest success counts',
      earlier: [
        storedRun('ok', 100_000, 700_000, 0),
        storedRun('ok', 1_000_000, 1_400_000, 0),
      ],
      now: 2_200_000,
      percent: 50,
      leftSeconds: 200,
    },
    {
      name: 'a success of no duration does not count',
      earlier: [storedRun('ok', 1_000_000, 1_000_000, 0)],
      now: 2_300_000,
      percent: null,
      leftSeconds: null,
    },
    {
      name: 'a success of no duration leaves the older one',
      earlier: [
        storedRun('ok', 100_000, 700_000, 0),
        storedRun('ok', 1_000_000, 990_000, 0),
      ],
      now: 2_300_000,
      percent: 50,
      leftSeconds: 300,
    },
    {
      name: 'a failure does not count',
      earlier: [storedRun('ok', 1_000_000, 1_600_000, 1)],
      now: 2_300_000,
      percent: null,
      leftSeconds: null,
    },
    {
      name: 'another kind does not count',
      earlier: [storedRun('bad', 1_000_000, 1_600_000, 0)],
      now: 2_300_000,
      percent: null,
      leftSeconds: null,
    },
    {
      name: 'no earlier run',
      earlier: [],
      now: 2_300_000,
      percent: null,
      leftSeconds: null,
    },
  ])('$name', async ({ earlier, now, percent, leftSeconds }) => {
    const t = setup();
    await t.writeRunsJson(earlier);
    const backend = await t.create();
    t.setClock(2_000_000);
    const { id } = await backend.queue(t.game, QUEUE_OK);
    await t.dataFiles.write(`runs/${id}/pid`, '4321\n');
    t.processes.script('ps', PS_ARGS, aliveAnswer(id));
    t.setClock(now);

    const record = await t.recordOf(backend, id);

    expect(record).toMatchObject({ state: 'running', percent, leftSeconds });
  });
});

describe('the step', () => {
  it.each([
    {
      name: 'the last non-empty line',
      log: 'building\r\nstep two  \n\n   \n',
      stepText: 'step two',
    },
    {
      name: 'the last state of a redrawn line',
      log: '10%\r20%\r30%',
      stepText: '30%',
    },
    {
      name: 'a line without its colour escapes',
      log: '\x1b[32mdone\x1b[0m\n',
      stepText: 'done',
    },
    {
      name: 'a line without its key and private-parameter escapes',
      log: '\x1b[>4mlinking\x1b[2~ app\n',
      stepText: 'linking app',
    },
    {
      name: 'a line without its cursor escapes',
      log: '\x1b[?25lcompiling 3/9\x1b[?25h\n',
      stepText: 'compiling 3/9',
    },
    { name: 'no line', log: '\n  \n', stepText: null },
  ])('shows $name as the step', async ({ log, stepText }) => {
    const t = setup();
    const backend = await t.startFirstRun(ALIVE);
    await t.dataFiles.write(`${FIRST_FOLDER}/log.txt`, log);

    const record = await t.recordOf(backend, FIRST_ID);

    expect(record).toMatchObject({ state: 'running', stepText });
  });

  it('saves the last line once the run ends', async () => {
    const t = setup();
    const backend = await t.startFirstRun(ALIVE);
    await t.dataFiles.write(
      `${FIRST_FOLDER}/log.txt`,
      'building\r\nstep two  \n\n   \n',
    );
    await t.dataFiles.write(`${FIRST_FOLDER}/exit-code`, '0\n');
    await backend.list(t.game, 20);
    expect((await t.storedRuns())[0].lastLine).toBe('step two');

    await t.dataFiles.deleteFile(`${FIRST_FOLDER}/log.txt`);
    const record = await t.recordOf(backend, FIRST_ID);

    expect(record?.stepText).toBe('step two');
  });
});

describe('list', () => {
  it('lists the newest runs across kinds, cut to the limit', async () => {
    const t = setup();
    await t.writeRunsJson([
      storedRun('ok', 1_000_000, 1_100_000, 0),
      storedRun('bad', 2_000_000, 2_100_000, 1),
      storedRun('ok', 3_000_000, 3_100_000, 0),
    ]);
    const backend = await t.create();

    const records = await backend.list(t.game, 2);

    expect(records.map(({ id }) => id)).toEqual([
      'demo/ok/3000000',
      'demo/bad/2000000',
    ]);
    for (const record of records) {
      expect(record).toMatchObject({
        number: null,
        queuedAt: record.startedAt,
        links: [],
        jobs: [],
        webUrl: null,
      });
    }
  });

  it('keeps a run an earlier instance started', async () => {
    const t = setup();
    await t.startFirstRun(ALIVE);
    const later = await t.create();
    t.setClock(1_300_000);

    expect((await t.recordOf(later, FIRST_ID))?.state).toBe('running');

    await t.dataFiles.write(`${FIRST_FOLDER}/exit-code`, '0\n');
    expect((await t.recordOf(later, FIRST_ID))?.result).toBe('success');
  });

  it('keeps the runs of two instances over one runs.json', async () => {
    const t = setup();
    const a = await t.create();
    t.setClock(1_000_000);
    await a.list(t.game, 20);
    const b = await t.create();
    await b.list(t.game, 20);
    t.setClock(1_100_000);
    await b.queue(t.game, QUEUE_OK);
    t.setClock(1_200_000);

    await a.queue(t.game, QUEUE_BAD);

    expect((await t.storedRuns()).map(({ id }) => id).sort()).toEqual([
      'demo/bad/1200000',
      'demo/ok/1100000',
    ]);
    const listed = await a.list(t.game, 20);
    expect(listed.map(({ id }) => id).sort()).toEqual([
      'demo/bad/1200000',
      'demo/ok/1100000',
    ]);
  });

  it('refuses a second build of a kind another instance started since its last call', async () => {
    const t = setup();
    const earlier = await t.create();
    await earlier.list(t.game, 20);
    await t.startFirstRun(ALIVE);
    t.setClock(1_300_000);

    await expect(earlier.queue(t.game, QUEUE_OK)).rejects.toThrow(/OK.*Demo/);
    expect(t.processes.detachedStarts).toHaveLength(1);
  });

  it('keeps a cancel another instance wrote since its last call', async () => {
    const t = setup();
    const canceller = await t.startFirstRun(ALIVE);
    const other = await t.create();
    t.setClock(1_300_000);
    expect((await t.recordOf(other, FIRST_ID))?.state).toBe('running');
    t.processes.script('kill', KILL_ARGS, result({}));
    t.setClock(1_500_000);
    await canceller.cancel?.(t.game, FIRST_ID);
    await t.dataFiles.write(`${FIRST_FOLDER}/exit-code`, '143\n');

    expect(await t.recordOf(other, FIRST_ID)).toMatchObject({
      result: 'cancelled',
      finishedAt: 1_500_000,
    });
    expect((await t.storedRuns())[0]).toMatchObject({ exitCode: null });
  });

  it('keeps the finish another instance wrote during its own settle', async () => {
    const t = setup();
    const backend = await t.startFirstRun(ALIVE);
    const [stored] = await t.storedRuns();
    const check = deferred<ProcessResult>();
    t.processes.script('ps', PS_ARGS, check.promise);
    t.setClock(1_500_000);

    const listing = backend.list(t.game, 20);
    for (let turn = 0; turn < 5; turn++) {
      await flush();
    }
    expect(t.commandsRun()).toEqual(['ps']);
    await t.writeRunsJson([
      { ...stored, finishedAt: 1_400_000, cancelled: true },
    ]);
    check.resolve(GONE);

    expect((await listing)[0]).toMatchObject({
      result: 'cancelled',
      finishedAt: 1_400_000,
    });
    expect((await t.storedRuns())[0]).toMatchObject({ finishedAt: 1_400_000 });
  });

  it('drops the oldest finished runs past KEPT_RUNS with their files', async () => {
    const t = setup();
    const finished = Array.from({ length: KEPT_RUNS + 1 }, (_, index) =>
      storedRun('ok', (index + 1) * 1_000, (index + 1) * 1_000 + 500, 0),
    );
    await t.writeRunsJson(finished);
    for (const run of finished) {
      for (const name of ['log.txt', 'pid', 'exit-code']) {
        await t.dataFiles.write(`runs/${run.id}/${name}`, '0\n');
      }
    }
    const backend = await t.create();
    t.setClock(1_000_000);

    const { id: badId } = await backend.queue(t.game, QUEUE_BAD);

    const oldest = finished[0].id;
    const keptIds = (await t.storedRuns()).map(({ id }) => id).sort();
    expect(keptIds).toEqual(
      [...finished.slice(1).map(({ id }) => id), badId].sort(),
    );
    for (const name of ['log.txt', 'pid', 'exit-code']) {
      expect(await t.dataFiles.stat(`runs/${oldest}/${name}`)).toBeNull();
    }
  });

  it.each([
    { name: 'not JSON', text: '{runs: 3' },
    { name: 'a runs value that is not an array', text: '{"runs": "x"}' },
    {
      name: 'a run with no id',
      text: '{"runs": [{"gameId": "demo", "kind": "ok", "branch": "main", "revision": null, "startedAt": 1000000, "finishedAt": null, "exitCode": null, "cancelled": false, "lastLine": null}]}',
    },
  ])(
    'rejects every call over a runs.json that is $name, and keeps it',
    async ({ text }) => {
      const t = setup();
      await t.dataFiles.write('runs.json', text);
      const backend = await t.create();
      const notValid = /^runs\.json is not valid/;

      await expect(backend.list(t.game, 20)).rejects.toThrow(notValid);
      await expect(backend.queue(t.game, QUEUE_OK)).rejects.toThrow(notValid);
      await expect(backend.cancel?.(t.game, FIRST_ID)).rejects.toThrow(
        notValid,
      );
      expect(await t.dataFiles.read('runs.json')).toBe(text);
    },
  );

  it('reads a run with an extra key', async () => {
    const t = setup();
    await t.writeRunsJson([
      { ...storedRun('ok', 1_000_000, 1_200_000, 0), note: 'x' },
    ]);
    const backend = await t.create();

    const records = await backend.list(t.game, 20);

    expect(records).toEqual([
      expect.objectContaining({ id: FIRST_ID, result: 'success' }),
    ]);
  });
});

describe('cancel', () => {
  it.each([
    {
      os: 'macos' as const,
      check: { command: 'ps', args: PS_ARGS, answer: ALIVE },
      kill: { command: 'kill', args: KILL_ARGS },
    },
    {
      os: 'windows' as const,
      check: {
        command: 'powershell.exe',
        args: [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          '(Get-CimInstance Win32_Process -Filter "ProcessId=4321").CommandLine',
        ],
        answer: result({
          stdout:
            "powershell.exe -NoProfile -Command Set-Content -LiteralPath 'C:\\data\\runs\\demo\\ok\\1000000\\pid' -Value $PID; ps-script # builds-local\r\n",
        }),
      },
      kill: { command: 'taskkill', args: ['/PID', '4321', '/T', '/F'] },
    },
  ])(
    '$os signals the group and marks the run cancelled',
    async ({ os, check, kill }) => {
      const t = setup(os);
      const backend = await t.create();
      t.setClock(1_000_000);
      await backend.queue(t.game, QUEUE_OK);
      await t.dataFiles.write(`${FIRST_FOLDER}/pid`, '4321');
      t.processes.script(check.command, check.args, check.answer);
      t.processes.script(kill.command, kill.args, result({}));
      t.setClock(1_500_000);

      await backend.cancel?.(t.game, FIRST_ID);

      expect(
        t.processes.runs.map(({ command, args }) => ({ command, args })),
      ).toEqual([
        { command: check.command, args: check.args },
        { command: kill.command, args: kill.args },
      ]);
      const cancelled = {
        result: 'cancelled',
        statusText: 'Cancelled',
        finishedAt: 1_500_000,
      };
      expect(await t.recordOf(backend, FIRST_ID)).toMatchObject(cancelled);

      await t.dataFiles.write(`${FIRST_FOLDER}/exit-code`, '143\n');
      expect(await t.recordOf(backend, FIRST_ID)).toMatchObject(cancelled);
    },
  );

  it.each<{
    name: string;
    id?: string;
    exitCode?: 'settled' | 'unlisted';
    pid?: boolean;
    aliveCheck?: ProcessResult | Error;
    kill?: ProcessResult | Error;
    rejects: string | null;
    commands: string[];
    after: Partial<BuildRecord> | null;
  }>([
    {
      name: 'does nothing for a finished run',
      exitCode: 'settled',
      rejects: null,
      commands: [],
      after: { state: 'finished', result: 'success' },
    },
    {
      name: 'finishes a run that already exited',
      exitCode: 'unlisted',
      rejects: null,
      commands: [],
      after: { state: 'finished', result: 'success' },
    },
    {
      name: 'rejects with no pid yet',
      pid: false,
      rejects: 'The build has not written its pid yet',
      commands: [],
      after: null,
    },
    {
      name: 'rejects an unknown id',
      id: 'nope',
      rejects: 'nope',
      commands: [],
      after: null,
    },
    {
      name: 'kills nothing for a pid of another program',
      aliveCheck: ANOTHER_PROGRAM,
      rejects: null,
      commands: ['ps'],
      after: {
        state: 'finished',
        result: 'failure',
        statusText: 'ended without an exit code',
        finishedAt: 1_500_000,
      },
    },
    {
      name: 'rejects when the alive check rejects',
      aliveCheck: REJECTS,
      rejects: 'Could not run ps: ENOENT',
      commands: ['ps'],
      after: { state: 'running' },
    },
    {
      name: 'rejects when the kill rejects',
      aliveCheck: ALIVE,
      kill: new Error('Could not run kill: ENOENT'),
      rejects: 'Could not run kill: ENOENT',
      commands: ['ps', 'kill'],
      after: { state: 'running' },
    },
    {
      name: 'rejects when the kill times out',
      aliveCheck: ALIVE,
      kill: TIMED_OUT,
      rejects: 'kill',
      commands: ['ps', 'kill'],
      after: { state: 'running' },
    },
    {
      name: 'ends the run as gone on a non-zero kill exit',
      aliveCheck: ALIVE,
      kill: result({ code: 1, stderr: 'kill: 4321: No such process' }),
      rejects: null,
      commands: ['ps', 'kill'],
      after: {
        state: 'finished',
        result: 'failure',
        statusText: 'ended without an exit code',
        finishedAt: 1_500_000,
      },
    },
  ])('cancel $name', async (row) => {
    const t = setup();
    const backend = await t.create();
    t.setClock(1_000_000);
    await backend.queue(t.game, QUEUE_OK);
    if (row.pid !== false) {
      await t.dataFiles.write(`${FIRST_FOLDER}/pid`, '4321\n');
    }
    if (row.exitCode !== undefined) {
      await t.dataFiles.write(`${FIRST_FOLDER}/exit-code`, '0\n');
    }
    if (row.exitCode === 'settled') {
      await backend.list(t.game, 20);
    }
    if (row.aliveCheck !== undefined) {
      t.processes.script('ps', PS_ARGS, row.aliveCheck);
    }
    if (row.kill !== undefined) {
      t.processes.script('kill', KILL_ARGS, row.kill);
    }
    t.setClock(1_500_000);
    const runsBefore = t.processes.runs.length;

    const cancelling = backend.cancel?.(t.game, row.id ?? FIRST_ID);

    if (row.rejects === null) {
      await expect(cancelling).resolves.toBeUndefined();
    } else {
      await expect(cancelling).rejects.toThrow(row.rejects);
    }
    expect(t.commandsRun().slice(runsBefore)).toEqual(row.commands);
    if (row.after !== null) {
      expect(await t.recordOf(backend, FIRST_ID)).toMatchObject(row.after);
    }
  });

  it('waits for a list settle before it cancels', async () => {
    const t = setup();
    const backend = await t.startFirstRun(ALIVE);
    const listCheck = deferred<ProcessResult>();
    t.processes.script('ps', PS_ARGS, listCheck.promise);
    t.setClock(1_500_000);

    const listing = backend.list(t.game, 20);
    const cancelling = backend.cancel?.(t.game, FIRST_ID);
    for (let turn = 0; turn < 5; turn++) {
      await flush();
    }
    expect(t.commandsRun()).toEqual(['ps']);
    t.processes.script('ps', PS_ARGS, ALIVE);
    t.processes.script('kill', KILL_ARGS, result({}));
    listCheck.resolve(ALIVE);
    await Promise.all([listing, cancelling]);

    expect(t.commandsRun()).toEqual(['ps', 'ps', 'kill']);
    expect(await t.recordOf(backend, FIRST_ID)).toMatchObject({
      result: 'cancelled',
      statusText: 'Cancelled',
    });
  });
});
