import { describe, expect, it } from 'vitest';
import type {
  BackendView,
  BuildRecord,
  BuildsSnapshot,
  GameView,
  SessionBuilds,
  SetRunView,
} from '../contract';
import { buildRecord, gameEntry } from '../contract.test-support';
import {
  type BuildsEntryKey,
  buildRowInput,
  emptyReason,
  type FeedFilter,
  feedRows,
  type GameListItem,
  gameDot,
  gameRows,
  heldKey,
  linkedBuilds,
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
    capabilities: { cancel: true, choosesBranch: false },
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
    triggeredBy: string | null;
    expected: string | null;
  }>([
    {
      case: 'a linked session row',
      linked: [['a/b1', 's1']],
      labels: [['s1', 'Fix jump']],
      triggeredBy: 'ci-bot',
      expected: 'Fix jump',
    },
    {
      case: 'a link whose row is gone',
      linked: [['a/b1', 's9']],
      labels: [],
      triggeredBy: 'ci-bot',
      expected: 'ci-bot',
    },
    {
      case: 'no link',
      linked: [],
      labels: [],
      triggeredBy: 'ci-bot',
      expected: 'ci-bot',
    },
    {
      case: 'no link and no trigger',
      linked: [],
      labels: [],
      triggeredBy: null,
      expected: null,
    },
  ])('$case', ({ linked, labels, triggeredBy, expected }) => {
    expect(
      queuedBy('a/b1', triggeredBy, new Map(linked), new Map(labels)),
    ).toBe(expected);
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
        dev: { label: 'Dev', target: null },
        release: { label: 'Release', target: null },
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
