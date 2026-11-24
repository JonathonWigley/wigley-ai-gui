import { describe, expect, it } from 'vitest';
import type {
  BackendView,
  BuildDownload,
  BuildRecord,
  BuildsSnapshot,
  GameView,
  SessionBuilds,
  SetRunView,
} from '../contract';
import { buildJob, buildRecord, gameEntry } from '../contract.test-support';
import {
  type BuildsEntryKey,
  buildHeaderInput,
  buildRowInput,
  type CursorMove,
  downloadId,
  emptyReason,
  type FeedFilter,
  feedRows,
  type GameListItem,
  gameDot,
  gameHeaderInput,
  gameRows,
  heldKey,
  jobGraphInput,
  jobLineInputs,
  jobPanelInput,
  linkedBuilds,
  movedKey,
  queueChoices,
  queuedBy,
  sideBarEntries,
} from './builds-view-model';

const NOW = 1_000_000;

function gameView(
  gameId: string,
  builds: BuildRecord[],
  changes: Partial<GameView> = {},
): GameView {
  return {
    backendId: 'a',
    game: gameEntry({ id: gameId, label: gameId.toUpperCase() }),
    builds,
    subjects: {},
    setRuns: [],
    files: {},
    listed: true,
    ...changes,
  };
}

function backendView(
  id: string,
  games: GameView[],
  changes: Partial<BackendView> = {},
): BackendView {
  return {
    id,
    kind: 'fixture',
    label: id.toUpperCase(),
    problem: null,
    capabilities: { cancel: true, choosesBranch: false, saveLog: false },
    neverLists: false,
    games,
    ...changes,
  };
}

function snapshot(backends: BackendView[]): BuildsSnapshot {
  return { backends, polledAt: NOW };
}

function setRun(id: string, buildIds: string[]): SetRunView {
  return {
    id,
    setId: 'rc',
    label: id,
    revision: null,
    builds: buildIds.map((buildId) => ({ backendId: 'a', buildId })),
  };
}

const noQueuedBy = () => null;

// A running save `id` of build `a/b1`, with `changes` over its fields.
function buildDownload(
  id: string,
  changes: Partial<BuildDownload> = {},
): BuildDownload {
  return {
    id,
    backendId: 'a',
    buildId: 'b1',
    label: 'Save',
    state: 'running',
    path: null,
    problem: null,
    startedAt: 0,
    ...changes,
  };
}

function downloadsOf(
  ...downloads: BuildDownload[]
): ReadonlyMap<string, BuildDownload> {
  return new Map(downloads.map((download) => [download.id, download]));
}

// Each item as `set <label> [ids]` or the build's id.
function itemIds(items: GameListItem[]): unknown[] {
  return items.map((item) =>
    item.kind === 'build'
      ? item.row.key
      : { set: item.group.label, rows: item.rows.map((row) => row.key) },
  );
}

describe('gameDot', () => {
  it.each([
    { case: 'no builds', builds: [], dot: 'idle' },
    {
      case: 'a queued newest',
      builds: [buildRecord({ state: 'queued', result: null })],
      dot: 'idle',
    },
    {
      case: 'a running newest',
      builds: [buildRecord({ state: 'running', result: null })],
      dot: 'running',
    },
    {
      case: 'a success',
      builds: [buildRecord({ result: 'success' })],
      dot: 'success',
    },
    {
      case: 'a failure',
      builds: [buildRecord({ result: 'failure' })],
      dot: 'error',
    },
    {
      case: 'a cancelled build',
      builds: [buildRecord({ result: 'cancelled' })],
      dot: 'warning',
    },
    {
      case: 'an older failure under a newer success',
      builds: [
        buildRecord({ id: 'old', result: 'failure', queuedAt: 100 }),
        buildRecord({ id: 'new', result: 'success', queuedAt: 200 }),
      ],
      dot: 'success',
    },
  ])('$case → $dot', ({ builds, dot }) => {
    expect(gameDot(builds)).toBe(dot);
  });
});

describe('sideBarEntries', () => {
  it('lists All, then each backend heading and its games', () => {
    const shown = snapshot([
      backendView('a', [gameView('a1', []), gameView('a2', [])], {
        label: 'A',
      }),
      backendView('b', [], { label: 'B', problem: 'games[0].id is missing' }),
    ]);

    expect(sideBarEntries(shown)).toEqual([
      { kind: 'all' },
      { kind: 'backend', backendId: 'a', label: 'A', problem: null },
      { kind: 'game', key: 'a/a1', label: 'A1', dot: 'idle' },
      { kind: 'game', key: 'a/a2', label: 'A2', dot: 'idle' },
      {
        kind: 'backend',
        backendId: 'b',
        label: 'B',
        problem: 'games[0].id is missing',
      },
    ]);
  });
});

describe('buildRowInput', () => {
  const subjects = { '2993a9e4c1': 'Fix the jump' };
  it.each([
    {
      case: 'a running build with 90 s left',
      record: buildRecord({ state: 'running', result: null, leftSeconds: 90 }),
      queuedBy: null,
      expected: { leftMs: 90_000 },
    },
    {
      case: 'a queued build starting later',
      record: buildRecord({
        state: 'queued',
        result: null,
        startEstimate: NOW + 150_000,
      }),
      queuedBy: null,
      expected: { startsInMs: 150_000 },
    },
    {
      case: 'a queued build past its estimate',
      record: buildRecord({
        state: 'queued',
        result: null,
        startEstimate: NOW - 5000,
      }),
      queuedBy: null,
      expected: { startsInMs: 0 },
    },
    {
      case: 'a queued build with no estimate',
      record: buildRecord({ state: 'queued', result: null }),
      queuedBy: null,
      expected: { startsInMs: null },
    },
    {
      case: 'a revision with a subject',
      record: buildRecord({ revision: '2993a9e4c1' }),
      queuedBy: null,
      expected: { shortRevision: '2993a9e4', subject: 'Fix the jump' },
    },
    {
      case: 'a revision absent from the subjects',
      record: buildRecord({ revision: '7c41d09be2' }),
      queuedBy: null,
      expected: { shortRevision: '7c41d09b', subject: null },
    },
    {
      case: 'a session label',
      record: buildRecord({ triggeredBy: 'ci-bot' }),
      queuedBy: 'Fix jump',
      expected: { queuedBy: 'Fix jump' },
    },
    {
      case: 'no session label',
      record: buildRecord({ triggeredBy: 'ci-bot' }),
      queuedBy: null,
      expected: { queuedBy: 'ci-bot' },
    },
  ])('$case', ({ record, queuedBy: label, expected }) => {
    const view = gameView('g1', [record], { subjects });

    expect(buildRowInput(record, view, label, NOW)).toMatchObject(expected);
  });
});

describe('jobLineInputs', () => {
  it('gives each job its time left in ms', () => {
    const record = buildRecord({
      jobs: [
        buildJob({
          id: 'ios',
          state: 'running',
          result: null,
          leftSeconds: 90,
        }),
        buildJob({ id: 'android', state: 'queued', result: null }),
      ],
    });

    expect(jobLineInputs(record).map((job) => job.leftMs)).toEqual([
      90_000,
      null,
    ]);
  });
});

describe('downloadId', () => {
  it.each<{
    target: { log: string | null } | { file: number };
    expected: string;
  }>([
    { target: { log: 'ios' }, expected: 'a/b1/log/ios' },
    { target: { log: null }, expected: 'a/b1/log' },
    { target: { file: 2 }, expected: 'a/b1/file/2' },
  ])('$target → $expected', ({ target, expected }) => {
    expect(downloadId('a', 'b1', target)).toBe(expected);
  });
});

describe('jobGraphInput', () => {
  it("lays each job's box in the graph's columns with its times", () => {
    const record = buildRecord({
      id: 'b1',
      jobs: [
        buildJob({ id: 'a', startedAt: 1_000_000, finishedAt: 1_300_000 }),
        buildJob({ id: 'b', startedAt: 2_000, finishedAt: 1_000 }),
        buildJob({
          id: 'c',
          state: 'running',
          result: null,
          leftSeconds: 90,
          dependsOn: ['a'],
        }),
      ],
    });
    const graph = {
      columns: [['b', 'a'], ['c']],
      edges: [{ from: 'a', to: 'c' }],
    };

    const input = jobGraphInput(record, graph);

    expect(
      input.columns.map((boxes) =>
        boxes.map(({ id, durationMs, leftMs }) => ({ id, durationMs, leftMs })),
      ),
    ).toEqual([
      [
        { id: 'b', durationMs: 0, leftMs: null },
        { id: 'a', durationMs: 300_000, leftMs: null },
      ],
      [{ id: 'c', durationMs: null, leftMs: 90_000 }],
    ]);
    expect(input.edges).toEqual([{ from: 'a', to: 'c' }]);
  });
});

describe('buildHeaderInput', () => {
  const files = {
    b1: [
      { label: 'APK', path: '/builds/game-a.apk', entry: 0 },
      { label: 'Zip', path: '/builds/game-a.zip', entry: 2 },
    ],
  };
  it.each<{
    case: string;
    record: BuildRecord;
    view?: Partial<GameView>;
    backend?: Partial<BackendView>;
    downloads?: BuildDownload[];
    now?: number;
    expected: object;
  }>([
    {
      case: 'files keep their entries and read their downloads',
      record: buildRecord({ id: 'b1' }),
      view: { files },
      downloads: [
        buildDownload('a/b1/file/2', {
          state: 'saved',
          path: '/home/u/Downloads/game-a-1.zip',
        }),
      ],
      expected: {
        files: [
          { entry: 0, label: 'APK', download: null },
          {
            entry: 2,
            label: 'Zip',
            download: {
              state: 'saved',
              fileName: 'game-a-1.zip',
              problem: null,
            },
          },
        ],
      },
    },
    {
      case: 'a Windows path names the same file',
      record: buildRecord({ id: 'b1' }),
      view: { files },
      downloads: [
        buildDownload('a/b1/file/0', {
          state: 'saved',
          path: 'C:\\Users\\u\\Downloads\\game-a-1.zip',
        }),
      ],
      expected: {
        files: [
          {
            entry: 0,
            download: { state: 'saved', fileName: 'game-a-1.zip' },
          },
          { entry: 2, download: null },
        ],
      },
    },
    {
      case: 'a build the files lack',
      record: buildRecord({ id: 'b9' }),
      view: { files },
      expected: { files: [] },
    },
    {
      case: 'a build with no jobs',
      record: buildRecord({ id: 'b1', stepText: 'Archiving' }),
      expected: { stepText: 'Archiving' },
    },
    {
      case: 'a build with jobs',
      record: buildRecord({
        id: 'b1',
        stepText: 'Archiving',
        jobs: [buildJob()],
      }),
      expected: { stepText: null },
    },
    {
      case: 'a finished build on a backend that cancels',
      record: buildRecord({ id: 'b1' }),
      expected: { canCancel: true },
    },
    {
      case: 'a backend that cannot cancel',
      record: buildRecord({ id: 'b1' }),
      backend: {
        capabilities: { cancel: false, choosesBranch: false, saveLog: false },
      },
      expected: { canCancel: false },
    },
    {
      case: 'a start estimate ahead',
      record: buildRecord({
        id: 'b1',
        state: 'queued',
        result: null,
        startEstimate: 61_000,
      }),
      now: 1_000,
      expected: { startsInMs: 60_000 },
    },
    {
      case: 'a start estimate past',
      record: buildRecord({
        id: 'b1',
        state: 'queued',
        result: null,
        startEstimate: 500,
      }),
      now: 1_000,
      expected: { startsInMs: 0 },
    },
    {
      case: 'no start estimate',
      record: buildRecord({ id: 'b1', state: 'queued', result: null }),
      expected: { startsInMs: null },
    },
    {
      case: 'a revision with a subject',
      record: buildRecord({ id: 'b1', revision: '2993a9e4c1' }),
      view: { subjects: { '2993a9e4c1': 'Fix the jump' } },
      expected: { subject: 'Fix the jump' },
    },
  ])(
    '$case',
    ({ record, view, backend, downloads = [], now = NOW, expected }) => {
      const shown = gameView('g1', [record], view);

      const input = buildHeaderInput(
        record,
        shown,
        backendView('a', [shown], backend),
        downloadsOf(...downloads),
        now,
      );

      expect(input).toMatchObject(expected);
    },
  );
});

describe('jobPanelInput', () => {
  const ios = buildJob({
    id: 'ios',
    label: 'iOS',
    state: 'running',
    result: null,
    percent: 40,
    leftSeconds: 30,
    stepText: 'Compiling',
    webUrl: 'https://ci.test/ios',
  });
  const withJobs = buildRecord({
    id: 'b1',
    webUrl: 'https://ci.test/b1',
    jobs: [ios],
  });
  const noJobs = buildRecord({
    id: 'b1',
    stepText: 'Archiving',
    webUrl: 'https://ci.test/b1',
  });
  it.each<{
    case: string;
    record: BuildRecord;
    jobId: string | null;
    backend?: Partial<BackendView>;
    downloads?: BuildDownload[];
    expected: object;
  }>([
    {
      case: 'a job',
      record: withJobs,
      jobId: 'ios',
      expected: {
        label: 'iOS',
        isBuild: false,
        stepText: 'Compiling',
        percent: 40,
        leftMs: 30_000,
        webUrl: 'https://ci.test/ios',
        log: null,
      },
    },
    {
      case: 'a build with no jobs',
      record: noJobs,
      jobId: null,
      expected: {
        label: 'Dev',
        isBuild: true,
        stepText: 'Archiving',
        webUrl: 'https://ci.test/b1',
      },
    },
    {
      case: 'a backend that saves logs',
      record: withJobs,
      jobId: 'ios',
      backend: {
        capabilities: { cancel: true, choosesBranch: false, saveLog: true },
      },
      expected: { canSaveLog: true },
    },
    {
      case: 'a backend that cannot save logs',
      record: withJobs,
      jobId: 'ios',
      expected: { canSaveLog: false },
    },
    {
      case: "a job's failed save",
      record: withJobs,
      jobId: 'ios',
      downloads: [
        buildDownload('a/b1/log/ios', {
          state: 'failed',
          problem: 'disk full',
        }),
      ],
      expected: {
        log: { state: 'failed', fileName: null, problem: 'disk full' },
      },
    },
    {
      case: "the build's own save",
      record: noJobs,
      jobId: null,
      downloads: [
        buildDownload('a/b1/log', {
          state: 'saved',
          path: '/home/u/Downloads/b1.log',
        }),
      ],
      expected: { log: { state: 'saved', fileName: 'b1.log', problem: null } },
    },
  ])('$case', ({ record, jobId, backend, downloads = [], expected }) => {
    const view = gameView('g1', [record]);

    const input = jobPanelInput(
      record,
      jobId,
      view,
      backendView('a', [view], backend),
      downloadsOf(...downloads),
    );

    expect(input).toMatchObject(expected);
  });
});

describe('gameHeaderInput', () => {
  const game = gameEntry({
    id: 'g1',
    kinds: {
      dev: { label: 'Dev', target: null, downloads: [] },
      release: { label: 'Release', target: null, downloads: [] },
    },
    sets: [
      {
        id: 'rc',
        label: 'RC',
        kinds: ['dev', 'release'],
        branches: 'releases/*',
        agentPrompt: 'Make the RC set.',
      },
      {
        id: 'qa',
        label: 'QA',
        kinds: ['dev'],
        branches: 'qa/*',
        agentPrompt: null,
      },
    ],
  });

  it('gives a with-agent button only to a set with an agent prompt', () => {
    const input = gameHeaderInput(
      backendView('a', []),
      gameView('g1', [], { game }),
    );

    expect(
      [...input.kinds, ...input.sets].map(({ id, withAgent }) => ({
        id,
        withAgent,
      })),
    ).toEqual([
      { id: 'dev', withAgent: false },
      { id: 'release', withAgent: false },
      { id: 'rc', withAgent: true },
      { id: 'qa', withAgent: false },
    ]);
  });

  it.each<{
    case: string;
    changes: Partial<BackendView>;
    canQueue: boolean;
  }>([
    {
      case: 'a backend with no instance',
      changes: { capabilities: null, problem: null },
      canQueue: false,
    },
    {
      case: 'a backend with an instance and a problem',
      changes: { problem: 'the last poll failed' },
      canQueue: true,
    },
  ])('$case → canQueue $canQueue', ({ changes, canQueue }) => {
    const backend = backendView('a', [], changes);

    const input = gameHeaderInput(backend, gameView('g1', [], { game }));

    expect(input.canQueue).toBe(canQueue);
  });
});

describe('gameRows', () => {
  const build = (id: string, queuedAt: number) => buildRecord({ id, queuedAt });
  it.each([
    {
      case: 'a set run at the place of its newest build',
      builds: [
        build('b1', 100),
        build('b2', 300),
        build('b3', 200),
        build('b4', 250),
      ],
      setRuns: [setRun('s1', ['b2', 'b3'])],
      expected: [{ set: 's1', rows: ['a/b2', 'a/b3'] }, 'a/b4', 'a/b1'],
    },
    {
      case: 'a set run with a build not listed',
      builds: [build('b1', 100), build('b2', 300)],
      setRuns: [setRun('s1', ['b2', 'b9'])],
      expected: [{ set: 's1', rows: ['a/b2'] }, 'a/b1'],
    },
    {
      case: 'a set run with no listed build',
      builds: [build('b1', 100)],
      setRuns: [setRun('s1', ['b8', 'b9'])],
      expected: ['a/b1'],
    },
    {
      case: 'equal times in snapshot order',
      builds: [build('b1', 100), build('b4', 100)],
      setRuns: [],
      expected: ['a/b1', 'a/b4'],
    },
  ])('$case', ({ builds, setRuns, expected }) => {
    const view = gameView('g1', builds, { setRuns });

    expect(itemIds(gameRows(view, noQueuedBy, NOW))).toEqual(expected);
  });
});

describe('feedRows', () => {
  const shown = snapshot([
    backendView('a', [
      gameView('g1', [
        buildRecord({
          id: 'b1',
          state: 'running',
          result: null,
          queuedAt: 100,
        }),
        buildRecord({ id: 'b2', state: 'finished', queuedAt: 200 }),
      ]),
      gameView('g2', [
        buildRecord({ id: 'b3', state: 'queued', result: null, queuedAt: 300 }),
      ]),
    ]),
  ]);
  it.each<{ filter: FeedFilter; expected: string[] }>([
    { filter: 'all', expected: ['a/b3', 'a/b2', 'a/b1'] },
    { filter: 'running', expected: ['a/b3', 'a/b1'] },
    { filter: 'sessions', expected: ['a/b2'] },
  ])('$filter', ({ filter, expected }) => {
    const rows = feedRows(shown, filter, new Set(['a/b2']), noQueuedBy, NOW);

    expect(rows.map((row) => row.key)).toEqual(expected);
    expect(rows.every((row) => row.inFeed)).toBe(true);
  });
});

describe('queuedBy', () => {
  it.each<{
    case: string;
    linked: [string, string][];
    labels: [string, string][];
    expected: string | null;
  }>([
    {
      case: 'a linked session row',
      linked: [['a/b1', 's1']],
      labels: [['s1', 'Fix jump']],
      expected: 'Fix jump',
    },
    {
      case: 'a link whose row is gone',
      linked: [['a/b1', 's9']],
      labels: [['s1', 'Fix jump']],
      expected: null,
    },
    {
      case: 'another build linked',
      linked: [['a/b2', 's1']],
      labels: [['s1', 'Fix jump']],
      expected: null,
    },
  ])('$case', ({ linked, labels, expected }) => {
    expect(queuedBy('a/b1', new Map(linked), new Map(labels))).toBe(expected);
  });
});

describe('heldKey', () => {
  it.each([
    {
      before: ['a/1', 'a/2', 'a/3'],
      after: ['a/0', 'a/1', 'a/2', 'a/3'],
      key: 'a/2',
      expected: 'a/2',
    },
    {
      before: ['a/1', 'a/2', 'a/3'],
      after: ['a/1', 'a/3'],
      key: 'a/2',
      expected: 'a/3',
    },
    {
      before: ['a/1', 'a/2', 'a/3'],
      after: ['a/1', 'a/2'],
      key: 'a/3',
      expected: 'a/2',
    },
    { before: ['a/1'], after: ['a/5', 'a/6'], key: 'a/1', expected: 'a/5' },
    { before: [], after: ['a/5'], key: null, expected: 'a/5' },
    { before: ['a/1'], after: [], key: 'a/1', expected: null },
  ])(
    '$key from $before to $after → $expected',
    ({ before, after, key, expected }) => {
      expect(heldKey(before, after, key)).toBe(expected);
    },
  );
});

describe('movedKey', () => {
  const keys = ['a/1', 'a/2', 'a/3'];
  it.each<{
    keys: string[];
    key: string | null;
    move: CursorMove;
    expected: string | null;
  }>([
    { keys, key: 'a/2', move: 'down', expected: 'a/3' },
    { keys, key: 'a/2', move: 'up', expected: 'a/1' },
    { keys, key: 'a/3', move: 'down', expected: 'a/3' },
    { keys, key: 'a/1', move: 'up', expected: 'a/1' },
    { keys, key: 'a/2', move: 'top', expected: 'a/1' },
    { keys, key: 'a/2', move: 'bottom', expected: 'a/3' },
    { keys, key: 'a/9', move: 'down', expected: 'a/1' },
    { keys, key: null, move: 'up', expected: 'a/1' },
    { keys: [], key: 'a/2', move: 'down', expected: null },
  ])(
    '$move from $key over $keys → $expected',
    ({ keys: shown, key, move, expected }) => {
      expect(movedKey(shown, key, move)).toBe(expected);
    },
  );
});

describe('emptyReason', () => {
  const withBuilds = snapshot([
    backendView('a', [gameView('a1', [buildRecord()])]),
  ]);
  it.each<{
    case: string;
    shown: BuildsSnapshot;
    entry: BuildsEntryKey;
    rows: number;
    expected: ReturnType<typeof emptyReason>;
  }>([
    {
      case: 'no backends',
      shown: snapshot([]),
      entry: 'all',
      rows: 0,
      expected: 'noBackends',
    },
    {
      case: 'a backend with no games',
      shown: snapshot([backendView('a', [])]),
      entry: 'all',
      rows: 0,
      expected: 'noGames',
    },
    {
      case: 'the shown game has no builds',
      shown: snapshot([
        backendView('a', [gameView('a1', []), gameView('a2', [buildRecord()])]),
      ]),
      entry: 'a/a1',
      rows: 0,
      expected: 'noBuilds',
    },
    {
      case: 'the filter hides every build',
      shown: withBuilds,
      entry: 'all',
      rows: 0,
      expected: 'noMatches',
    },
    {
      case: 'no game has builds',
      shown: snapshot([backendView('a', [gameView('a1', [])])]),
      entry: 'all',
      rows: 0,
      expected: 'noBuilds',
    },
    {
      case: 'rows are shown',
      shown: withBuilds,
      entry: 'all',
      rows: 2,
      expected: null,
    },
  ])('$case → $expected', ({ shown, entry, rows, expected }) => {
    expect(emptyReason(shown, entry, rows)).toBe(expected);
  });
});

describe('queueChoices', () => {
  it('lists the kinds in key order, then the sets', () => {
    const game = gameEntry({
      kinds: {
        dev: { label: 'Dev', target: null, downloads: [] },
        release: { label: 'Release', target: null, downloads: [] },
      },
      sets: [
        {
          id: 'rc',
          label: 'RC',
          kinds: ['dev'],
          branches: 'releases/*',
          agentPrompt: null,
        },
      ],
    });

    expect(
      queueChoices(game).map((choice) => `${choice.kind} ${choice.id}`),
    ).toEqual(['kind dev', 'kind release', 'set rc']);
  });
});

describe('linkedBuilds', () => {
  it('maps each linked build to its session', () => {
    const sessions = new Map<string, SessionBuilds>([
      [
        's1',
        {
          builds: [
            { backendId: 'a', buildId: 'b1' },
            { backendId: 'a', buildId: 'b2' },
          ],
          offer: null,
        },
      ],
      ['s2', { builds: [{ backendId: 'b', buildId: 'b9' }], offer: null }],
    ]);

    expect(linkedBuilds(sessions)).toEqual(
      new Map([
        ['a/b1', 's1'],
        ['a/b2', 's1'],
        ['b/b9', 's2'],
      ]),
    );
  });
});
