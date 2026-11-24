import { describe, expect, it } from 'vitest';
import type { Git } from '../../../contracts/git';
import type { ProcessResult } from '../../../contracts/processes';
import { FakeProcesses, type FakeRun } from '../../../shared/fake-processes';
import { fakeTimers } from '../../../shared/fake-timers.test-support';
import { createMemoryFiles } from '../../../shared/memory-files';
import { posixPaths } from '../../../shared/paths/posix-paths';
import { fakePlatform } from '../../../shared/platform.test-support';
import { deferred } from '../../../shared/plugin-part-harness.test-support';
import type {
  BackendEntry,
  BackendServices,
  BuildBackend,
  GameEntry,
} from '../../builds/contract';
import { backendEntry, gameEntry } from '../../builds/contract.test-support';
import buildQueue from './fixtures/build-queue.json';
import chainFailed from './fixtures/chain-failed.json';
import chainFinished from './fixtures/chain-finished.json';
import chainRunning from './fixtures/chain-running.json';
import deployAndroidLog from './fixtures/deploy-android.log?raw';
import deployIosLog from './fixtures/deploy-ios.log?raw';
import runListDev from './fixtures/run-list-dev.json';
import runListRelease from './fixtures/run-list-release.json';
import runStart from './fixtures/run-start.json';
import {
  DETAIL_RETRY_MS,
  LINK_WINDOW_MS,
  MAX_CALLS_IN_FLIGHT,
  teamcityBackendKind,
} from './teamcity-backend';

// The recorded shas: the game's repo, and an older commit of it.
const A = '2993a9e4b92724916453c6e2a3257c4838ce0777';
const F = '5e1f4c2a9b8d7e6f5a4b3c2d1e0f9a8b7c6d5e4f';
const IOS_URL =
  'https://appdistribution.firebase.google.com/testerapps/1:1017210896283:ios:26dc2b5eea26c5c6eceb3e/releases/3433pjvova820?utm_source=firebase-tools';
const ANDROID_URL =
  'https://appdistribution.firebase.google.com/testerapps/1:1017210896283:android:a3badb8c5a545b7beceb3e/releases/029e6kfravka0?utm_source=firebase-tools';

// `20261123T193000+0000`
const NOW = 1795462200000;
const DEV = 'vggt_BashBest_Dev_BuildChain';
const RELEASE = 'vggt_BashBest_Release_BuildChain';
const CACHE_FILE = 'teamcity-finished.json';
const FIRST_LIST_IDS = ['821400', '821339', '821200', '821150', '821100'];

const GAME: GameEntry = gameEntry({
  id: 'tiki-smash',
  label: 'Tiki Smash',
  clone: null,
  defaultBranch: 'protos/physics-fun',
  kinds: {
    dev: { label: 'Dev', target: DEV, downloads: [] },
    release: { label: 'Release', target: RELEASE, downloads: [] },
  },
  sets: [],
});

const ENTRY: BackendEntry = backendEntry({
  id: 'work',
  kind: 'teamcity',
  label: 'TeamCity',
  config: { command: '' },
  games: [GAME],
});

function runListArgs(target: string, limit: number): string[] {
  return [
    'run',
    'list',
    '--job',
    target,
    '--limit',
    String(limit),
    '--json=id,number,status,state,webUrl,branchName,buildTypeId,statusText,queuedDate,startDate,finishDate,waitReason,triggered.user.name',
  ];
}

const QUEUE_ARGS = [
  'api',
  '/app/rest/buildQueue?locator=count:1000&fields=build(id,buildTypeId,state,branchName,queuedDate,webUrl,waitReason,startEstimate,triggered(user(name)))',
];

function detailArgs(id: string): string[] {
  return [
    'api',
    `/app/rest/builds/id:${id}?fields=id,state,snapshot-dependencies(build(id,buildTypeId,state,status,statusText,percentageComplete,webUrl,startDate,finishDate,buildType(name),running-info(percentageComplete,leftSeconds,currentStageText),revisions(revision(version)),snapshot-dependencies(build(id))))`,
  ];
}

function logArgs(jobId: string): string[] {
  return ['run', 'log', jobId, '--raw'];
}

function exited(stdout: string): ProcessResult {
  return { code: 0, stdout, stderr: '', timedOut: false };
}

// Runs every promise callback queued before the next turn of the event loop.
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

// The services of each test: a clock at NOW that `setNow` moves, files, data files stamped by that clock, the log's
// lines, and a CLI whose `--version` check answers.
function setup() {
  let now = NOW;
  const clock = { now: () => now };
  const processes = new FakeProcesses();
  const logs: string[] = [];
  const dataFiles = createMemoryFiles(clock);
  const files = createMemoryFiles();
  const services: BackendServices = {
    processes,
    git: {} as Git, // the backend reads no git
    files,
    dataFiles,
    dataFolder: '/data/builds/backends/work',
    paths: posixPaths,
    clock,
    timers: fakeTimers().timers,
    homeDir: '/home/u',
    platform: fakePlatform('macos'),
    log: (line) => void logs.push(line),
  };
  // `teamcity <args> --no-input` answers `stdout`, the JSON of a value, or rejects with an Error.
  const answer = (args: string[], stdout: unknown) =>
    processes.script(
      'teamcity',
      [...args, '--no-input'],
      stdout instanceof Error || stdout instanceof Promise
        ? stdout
        : exited(typeof stdout === 'string' ? stdout : JSON.stringify(stdout)),
    );
  answer(['--version'], 'teamcity version 1.7.0');
  return {
    processes,
    logs,
    files,
    dataFiles,
    services,
    answer,
    setNow: (ms: number) => {
      now = ms;
    },
  };
}

type Setup = ReturnType<typeof setup>;

// The recorded answers of a list of `limit` builds: both run lists, the queue, three details and one that fails, and
// the deploy logs of the two finished chains.
function answerRecordedList({ answer }: Setup, limit = 20) {
  answer(runListArgs(DEV, limit), runListDev);
  answer(runListArgs(RELEASE, limit), runListRelease);
  answer(QUEUE_ARGS, buildQueue);
  answer(detailArgs('821339'), chainRunning);
  answer(detailArgs('821200'), chainFinished);
  answer(detailArgs('821150'), chainFailed);
  answer(detailArgs('821100'), new Error('HTTP 404'));
  answer(logArgs('821198'), deployIosLog);
  answer(logArgs('821196'), deployAndroidLog);
  answer(logArgs('821146'), deployAndroidLog);
  answer(logArgs('821193'), '');
  answer(logArgs('821143'), '');
}

async function createBackend(services: BackendServices): Promise<BuildBackend> {
  const backend = await teamcityBackendKind.create(ENTRY, services);
  if ('problem' in backend) {
    throw new Error(backend.problem);
  }
  return backend;
}

// Each run's args without the `--no-input` every run ends with.
function argsOf(runs: FakeRun[]): string[][] {
  return runs.map((run) => run.args.slice(0, -1));
}

function detailIds(runs: FakeRun[]): string[] {
  return argsOf(runs).flatMap(([verb, path]) => {
    const match =
      verb === 'api' ? /^\/app\/rest\/builds\/id:(\d+)\?/.exec(path) : null;
    return match === null ? [] : [match[1]];
  });
}

function logIds(runs: FakeRun[]): string[] {
  return argsOf(runs).flatMap(([verb, sub, jobId]) =>
    verb === 'run' && sub === 'log' ? [jobId] : [],
  );
}

async function cachedIds(test: Setup): Promise<string[]> {
  const file = JSON.parse(await test.dataFiles.read(CACHE_FILE));
  return file.games['tiki-smash'].map((record: { id: string }) => record.id);
}

// A cache file holding finished build 821200 with `job` as its one job, every other field of the record well formed.
function cacheFileWithJob(job: Record<string, unknown>): string {
  return JSON.stringify({
    games: {
      'tiki-smash': [
        {
          id: '821200',
          gameId: 'tiki-smash',
          kind: 'dev',
          branch: 'protos/physics-fun',
          number: '330',
          version: '0.12.0',
          revision: F,
          result: 'success',
          statusText: null,
          stepText: null,
          webUrl: null,
          triggeredBy: null,
          percent: null,
          leftSeconds: null,
          startedAt: null,
          finishedAt: 1795458852000,
          startEstimate: null,
          state: 'finished',
          queuedAt: 1795458000000,
          links: [],
          jobs: [job],
        },
      ],
    },
  });
}

function withKindTarget(kind: string, target: unknown): BackendEntry {
  return {
    ...ENTRY,
    games: [
      {
        ...GAME,
        kinds: { ...GAME.kinds, [kind]: { ...GAME.kinds[kind], target } },
      },
    ],
  };
}

describe('teamcityBackendKind.create', () => {
  it.each([
    {
      name: 'a config that is not an object',
      entry: { ...ENTRY, config: 'teamcity' },
      contains: ['config'],
    },
    {
      name: 'a command that is not a string',
      entry: { ...ENTRY, config: { command: 3 } },
      contains: ['command'],
    },
    {
      name: 'a bad build job pattern',
      entry: { ...ENTRY, config: { buildJobPattern: '(' } },
      contains: ['buildJobPattern'],
    },
    {
      name: 'an empty target',
      entry: withKindTarget('dev', ''),
      contains: ['tiki-smash', 'dev'],
    },
    {
      name: 'a target that is not a string',
      entry: withKindTarget('release', {}),
      contains: ['tiki-smash', 'release'],
    },
    {
      name: 'a CLI that does not run',
      entry: { ...ENTRY, config: { command: '~/bin/tc' } },
      contains: ['/home/u/bin/tc'],
    },
  ])('gives a problem for $name', async ({ entry, contains }) => {
    const { processes, services } = setup();
    processes.script(
      '/home/u/bin/tc',
      ['--version', '--no-input'],
      new Error('Could not run /home/u/bin/tc: ENOENT'),
    );

    const created = await teamcityBackendKind.create(entry, services);

    expect(created).toHaveProperty('problem');
    const { problem } = created as { problem: string };
    for (const part of contains) {
      expect(problem).toContain(part);
    }
  });

  it('creates a backend that chooses branches, saves logs and cannot cancel', async () => {
    const backend = await createBackend(setup().services);

    expect(backend.capabilities).toEqual({
      cancel: false,
      choosesBranch: true,
      saveLog: true,
    });
    expect(backend.cancel).toBeUndefined();
  });
});

describe('list', () => {
  it('merges the kinds and the queue newest first', async () => {
    const test = setup();
    answerRecordedList(test);
    const backend = await createBackend(test.services);

    const records = await backend.list(GAME, 20);

    expect(records.map((record) => record.id)).toEqual(FIRST_LIST_IDS);
    const [queued, running, finished, failed, cancelled] = records;
    expect(queued).toMatchObject({
      kind: 'release',
      number: null,
      version: null,
      branch: 'protos/physics-fun',
      revision: null,
      state: 'queued',
      result: null,
      statusText: 'Waiting for a compatible agent',
      queuedAt: 1795461600000,
      startEstimate: 1795465385000,
      jobs: [],
      links: [],
      triggeredBy: 'Build User',
      webUrl: 'https://peoplefun.teamcity.com/build/821400',
    });
    expect(running).toMatchObject({
      kind: 'dev',
      number: '331',
      version: '0.12.0',
      branch: 'protos/physics-fun',
      revision: A,
      state: 'running',
      result: null,
      percent: 75,
      leftSeconds: 900,
      stepText: 'Step 3/8: Build player',
      startedAt: 1795461022000,
    });
    expect(running.jobs).toHaveLength(7);
    expect(finished).toMatchObject({
      result: 'success',
      percent: null,
      leftSeconds: null,
      stepText: null,
      revision: F,
      finishedAt: 1795458852000,
      links: [
        { label: 'iOS', url: IOS_URL },
        { label: 'Android', url: ANDROID_URL },
      ],
    });
    expect(failed).toMatchObject({
      kind: 'release',
      result: 'failure',
      revision: A,
      links: [{ label: 'Android', url: ANDROID_URL }],
    });
    expect(cancelled).toMatchObject({
      result: 'cancelled',
      number: '320',
      version: '0.11.0',
      branch: 'releases/physics-fun/0.11.x',
      revision: null,
      jobs: [],
      links: [],
    });
    const cancelledLines = test.logs.filter((line) => line.includes('821100'));
    expect(cancelledLines).toHaveLength(1);
    expect(cancelledLines[0]).toContain('HTTP 404');
  });

  it('cuts to the limit before it reads details', async () => {
    const test = setup();
    answerRecordedList(test, 3);
    const backend = await createBackend(test.services);

    const records = await backend.list(GAME, 3);

    expect(records.map((record) => record.id)).toEqual([
      '821400',
      '821339',
      '821200',
    ]);
    const namesCut = (arg: string) =>
      arg.includes('821150') || arg.includes('821100');
    expect(
      test.processes.runs.filter((run) => run.args.some(namesCut)),
    ).toEqual([]);
  });

  it('reads a cached finished build only once, across instances', async () => {
    const test = setup();
    answerRecordedList(test);
    const backend = await createBackend(test.services);
    await backend.list(GAME, 20);
    const afterFirst = test.processes.runs.length;

    const second = await backend.list(GAME, 20);

    const sorted = (args: string[][]) =>
      args.map((each) => JSON.stringify(each)).sort();
    expect(sorted(argsOf(test.processes.runs.slice(afterFirst)))).toEqual(
      sorted([
        runListArgs(DEV, 20),
        runListArgs(RELEASE, 20),
        QUEUE_ARGS,
        detailArgs('821339'),
      ]),
    );
    expect(second[4]).toMatchObject({
      id: '821100',
      revision: null,
      jobs: [],
      links: [],
    });

    const fresh = await createBackend(test.services);
    const afterSecond = test.processes.runs.length;
    const third = await fresh.list(GAME, 20);

    expect(third.map((record) => record.id)).toEqual(FIRST_LIST_IDS);
    expect(third).toEqual(second);
    const laterRuns = test.processes.runs.slice(afterSecond);
    expect(detailIds(laterRuns)).not.toContain('821200');
    expect(detailIds(laterRuns)).not.toContain('821150');
    expect(logIds(laterRuns)).toEqual([]);
    expect(await cachedIds(test)).toEqual(['821200', '821150']);
  });

  it.each([
    {
      name: "a finished build's detail",
      id: '821100',
      fails: null,
      times: [NOW + 1, NOW + DETAIL_RETRY_MS - 1, NOW + DETAIL_RETRY_MS],
      reads: [false, false, true],
    },
    {
      name: "a finished build's log",
      id: '821200',
      fails: logArgs('821196'),
      times: [NOW + 1, NOW + DETAIL_RETRY_MS - 1, NOW + DETAIL_RETRY_MS],
      reads: [false, false, true],
    },
    {
      name: "a running build's detail",
      id: '821339',
      fails: detailArgs('821339'),
      times: [NOW + 1, NOW + 2],
      reads: [false, true],
    },
  ])('backs off reading $name after it fails', async (row) => {
    const test = setup();
    answerRecordedList(test);
    if (row.fails !== null) {
      test.answer(row.fails, new Error('HTTP 500'));
    }
    const backend = await createBackend(test.services);
    await backend.list(GAME, 20);

    const reads: boolean[] = [];
    for (const time of row.times) {
      test.setNow(time);
      const before = test.processes.runs.length;
      await backend.list(GAME, 20);
      reads.push(detailIds(test.processes.runs.slice(before)).includes(row.id));
    }

    expect(reads).toEqual(row.reads);
  });

  it.each([
    {
      name: 'a run list that rejects',
      args: runListArgs(DEV, 20),
      answer: new Error('HTTP 503'),
    },
    {
      name: 'a run list that is not JSON',
      args: runListArgs(DEV, 20),
      answer: 'Showing only the first 20 results',
    },
    {
      name: 'a queue that rejects',
      args: QUEUE_ARGS,
      answer: new Error('HTTP 503'),
    },
    { name: 'a queue that is not JSON', args: QUEUE_ARGS, answer: '<html>' },
  ])('rejects over $name', async ({ args, answer }) => {
    const test = setup();
    answerRecordedList(test);
    test.answer(args, answer);
    const backend = await createBackend(test.services);

    await expect(backend.list(GAME, 20)).rejects.toThrow();
  });

  it('lets the queue build win over a run-list row of the same id', async () => {
    const test = setup();
    test.answer(runListArgs(DEV, 20), {
      build: [
        {
          id: 821500,
          buildTypeId: DEV,
          number: '0.12.0.332',
          state: 'running',
          status: 'SUCCESS',
          branchName: 'protos/physics-fun',
          queuedDate: '20261123T192500+0000',
          startDate: '20261123T192502+0000',
        },
      ],
    });
    test.answer(runListArgs(RELEASE, 20), { build: [] });
    test.answer(QUEUE_ARGS, {
      build: [
        {
          id: 821500,
          buildTypeId: DEV,
          state: 'queued',
          branchName: 'protos/physics-fun',
          queuedDate: '20261123T192500+0000',
          waitReason: 'Waiting for a compatible agent',
        },
      ],
    });
    const backend = await createBackend(test.services);

    const records = await backend.list(GAME, 20);

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      id: '821500',
      state: 'queued',
      number: null,
      startedAt: null,
      statusText: 'Waiting for a compatible agent',
    });
    expect(detailIds(test.processes.runs)).toEqual([]);
  });

  it('breaks a queuedAt tie by numeric id, highest first', async () => {
    const test = setup();
    test.answer(runListArgs(DEV, 20), { build: [] });
    test.answer(runListArgs(RELEASE, 20), { build: [] });
    test.answer(QUEUE_ARGS, {
      build: [
        {
          id: 99999,
          buildTypeId: DEV,
          state: 'queued',
          queuedDate: '20261123T192000+0000',
        },
        {
          id: 100000,
          buildTypeId: DEV,
          state: 'queued',
          queuedDate: '20261123T192000+0000',
        },
      ],
    });
    const backend = await createBackend(test.services);

    const records = await backend.list(GAME, 20);

    expect(records.map((record) => record.id)).toEqual(['100000', '99999']);
  });

  it('cuts the cached records to the ids a list returned, and writes the file only on a change', async () => {
    const test = setup();
    answerRecordedList(test);
    const backend = await createBackend(test.services);
    await backend.list(GAME, 20);
    const firstText = await test.dataFiles.read(CACHE_FILE);

    test.setNow(NOW + 1000);
    await backend.list(GAME, 20);

    expect(await test.dataFiles.modified(CACHE_FILE)).toBe(NOW);
    expect(await test.dataFiles.read(CACHE_FILE)).toBe(firstText);

    test.setNow(NOW + 2000);
    test.answer(runListArgs(RELEASE, 20), {
      build: [runListRelease.build[1]],
    });
    await backend.list(GAME, 20);

    expect(await test.dataFiles.modified(CACHE_FILE)).toBe(NOW + 2000);
    expect(await cachedIds(test)).toEqual(['821200']);
  });

  it.each([
    { name: 'is not JSON', text: 'not json' },
    {
      name: 'holds records that lack fields',
      text: JSON.stringify({
        games: {
          'tiki-smash': [
            { id: '821200' },
            { id: '821150', gameId: 'tiki-smash', state: 'finished' },
          ],
        },
      }),
    },
    {
      name: 'holds a record whose job lacks a field',
      text: cacheFileWithJob({
        id: '821193',
        label: 'Build',
        state: 'finished',
        // no `percent`
        result: 'success',
        leftSeconds: null,
        stepText: null,
        webUrl: null,
        startedAt: null,
        finishedAt: null,
        dependsOn: [],
      }),
    },
    {
      name: 'holds a record whose job has no dependsOn',
      text: cacheFileWithJob({
        id: '821193',
        label: 'Build',
        state: 'finished',
        result: 'success',
        percent: 100,
        leftSeconds: 0,
        stepText: null,
        webUrl: 'https://peoplefun.teamcity.com/build/821193',
        startedAt: 1795464000000,
        finishedAt: 1795464060000,
      }),
    },
  ])(
    'reads the finished builds again over a cache file that $name',
    async ({ text }) => {
      const test = setup();
      await test.dataFiles.write(CACHE_FILE, text);
      answerRecordedList(test);
      const backend = await createBackend(test.services);

      const records = await backend.list(GAME, 20);

      expect(records.map((record) => record.id)).toEqual(FIRST_LIST_IDS);
      expect(detailIds(test.processes.runs)).toEqual(
        expect.arrayContaining(['821200', '821150']),
      );
      expect(records[2].links).toEqual([
        { label: 'iOS', url: IOS_URL },
        { label: 'Android', url: ANDROID_URL },
      ]);
    },
  );

  it('gives a cached build the kind its listing names', async () => {
    const test = setup();
    answerRecordedList(test);
    const first = await (await createBackend(test.services)).list(GAME, 20);
    const file = JSON.parse(await test.dataFiles.read(CACHE_FILE));
    file.games['tiki-smash'][0].kind = 'qa';
    await test.dataFiles.write(CACHE_FILE, JSON.stringify(file));
    const fresh = await createBackend(test.services);
    const before = test.processes.runs.length;

    const records = await fresh.list(GAME, 20);

    expect(records[2]).toEqual(first[2]);
    expect(detailIds(test.processes.runs.slice(before))).not.toContain(
      '821200',
    );
  });

  it('keeps the links of the logs read when one log call rejects', async () => {
    const test = setup();
    answerRecordedList(test);
    test.answer(logArgs('821196'), new Error('HTTP 500'));
    const backend = await createBackend(test.services);

    const records = await backend.list(GAME, 20);

    expect(records[2].links).toEqual([{ label: 'iOS', url: IOS_URL }]);
    expect(await cachedIds(test)).toEqual(['821150']);

    const again = await backend.list(GAME, 20);

    expect(again[2]).toEqual(records[2]);
  });

  it.each([
    {
      name: 'reads no logs for a build past the link window',
      finishDate: '20261123T183412+0000',
      logs: [],
    },
    {
      name: 'reads the logs of a finished build with no finishDate',
      finishDate: undefined,
      logs: ['821193', '821196', '821198'],
    },
  ])('$name', async ({ finishDate, logs }) => {
    const test = setup();
    // `20261127T000000+0000`
    test.setNow(1795737600000);
    answerRecordedList(test);
    test.answer(runListArgs(DEV, 20), {
      build: runListDev.build.map((build) =>
        build.id === 821200 ? { ...build, finishDate } : build,
      ),
    });
    const backend = await createBackend(test.services);

    await backend.list(GAME, 20);

    const jobsOf821200 = ['821193', '821198', '821196'];
    expect(
      logIds(test.processes.runs)
        .filter((id) => jobsOf821200.includes(id))
        .sort(),
    ).toEqual(logs);
  });

  it('never has more than MAX_CALLS_IN_FLIGHT detail and log calls running', async () => {
    const test = setup();
    const ids = Array.from({ length: MAX_CALLS_IN_FLIGHT + 2 }, (_, index) =>
      String(830000 + index),
    );
    test.answer(runListArgs(DEV, 20), {
      build: ids.map((id) => ({
        id: Number(id),
        buildTypeId: DEV,
        number: `0.12.0.${id}`,
        state: 'finished',
        status: 'SUCCESS',
        branchName: 'protos/physics-fun',
        queuedDate: '20261123T180000+0000',
        finishDate: '20261123T183000+0000',
      })),
    });
    test.answer(runListArgs(RELEASE, 20), { build: [] });
    test.answer(QUEUE_ARGS, { build: [] });
    const details = new Map(
      ids.map((id) => {
        const detail = deferred<ProcessResult>();
        test.answer(detailArgs(id), detail.promise);
        return [id, detail] as const;
      }),
    );
    const backend = await createBackend(test.services);
    const started = () => detailIds(test.processes.runs);
    // Settles the `index`th detail call that started, with a finished chain of no jobs.
    const settleStarted = (index: number) => {
      const id = started()[index];
      details
        .get(id)
        ?.resolve(
          exited(JSON.stringify({ id: Number(id), state: 'finished' })),
        );
    };

    const listing = backend.list(GAME, 20);

    await settle();
    expect(started()).toHaveLength(MAX_CALLS_IN_FLIGHT);

    settleStarted(0);
    await settle();
    expect(started()).toHaveLength(MAX_CALLS_IN_FLIGHT + 1);

    settleStarted(1);
    await settle();
    expect(started()).toHaveLength(MAX_CALLS_IN_FLIGHT + 2);
    for (const index of ids.keys()) {
      settleStarted(index);
    }

    expect(await listing).toHaveLength(MAX_CALLS_IN_FLIGHT + 2);
  });
});

describe('queue', () => {
  const runStartArgs = (revision: string | null) => [
    'run',
    'start',
    DEV,
    '--branch',
    'feature/x',
    ...(revision === null ? [] : ['--revision', revision]),
    '--no-push',
    '--json',
  ];

  it('starts the chain pinned, without a push, and gives its id', async () => {
    const test = setup();
    test.answer(runStartArgs(A), runStart);
    const backend = await createBackend(test.services);

    const queued = await backend.queue(GAME, {
      kind: 'dev',
      branch: 'feature/x',
      revision: A,
    });

    expect(queued).toEqual({ id: '821339' });
    expect(test.processes.runs.at(-1)?.args).toEqual([
      'run',
      'start',
      DEV,
      '--branch',
      'feature/x',
      '--revision',
      A,
      '--no-push',
      '--json',
      '--no-input',
    ]);
  });

  // A list of build 821339 alone, queued, its branch `<default>`.
  const answerDefaultBranchQueue = (test: Setup) => {
    test.answer(runListArgs(DEV, 20), { build: [] });
    test.answer(runListArgs(RELEASE, 20), { build: [] });
    test.answer(QUEUE_ARGS, {
      build: [
        {
          id: 821339,
          buildTypeId: DEV,
          state: 'queued',
          branchName: '<default>',
          queuedDate: '20261123T191020+0000',
          waitReason: 'Checking for changes is in progress',
        },
      ],
    });
  };

  it('shows the queued branch and revision while TeamCity reports <default>, across instances', async () => {
    const test = setup();
    test.answer(runStartArgs(A), runStart);
    answerDefaultBranchQueue(test);
    const backend = await createBackend(test.services);
    await backend.queue(GAME, {
      kind: 'dev',
      branch: 'feature/x',
      revision: A,
    });
    const fresh = await createBackend(test.services);

    const records = await fresh.list(GAME, 20);

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      branch: 'feature/x',
      revision: A,
      statusText: 'Checking for changes is in progress',
    });
  });

  it.each([
    {
      name: 'a pin queued at the link window',
      pin: { branch: 'feature/x', revision: A, queuedAt: NOW - LINK_WINDOW_MS },
      shows: { branch: 'feature/x', revision: A },
    },
    {
      name: 'a pin queued past the link window',
      pin: {
        branch: 'feature/x',
        revision: A,
        queuedAt: NOW - LINK_WINDOW_MS - 1,
      },
      shows: { branch: 'protos/physics-fun', revision: null },
    },
    {
      name: 'a pin stored without its queue time',
      pin: { branch: 'feature/x', revision: A },
      shows: { branch: 'protos/physics-fun', revision: null },
    },
  ])('reads $name from the file', async ({ pin, shows }) => {
    const test = setup();
    await test.dataFiles.write(
      CACHE_FILE,
      JSON.stringify({ games: {}, pins: { '821339': pin } }),
    );
    answerDefaultBranchQueue(test);
    const backend = await createBackend(test.services);

    const records = await backend.list(GAME, 20);

    expect(records[0]).toMatchObject(shows);
  });

  it.each([
    {
      name: 'its build is cached',
      later: NOW + 1,
      next: 'list',
      pins: [],
    },
    {
      name: 'a queue at the link window',
      later: NOW + LINK_WINDOW_MS,
      next: 'queue',
      pins: ['821200', '821400'],
    },
    {
      name: 'a queue past the link window',
      later: NOW + LINK_WINDOW_MS + 1,
      next: 'queue',
      pins: ['821400'],
    },
  ])(
    "the file's pins of 821200 and a later build after $name",
    async ({ later, next, pins }) => {
      const test = setup();
      test.answer(runStartArgs(A), { id: 821200 });
      const backend = await createBackend(test.services);
      await backend.queue(GAME, {
        kind: 'dev',
        branch: 'feature/x',
        revision: A,
      });

      test.setNow(later);
      if (next === 'list') {
        answerRecordedList(test);
        await backend.list(GAME, 20);
      } else {
        test.answer(runStartArgs(A), { id: 821400 });
        await backend.queue(GAME, {
          kind: 'dev',
          branch: 'feature/x',
          revision: A,
        });
      }

      const file = JSON.parse(await test.dataFiles.read(CACHE_FILE));
      expect(Object.keys(file.pins).sort()).toEqual(pins);
    },
  );

  it.each([
    { name: 'an unknown kind', kind: 'qa', answer: null, message: 'qa' },
    {
      name: 'an answer with no build id',
      kind: 'dev',
      answer: {},
      message: 'teamcity run start gave no build id',
    },
  ])('queue rejects $name', async ({ kind, answer, message }) => {
    const test = setup();
    if (answer !== null) {
      test.answer(runStartArgs(A), answer);
    }
    const backend = await createBackend(test.services);

    await expect(
      backend.queue(GAME, { kind, branch: 'feature/x', revision: A }),
    ).rejects.toThrow(message);
  });

  it('leaves out --revision when the request pins none', async () => {
    const test = setup();
    test.answer(runStartArgs(null), runStart);
    const backend = await createBackend(test.services);

    await backend.queue(GAME, {
      kind: 'dev',
      branch: 'feature/x',
      revision: null,
    });

    expect(test.processes.runs.at(-1)?.args).not.toContain('--revision');
  });
});

describe('saveLog', () => {
  const logArgsOf = (id: string) => [
    'api',
    `/downloadBuildLog.html?buildId=${id}`,
  ];

  it.each([
    { case: 'a job', jobId: '821432', expectedId: '821432' },
    { case: 'the chain', jobId: null, expectedId: '821436' },
  ])('saves the log of $case', async ({ jobId, expectedId }) => {
    const test = setup();
    test.answer(logArgsOf(expectedId), 'LOG');
    const backend = await createBackend(test.services);

    await backend.saveLog?.(GAME, '821436', jobId, '/dl/x.log');

    expect(test.processes.runs.at(-1)?.args).toEqual([
      ...logArgsOf(expectedId),
      '--no-input',
    ]);
    expect(await test.files.read('/dl/x.log')).toBe('LOG');
  });

  it('rejects and writes nothing when the CLI fails', async () => {
    const test = setup();
    test.answer(
      logArgsOf('821432'),
      Promise.resolve<ProcessResult>({
        code: 1,
        stdout: '',
        stderr: 'no access',
        timedOut: false,
      }),
    );
    const backend = await createBackend(test.services);

    await expect(
      backend.saveLog?.(GAME, '821436', '821432', '/dl/x.log'),
    ).rejects.toThrow(
      'teamcity api /downloadBuildLog.html?buildId=821432 exited 1: no access',
    );
    expect(await test.files.stat('/dl/x.log')).toBeNull();
  });
});
