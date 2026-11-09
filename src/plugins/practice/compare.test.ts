import { describe, expect, it } from 'vitest';
import { answersMatch } from './compare';
import type { CompareMode, JsonValue } from './problem';

describe('answersMatch', () => {
  it.each<{
    expected: JsonValue;
    actual: JsonValue;
    mode: CompareMode;
    match: boolean;
  }>([
    { expected: [1, 2], actual: [2, 1], mode: 'exact', match: false },
    { expected: 'a', actual: 'a', mode: 'exact', match: true },
    {
      expected: [[1, 2], [3]],
      actual: [[3], [1, 2]],
      mode: 'anyOrder',
      match: true,
    },
    { expected: [[1, 2]], actual: [[2, 1]], mode: 'anyOrder', match: false },
    {
      expected: [[1, 2], [3]],
      actual: [[3], [2, 1]],
      mode: 'anyOrderDeep',
      match: true,
    },
    {
      expected: [[1, 2]],
      actual: [[1, 3]],
      mode: 'anyOrderDeep',
      match: false,
    },
    { expected: [1, 1, 2], actual: [1, 2, 2], mode: 'anyOrder', match: false },
    { expected: 3, actual: 3, mode: 'anyOrder', match: true },
    { expected: 0.333333, actual: 0.3333333333, mode: 'float', match: true },
    { expected: 1e9, actual: 1e9 + 5, mode: 'float', match: true },
    { expected: 1.0, actual: 1.0001, mode: 'float', match: false },
    {
      expected: [1.5, [2.000001]],
      actual: [1.5, [2]],
      mode: 'float',
      match: true,
    },
    { expected: null, actual: [], mode: 'exact', match: false },
  ])(
    '$mode: $expected against $actual is $match',
    ({ expected, actual, mode, match }) => {
      expect(answersMatch(expected, actual, mode)).toBe(match);
    },
  );
});
