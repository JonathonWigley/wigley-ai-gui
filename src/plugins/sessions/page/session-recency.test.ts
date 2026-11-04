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

  it.each<{
    case: string;
    stamps: Record<string, number>;
    before: SessionRow[];
    after: SessionRow[];
    saved: Record<string, number>;
  }>([
    {
      case: 'the old row leaving a shared key keeps it for the survivor',
      stamps: { h: 5 },
      before: [rowUnderHost('old', 'h'), rowUnderHost('new', 'h')],
      after: [rowUnderHost('new', 'h')],
      saved: { h: 5 },
    },
    {
      case: 'the last row leaving a key drops it',
      stamps: { h: 5, i: 7 },
      before: [rowUnderHost('new', 'h'), rowUnderHost('other', 'i')],
      after: [rowUnderHost('other', 'i')],
      saved: { i: 7 },
    },
    {
      case: 'a row moving off a shared key leaves it for the survivor',
      stamps: { h: 5 },
      before: [rowUnderHost('a', 'h'), rowUnderHost('b', 'h')],
      after: [rowUnderHost('a', 'i'), rowUnderHost('b', 'h')],
      saved: { h: 5, i: 5 },
    },
    {
      case: 'the only row on a key moving off it empties it',
      stamps: { h: 5 },
      before: [rowUnderHost('a', 'h')],
      after: [rowUnderHost('a', 'i')],
      saved: { i: 5 },
    },
    {
      case: 'both rows on a shared key moving off it each take the stamp',
      stamps: { h: 5 },
      before: [rowUnderHost('a', 'h'), rowUnderHost('b', 'h')],
      after: [rowUnderHost('a', 'i'), rowUnderHost('b', 'j')],
      saved: { i: 5, j: 5 },
    },
    {
      case: 'one row leaving as the other moves off their shared key',
      stamps: { h: 5 },
      before: [rowUnderHost('a', 'h'), rowUnderHost('b', 'h')],
      after: [rowUnderHost('b', 'i')],
      saved: { i: 5 },
    },
    {
      case: 'a row moving onto the key another row moves off',
      stamps: { h: 5, i: 7 },
      before: [rowUnderHost('a', 'h'), rowUnderHost('b', 'i')],
      after: [rowUnderHost('a', 'i'), rowUnderHost('b', 'j')],
      saved: { i: 5, j: 7 },
    },
    {
      case: 'a row added as the old row on its key leaves takes the stamp',
      stamps: { h: 5 },
      before: [rowUnderHost('old', 'h')],
      after: [rowUnderHost('new', 'h')],
      saved: { h: 5 },
    },
  ])(
    'recency_LeavingAKeyARowHoldsLeavesItsStamp: $case',
    ({ stamps, before, after, saved }) => {
      const state = fakeUiState([['recency', { stamps, needsYou: [] }]]);
      const recency = createSessionRecency({ now: () => 100 }, state);

      recency.rowsChanged(before, after);

      expect(state.get('recency')).toEqual({ stamps: saved, needsYou: [] });
    },
  );

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
