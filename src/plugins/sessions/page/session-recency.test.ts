import { describe, expect, it } from 'vitest';
import type { UiState } from '../../../contracts/ui-state';
import type { SessionRow } from '../contract';
import { createProjectFavorites } from './project-favorites';
import { fakeUiState, sessionRow } from './session-fakes';
import { createSessionRecency } from './session-recency';

function rowUnderHost(sessionId: string, hostSessionId: string): SessionRow {
  return { ...sessionRow(sessionId), hostSessionId };
}

describe('createSessionRecency', () => {
  it('recency_stampsArrivalOnceAndNeedsYouUntilItEnds', () => {
    const clock = { time: 5, now: () => clock.time };
    const state = fakeUiState();
    const recency = createSessionRecency(clock, state);
    const s = sessionRow('s');
    const t = sessionRow('t');
    const stampsAfterReload = (rows: SessionRow[]) =>
      Object.fromEntries(createSessionRecency(clock, state).stampsOf(rows));

    recency.rowsChanged(null, [s]);
    expect(stampsAfterReload([s])).toEqual({ s: 5 });

    clock.time = 7;
    recency.rowsChanged([s], [s]);
    createSessionRecency(clock, state).rowsChanged(null, [s]);
    expect(stampsAfterReload([s])).toEqual({ s: 5 });

    clock.time = 9;
    recency.noteNeedsYou(s);
    recency.rowsChanged([s], [s, t]);
    expect(Object.fromEntries(recency.stampsOf([s, t]))).toEqual({
      s: 9,
      t: 9,
    });

    clock.time = 10;
    recency.noteNeedsYou(s);
    createSessionRecency(clock, state).noteNeedsYou(s);
    expect(stampsAfterReload([s, t])).toEqual({ s: 9, t: 9 });

    recency.needsYouEnded(s.sessionId);
    recency.noteNeedsYou(s);
    expect(stampsAfterReload([s, t])).toEqual({ s: 10, t: 9 });

    recency.rowsChanged([s, t], [t]);
    expect(stampsAfterReload([s, t])).toEqual({ t: 9 });

    clock.time = 11;
    recency.rowsChanged([t], [t, s]);
    expect(stampsAfterReload([s, t])).toEqual({ s: 11, t: 9 });
  });

  it('recency_RelaunchDropsNeedsYouMarksButNotStamps', () => {
    const clock = { time: 1, now: () => clock.time };
    const state = fakeUiState();
    const firstRun = rowUnderHost('old', 'h');
    const recency = createSessionRecency(clock, state);
    recency.rowsChanged(null, [firstRun]);
    recency.noteNeedsYou(firstRun);

    clock.time = 2;
    const relaunched = createSessionRecency(clock, state);
    const secondRun = rowUnderHost('new', 'h');
    relaunched.rowsChanged(null, [secondRun]);
    expect(relaunched.stampsOf([secondRun]).get('new')).toBe(1);

    relaunched.noteNeedsYou(secondRun);
    expect(relaunched.stampsOf([secondRun]).get('new')).toBe(2);
  });

  it('recency_DropsTheOldestStampsPastTheCap', () => {
    const saved = Object.fromEntries(
      Array.from({ length: 200 }, (_, index) => [`h${index}`, index]),
    );
    const state = fakeUiState([['recency', { stamps: saved, needsYou: [] }]]);
    const recency = createSessionRecency({ now: () => 1000 }, state);
    const newest = sessionRow('newest');

    recency.rowsChanged(null, [newest]);

    const after = createSessionRecency({ now: () => 0 }, state);
    const stampOf = (key: string) => after.stampsOf([sessionRow(key)]).get(key);
    expect(stampOf('h0')).toBeUndefined();
    expect(stampOf('h1')).toBe(1);
    expect(stampOf('newest')).toBe(1000);
  });
});

describe('saved values', () => {
  const readRecency = (state: UiState) => [
    ...createSessionRecency({ now: () => 0 }, state)
      .stampsOf([sessionRow('a'), sessionRow('b')])
      .keys(),
  ];
  const readFavorites = (state: UiState) => [
    ...createProjectFavorites(state).list(),
  ];

  it.each<{
    key: string;
    case: string;
    saved: unknown;
    read: (state: UiState) => string[];
    expected: string[];
  }>([
    {
      key: 'recency',
      case: 'null',
      saved: null,
      read: readRecency,
      expected: [],
    },
    {
      key: 'recency',
      case: 'array',
      saved: [],
      read: readRecency,
      expected: [],
    },
    {
      key: 'recency',
      case: 'a record with no needs you list',
      saved: { stamps: { a: 1 } },
      read: readRecency,
      expected: [],
    },
    {
      key: 'recency',
      case: 'one bad stamp drops the whole record',
      saved: { stamps: { a: 1, b: 'x' }, needsYou: [] },
      read: readRecency,
      expected: [],
    },
    {
      key: 'recency',
      case: 'one bad needs you entry drops the whole record',
      saved: { stamps: { a: 1 }, needsYou: [1] },
      read: readRecency,
      expected: [],
    },
    {
      key: 'recency',
      case: 'a good record',
      saved: { stamps: { a: 1 }, needsYou: ['a'] },
      read: readRecency,
      expected: ['a'],
    },
    {
      key: 'favorites',
      case: 'null',
      saved: null,
      read: readFavorites,
      expected: [],
    },
    {
      key: 'favorites',
      case: 'array',
      saved: [],
      read: readFavorites,
      expected: [],
    },
    {
      key: 'favorites',
      case: 'object',
      saved: { a: 'x' },
      read: readFavorites,
      expected: [],
    },
    {
      key: 'favorites',
      case: 'one non-string drops the whole array',
      saved: ['a', 1],
      read: readFavorites,
      expected: [],
    },
    {
      key: 'favorites',
      case: 'one empty string drops the whole array',
      saved: ['a', ''],
      read: readFavorites,
      expected: [],
    },
    {
      key: 'favorites',
      case: 'duplicates read once in their first place',
      saved: ['b', 'a', 'b'],
      read: readFavorites,
      expected: ['b', 'a'],
    },
  ])(
    'savedValues_readInvalidAsEmpty: $key $case',
    ({ key, saved, read, expected }) => {
      expect(read(fakeUiState([[key, saved]]))).toEqual(expected);
    },
  );
});
