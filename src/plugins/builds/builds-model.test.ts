import { describe, expect, it } from 'vitest';
import type { BuildRecord, BuildRef } from './contract';
import {
  buildJob,
  buildOffer,
  buildRecord,
  gameEntry,
} from './contract.test-support';
import {
  foldBuilds,
  kindLabel,
  shortRevision,
  UNLISTED_ACTIVE_MS,
  type BackendState,
  type BuildsEvent,
  type BuildsModelInput,
  type SessionLink,
  type SetRun,
} from './builds-model';

const NOW = 1_000_000;
const game = gameEntry({ id: 'g1' });

function record(id: string, overrides: Partial<BuildRecord> = {}): BuildRecord {
  return buildRecord({ id, gameId: 'g1', ...overrides });
}

const running = (id: string, overrides: Partial<BuildRecord> = {}) =>
  record(id, { state: 'running', result: null, ...overrides });
const queued = (id: string, overrides: Partial<BuildRecord> = {}) =>
  record(id, { state: 'queued', result: null, ...overrides });
const failedJob = (id: string) =>
  buildJob({ id, label: id, state: 'finished', result: 'failure' });
const runningJob = (id: string) =>
  buildJob({ id, label: id, state: 'running', result: null });

function backend(id: string, builds: BuildRecord[]): BackendState {
  return {
    id,
    kind: 'fixture',
    label: `Backend ${id}`,
    problem: null,
    capabilities: { cancel: true, choosesBranch: true },
    games: [{ game, builds, subjects: {} }],
  };
}

function link(overrides: Partial<SessionLink> = {}): SessionLink {
  return {
    sessionId: 's1',
    backendId: 'b1',
    buildId: 'x',
    setRunId: null,
    linkedAt: 0,
    failingNotified: false,
    notified: false,
    endedAt: null,
    ...overrides,
  };
}

function setRun(overrides: Partial<SetRun> = {}): SetRun {
  return {
    id: 'r1',
    setId: 'rc',
    label: 'RC set',
    backendId: 'b1',
    gameId: 'g1',
    sessionId: 's1',
    builds: [],
    revision: null,
    createdAt: 0,
    notified: false,
    endedAt: null,
    ...overrides,
  };
}

function refs(...buildIds: string[]): BuildRef[] {
  return buildIds.map((buildId) => ({ backendId: 'b1', buildId }));
}

function input(overrides: Partial<BuildsModelInput> = {}): BuildsModelInput {
  return {
    backends: [backend('b1', [])],
    links: [],
    setRuns: [],
    offers: {},
    polledAt: null,
    now: NOW,
    ...overrides,
  };
}

// The parts of an event a row names.
function summary(event: BuildsEvent): unknown {
  switch (event.kind) {
    case 'failing':
      return {
        kind: event.kind,
        sessionId: event.sessionId,
        buildId: event.ref.buildId,
        failedJobs: event.failedJobs.map((job) => job.id),
      };
    case 'ended':
      return {
        kind: event.kind,
        sessionId: event.sessionId,
        buildId: event.ref.buildId,
      };
    case 'setEnded':
      return {
        kind: event.kind,
        setRunId: event.setRun.id,
        builds: event.builds.map((build) => build.id),
      };
  }
}

describe('foldBuilds', () => {
  it.each([
    {
      case: 'failing once',
      input: input({
        backends: [
          backend('b1', [
            running('x', { jobs: [failedJob('ios'), runningJob('and')] }),
          ]),
        ],
        links: [link()],
      }),
      expected: [
        { kind: 'failing', sessionId: 's1', buildId: 'x', failedJobs: ['ios'] },
      ],
    },
    {
      case: 'failing, two jobs',
      input: input({
        backends: [
          backend('b1', [
            running('x', {
              jobs: [failedJob('and'), runningJob('web'), failedJob('ios')],
            }),
          ]),
        ],
        links: [link()],
      }),
      expected: [
        {
          kind: 'failing',
          sessionId: 's1',
          buildId: 'x',
          failedJobs: ['and', 'ios'],
        },
      ],
    },
    {
      case: 'failing in a set',
      input: input({
        backends: [backend('b1', [running('x', { jobs: [failedJob('ios')] })])],
        links: [link({ setRunId: 'r1' })],
      }),
      expected: [
        { kind: 'failing', sessionId: 's1', buildId: 'x', failedJobs: ['ios'] },
      ],
    },
    {
      case: 'failing told',
      input: input({
        backends: [backend('b1', [running('x', { jobs: [failedJob('ios')] })])],
        links: [link({ setRunId: 'r1', failingNotified: true })],
      }),
      expected: [],
    },
    {
      case: 'failing then ended',
      input: input({
        backends: [
          backend('b1', [
            record('x', { result: 'failure', jobs: [failedJob('ios')] }),
          ]),
        ],
        links: [link()],
      }),
      expected: [{ kind: 'ended', sessionId: 's1', buildId: 'x' }],
    },
    {
      case: 'ended once',
      input: input({
        backends: [backend('b1', [record('x')])],
        links: [link()],
      }),
      expected: [{ kind: 'ended', sessionId: 's1', buildId: 'x' }],
    },
    {
      case: 'ended told',
      input: input({
        backends: [backend('b1', [record('x')])],
        links: [link({ notified: true })],
      }),
      expected: [],
    },
    {
      case: 'set build ended',
      input: input({
        backends: [backend('b1', [record('x')])],
        links: [link({ setRunId: 'r1' })],
      }),
      expected: [],
    },
    {
      case: 'queued with failed job',
      input: input({
        backends: [backend('b1', [queued('x', { jobs: [failedJob('ios')] })])],
        links: [link()],
      }),
      expected: [
        { kind: 'failing', sessionId: 's1', buildId: 'x', failedJobs: ['ios'] },
      ],
    },
    {
      case: 'unknown build',
      input: input({
        backends: [backend('b1', [record('x')])],
        links: [link({ buildId: 'y' })],
      }),
      expected: [],
    },
    {
      case: 'unknown backend',
      input: input({
        backends: [backend('b1', [record('x')])],
        links: [link({ backendId: 'b9' })],
      }),
      expected: [],
    },
    {
      case: 'set running',
      input: input({
        backends: [backend('b1', [record('x'), running('z')])],
        setRuns: [setRun({ builds: refs('x', 'z') })],
      }),
      expected: [],
    },
    {
      case: 'set ended',
      input: input({
        backends: [backend('b1', [record('x'), record('z')])],
        setRuns: [setRun({ builds: refs('z', 'x') })],
      }),
      expected: [{ kind: 'setEnded', setRunId: 'r1', builds: ['z', 'x'] }],
    },
    {
      case: 'set told',
      input: input({
        backends: [backend('b1', [record('x'), record('z')])],
        setRuns: [setRun({ builds: refs('z', 'x'), notified: true })],
      }),
      expected: [],
    },
    {
      case: 'set without session',
      input: input({
        backends: [backend('b1', [record('x'), record('z')])],
        setRuns: [setRun({ builds: refs('z', 'x'), sessionId: null })],
      }),
      expected: [{ kind: 'setEnded', setRunId: 'r1', builds: ['z', 'x'] }],
    },
    {
      case: 'set ref unlisted, new',
      input: input({
        backends: [backend('b1', [record('x')])],
        setRuns: [
          setRun({
            builds: refs('x', 'y'),
            createdAt: NOW - UNLISTED_ACTIVE_MS + 1,
          }),
        ],
      }),
      expected: [],
    },
    {
      case: 'set ref unlisted, old',
      input: input({
        backends: [backend('b1', [record('x')])],
        setRuns: [
          setRun({
            builds: refs('x', 'y'),
            createdAt: NOW - UNLISTED_ACTIVE_MS,
          }),
        ],
      }),
      expected: [{ kind: 'setEnded', setRunId: 'r1', builds: ['x'] }],
    },
    {
      case: 'set empty',
      input: input({
        backends: [backend('b1', [record('x')])],
        setRuns: [setRun({ builds: [], createdAt: NOW - UNLISTED_ACTIVE_MS })],
      }),
      expected: [],
    },
  ])('reports $case', ({ input: modelInput, expected }) => {
    expect(foldBuilds(modelInput).events.map(summary)).toEqual(expected);
  });

  it('orders failing, then ended, then setEnded events', () => {
    const fold = foldBuilds(
      input({
        backends: [
          backend('b1', [
            record('z'),
            record('x'),
            running('w', { jobs: [failedJob('ios')] }),
          ]),
        ],
        setRuns: [setRun({ builds: refs('z') })],
        links: [link({ buildId: 'x' }), link({ buildId: 'w' })],
      }),
    );

    expect(fold.events.map((event) => event.kind)).toEqual([
      'failing',
      'ended',
      'setEnded',
    ]);
  });

  it("lists each session's builds newest first, with its offer", () => {
    const offer = buildOffer({ backendId: 'b1', gameId: 'g1' });

    const fold = foldBuilds(
      input({
        links: [
          link({ buildId: 'x', linkedAt: 100 }),
          link({ buildId: 'z', linkedAt: 200 }),
        ],
        offers: { s2: offer },
      }),
    );

    expect(fold.sessions).toEqual({
      s1: { builds: refs('z', 'x'), offer: null },
      s2: { builds: [], offer },
    });
  });

  it.each([
    {
      case: 'running',
      backends: [backend('b1', [running('x')])],
      links: [link()],
      active: ['b1'],
    },
    {
      case: 'queued',
      backends: [backend('b1', [queued('x')])],
      links: [link()],
      active: ['b1'],
    },
    {
      case: 'finished',
      backends: [backend('b1', [record('x')])],
      links: [link()],
      active: [],
    },
    {
      case: 'unlisted, new',
      backends: [backend('b1', [])],
      links: [link({ linkedAt: NOW - UNLISTED_ACTIVE_MS + 1 })],
      active: ['b1'],
    },
    {
      case: 'unlisted, old',
      backends: [backend('b1', [])],
      links: [link({ linkedAt: NOW - UNLISTED_ACTIVE_MS })],
      active: [],
    },
    {
      case: 'two backends',
      backends: [
        backend('b2', [queued('w')]),
        backend('b1', [running('x'), running('z')]),
      ],
      links: [
        link({ buildId: 'x' }),
        link({ buildId: 'z' }),
        link({ backendId: 'b2', buildId: 'w' }),
      ],
      active: ['b2', 'b1'],
    },
  ])('$case is active: $active', ({ backends, links, active }) => {
    expect(foldBuilds(input({ backends, links })).activeBackends).toEqual(
      active,
    );
  });

  it('publishes each backend in order, with its set runs newest first', () => {
    const b2 = backend('b2', [record('w')]);
    b2.games[0].subjects = { abc: 'Fix the thing' };

    const fold = foldBuilds(
      input({
        backends: [b2, backend('b1', [record('x')])],
        setRuns: [
          setRun({ id: 'r5', createdAt: 5, builds: refs('x') }),
          setRun({ id: 'r9', createdAt: 9, builds: refs('x') }),
          setRun({
            id: 'rb2',
            backendId: 'b2',
            builds: [{ backendId: 'b2', buildId: 'w' }],
          }),
        ],
        polledAt: 1234,
      }),
    );

    const views = fold.snapshot.backends;
    expect(views.map((view) => view.id)).toEqual(['b2', 'b1']);
    expect(views[1].games[0].setRuns.map((run) => run.id)).toEqual([
      'r9',
      'r5',
    ]);
    expect(views[0].games[0]).toEqual({
      backendId: 'b2',
      game,
      builds: [record('w')],
      subjects: { abc: 'Fix the thing' },
      setRuns: [
        {
          id: 'rb2',
          setId: 'rc',
          label: 'RC set',
          builds: [{ backendId: 'b2', buildId: 'w' }],
          revision: null,
        },
      ],
    });
    expect(fold.snapshot.polledAt).toBe(1234);
  });

  it.each([
    { kind: 'dev', expected: 'Dev' },
    { kind: 'gone', expected: 'gone' },
  ])('kindLabel of $kind is $expected', ({ kind, expected }) => {
    expect(kindLabel(gameEntry(), kind)).toBe(expected);
  });

  it('shortRevision keeps the first 8 characters', () => {
    expect(shortRevision('0123456789abcdef')).toBe('01234567');
  });
});
