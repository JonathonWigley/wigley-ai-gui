import { describe, expect, it } from 'vitest';
import type { UiState } from '../../../contracts/ui-state';
import { createProjectFavorites } from './project-favorites';
import { createSessionRecency } from './session-recency';

function uiStateHolding(entries: [string, unknown][]): UiState {
  const values = new Map(entries);
  return {
    get: (key) => values.get(key),
    set: (key, value) => values.set(key, value),
  };
}

describe('createSessionRecency', () => {
  it('recency_stampsArrivalOnceAndNeedsYouAlways', () => {
    const clock = { time: 5, now: () => clock.time };
    const state = uiStateHolding([]);
    const recency = createSessionRecency(clock, state);
    const stampsAfterReload = () =>
      Object.fromEntries(createSessionRecency(clock, state).stamps());

    expect(recency.noteArrived('s')).toBe(true);
    expect(stampsAfterReload()).toEqual({ s: 5 });

    clock.time = 7;
    expect(recency.noteArrived('s')).toBe(false);
    expect(createSessionRecency(clock, state).noteArrived('s')).toBe(false);
    expect(stampsAfterReload()).toEqual({ s: 5 });

    clock.time = 9;
    recency.noteNeedsYou('s');
    recency.noteNeedsYou('t');
    expect(Object.fromEntries(recency.stamps())).toEqual({ s: 9, t: 9 });
    expect(stampsAfterReload()).toEqual({ s: 9, t: 9 });

    recency.keepOnly(['t']);
    expect(stampsAfterReload()).toEqual({ t: 9 });

    clock.time = 11;
    expect(recency.noteArrived('s')).toBe(true);
    expect(Object.fromEntries(recency.stamps())).toEqual({ s: 11, t: 9 });
    expect(stampsAfterReload()).toEqual({ s: 11, t: 9 });
  });
});

describe('saved values', () => {
  const readRecency = (state: UiState) => [
    ...createSessionRecency({ now: () => 0 }, state)
      .stamps()
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
      case: 'non-number value',
      saved: { a: 'x' },
      read: readRecency,
      expected: [],
    },
    {
      key: 'recency',
      case: 'one bad value drops the whole record',
      saved: { a: 1, b: 'x' },
      read: readRecency,
      expected: [],
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
      expect(read(uiStateHolding([[key, saved]]))).toEqual(expected);
    },
  );
});
