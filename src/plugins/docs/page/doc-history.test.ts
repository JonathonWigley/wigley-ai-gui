import { describe, expect, it } from 'vitest';
import {
  createDocHistory,
  DOC_HISTORY_LIMIT,
  type DocHistory,
  type DocPlace,
} from './doc-history';

type Call = 'back' | 'forward' | DocPlace;

const a: DocPlace = { path: 'a', line: null };
const b: DocPlace = { path: 'b', line: null };
const c: DocPlace = { path: 'c', line: null };

function apply(history: DocHistory, call: Call): DocPlace | null {
  if (call === 'back') {
    return history.back();
  }
  if (call === 'forward') {
    return history.forward();
  }
  history.push(call);
  return null;
}

function pushDistinctPlaces(count: number): {
  history: DocHistory;
  places: DocPlace[];
} {
  const history = createDocHistory();
  const places = Array.from({ length: count }, (_, index) => ({
    path: `place-${index}`,
    line: null,
  }));
  places.forEach((place) => history.push(place));
  return { history, places };
}

describe('createDocHistory', () => {
  it.each<{ given: string; calls: Call[]; expected: DocPlace | null }>([
    { given: 'new history, back', calls: ['back'], expected: null },
    { given: 'new history, forward', calls: ['forward'], expected: null },
    { given: 'one place, back', calls: [a, 'back'], expected: null },
    {
      given: 'at the last entry, forward',
      calls: [a, b, 'forward'],
      expected: null,
    },
    { given: 'back moves one', calls: [a, b, 'back'], expected: a },
    {
      given: 'forward undoes back',
      calls: [a, b, 'back', 'forward'],
      expected: b,
    },
    {
      given: 'push truncates forward',
      calls: [a, b, 'back', c, 'forward'],
      expected: null,
    },
    {
      given: 'push truncates, and the old entry is gone',
      calls: [a, b, 'back', c, 'back'],
      expected: a,
    },
    {
      given: 'same place twice adds one',
      calls: [a, a, 'back'],
      expected: null,
    },
    {
      given: 'same place keeps forward',
      calls: [a, b, 'back', a, 'forward'],
      expected: b,
    },
    {
      given: 'same path, other line is a new place',
      calls: [a, { path: 'a', line: 5 }, 'back'],
      expected: a,
    },
    {
      given: 'a failed back does not move',
      calls: [a, b, 'back', 'back', 'forward'],
      expected: b,
    },
  ])('docHistory_Moves: $given', ({ calls, expected }) => {
    const history = createDocHistory();

    const results = calls.map((call) => apply(history, call));

    expect(results.at(-1)).toEqual(expected);
  });

  it.each<{ given: string; calls: Call[]; expected: [boolean, boolean] }>([
    { given: 'new history', calls: [], expected: [false, false] },
    { given: 'one place', calls: [a], expected: [false, false] },
    { given: 'two places', calls: [a, b], expected: [true, false] },
    { given: 'after back', calls: [a, b, 'back'], expected: [false, true] },
    {
      given: 'after a push that truncates',
      calls: [a, b, 'back', c],
      expected: [true, false],
    },
    { given: 'a failed back', calls: [a, 'back'], expected: [false, false] },
    { given: 'the same place twice', calls: [a, a], expected: [false, false] },
  ])('docHistory_CanMove: $given', ({ calls, expected }) => {
    const history = createDocHistory();

    calls.forEach((call) => apply(history, call));

    expect([history.canBack(), history.canForward()]).toEqual(expected);
  });

  it('docHistory_Cap_DropsOldest', () => {
    const past = pushDistinctPlaces(DOC_HISTORY_LIMIT + 1);
    const pastResults = Array.from({ length: DOC_HISTORY_LIMIT }, () =>
      past.history.back(),
    );
    expect(pastResults.at(-1)).toBeNull();
    expect(pastResults.at(-2)).toEqual(past.places[1]);

    const atCap = pushDistinctPlaces(DOC_HISTORY_LIMIT);
    const atCapResults = Array.from({ length: DOC_HISTORY_LIMIT - 1 }, () =>
      atCap.history.back(),
    );
    expect(atCapResults.at(-1)).toEqual(atCap.places[0]);
  });
});
