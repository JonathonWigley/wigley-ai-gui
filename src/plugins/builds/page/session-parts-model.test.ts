import { describe, expect, it } from 'vitest';
import type { BuildRecord, BuildsSnapshot, SessionBuilds } from '../contract';
import {
  buildOffer,
  buildRecord,
  gameEntry,
} from '../contract.test-support';
import {
  hubBuildInputs,
  isBuilding,
  offerCardInput,
  rowLineInput,
} from './session-parts-model';

const ROCKET = gameEntry({
  id: 'rocket',
  label: 'Rocket Run',
  kinds: {
    dev: { label: 'Dev', target: null },
    release: { label: 'Release', target: null },
  },
  sets: [
    {
      id: 'rc',
      label: 'RC set',
      kinds: ['dev', 'release'],
      branches: 'releases/*',
      agentPrompt: null,
    },
  ],
});

// Backend `work` listing `builds` for game Rocket Run.
function snapshotOf(builds: BuildRecord[]): BuildsSnapshot {
  return {
    polledAt: 0,
    backends: [
      {
        id: 'work',
        kind: 'fixture',
        label: 'Work',
        problem: null,
        capabilities: { cancel: true, choosesBranch: true },
        games: [
          {
            backendId: 'work',
            game: ROCKET,
            builds,
            subjects: {},
            setRuns: [],
          },
        ],
      },
    ],
  };
}

// Session builds linking `ids` of backend `work`, newest first, with no offer.
function linking(...ids: string[]): SessionBuilds {
  return {
    builds: ids.map((buildId) => ({ backendId: 'work', buildId })),
    offer: null,
  };
}

const record = (id: string, overrides: Partial<BuildRecord> = {}) =>
  buildRecord({ id, gameId: 'rocket', number: id, ...overrides });

const running = (id: string, overrides: Partial<BuildRecord> = {}) =>
  record(id, { state: 'running', result: null, ...overrides });

describe('rowLineInput', () => {
  it.each([
    { case: 'builds undefined', builds: undefined, listed: [], expected: null },
    { case: 'no refs', builds: linking(), listed: [], expected: null },
    {
      case: 'a newest ref the snapshot does not hold',
      builds: linking('332', '331'),
      listed: [running('331')],
      expected: null,
    },
    {
      case: 'a running newest',
      builds: linking('331'),
      listed: [running('331', { percent: 40, leftSeconds: 300 })],
      expected: {
        gameLabel: 'Rocket Run',
        kindLabel: 'Dev',
        number: '331',
        state: 'running',
        result: null,
        percent: 40,
        leftMs: 300000,
      },
    },
    {
      case: 'a failed newest over an older running build',
      builds: linking('332', '331'),
      listed: [
        record('332', { kind: 'release', result: 'failure' }),
        running('331', { percent: 40, leftSeconds: 300 }),
      ],
      expected: {
        gameLabel: 'Rocket Run',
        kindLabel: 'Release',
        number: '332',
        state: 'finished',
        result: 'failure',
        percent: null,
        leftMs: null,
      },
    },
  ])('$case', ({ builds, listed, expected }) => {
    expect(rowLineInput(builds, snapshotOf(listed))).toEqual(expected);
  });
});

describe('isBuilding', () => {
  it.each([
    { case: 'builds undefined', builds: undefined, listed: [], expected: false },
    {
      case: 'one finished build',
      builds: linking('7'),
      listed: [record('7')],
      expected: false,
    },
    {
      case: 'one running build',
      builds: linking('7'),
      listed: [running('7')],
      expected: true,
    },
    {
      case: 'one queued build',
      builds: linking('7'),
      listed: [record('7', { state: 'queued', result: null })],
      expected: true,
    },
    {
      case: 'a ref the snapshot does not hold',
      builds: linking('8'),
      listed: [record('7')],
      expected: false,
    },
  ])('$case', ({ builds, listed, expected }) => {
    expect(isBuilding(builds, snapshotOf(listed))).toBe(expected);
  });
});

describe('hubBuildInputs', () => {
  it('draws each held ref newest first and skips one the snapshot lacks', () => {
    const inputs = hubBuildInputs(
      linking('b3', 'b9', 'b1'),
      snapshotOf([
        record('b1', { branch: 'main', revision: '1234567890ab' }),
        running('b3', { branch: 'protos/rocket', revision: null }),
      ]),
    );

    expect(
      inputs.map(({ number, branch, shortRevision, state }) => ({
        number,
        branch,
        shortRevision,
        state,
      })),
    ).toEqual([
      {
        number: 'b3',
        branch: 'protos/rocket',
        shortRevision: null,
        state: 'running',
      },
      {
        number: 'b1',
        branch: 'main',
        shortRevision: '12345678',
        state: 'finished',
      },
    ]);
  });
});

describe('offerCardInput', () => {
  it.each([
    {
      case: 'a kind',
      offer: buildOffer({ backendId: 'work', gameId: 'rocket', kind: 'dev' }),
      expected: { gameLabel: 'Rocket Run', choiceLabel: 'Dev' },
    },
    {
      case: 'a set',
      offer: buildOffer({ backendId: 'work', gameId: 'rocket', kind: 'rc' }),
      expected: { gameLabel: 'Rocket Run', choiceLabel: 'RC set' },
    },
    {
      case: 'a game the snapshot does not hold',
      offer: buildOffer({ backendId: 'work', gameId: 'gone', kind: 'dev' }),
      expected: { gameLabel: 'gone', choiceLabel: 'dev' },
    },
  ])('labels $case', ({ offer, expected }) => {
    const input = offerCardInput('s1', offer, snapshotOf([]));

    expect({
      gameLabel: input.gameLabel,
      choiceLabel: input.choiceLabel,
    }).toEqual(expected);
  });

  it.each([
    { revision: 'abcdef1234', expected: 'abcdef12' },
    { revision: null, expected: null },
  ])('shortens revision $revision', ({ revision, expected }) => {
    const offer = buildOffer({
      backendId: 'work',
      gameId: 'rocket',
      revision,
    });

    expect(offerCardInput('s1', offer, snapshotOf([])).shortRevision).toBe(
      expected,
    );
  });
});
