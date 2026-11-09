import type { CompareMode, JsonValue } from './problem';

const FLOAT_TOLERANCE = 1e-5;

/** Whether a solution's answer matches the expected one under the problem's compare mode. */
export function answersMatch(
  expected: JsonValue,
  actual: JsonValue,
  mode: CompareMode,
): boolean {
  const bothArrays = Array.isArray(expected) && Array.isArray(actual);
  if (mode === 'float') {
    return deepEqual(expected, actual, floatsMatch);
  }
  if (mode === 'anyOrder' && bothArrays) {
    return deepEqual(sortedByKey(expected), sortedByKey(actual), numbersEqual);
  }
  if (mode === 'anyOrderDeep' && bothArrays) {
    return deepEqual(
      sortedByKey(expected.map(sortedIfArray)),
      sortedByKey(actual.map(sortedIfArray)),
      numbersEqual,
    );
  }
  return deepEqual(expected, actual, numbersEqual);
}

function sortedIfArray(value: JsonValue): JsonValue {
  return Array.isArray(value) ? sortedByKey(value) : value;
}

/** A copy sorted by each element's `JSON.stringify` text. */
function sortedByKey(values: JsonValue[]): JsonValue[] {
  return values
    .map((value) => ({ value, key: JSON.stringify(value) }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .map((entry) => entry.value);
}

function numbersEqual(a: number, b: number): boolean {
  return a === b;
}

function floatsMatch(a: number, b: number): boolean {
  const difference = Math.abs(a - b);
  return (
    difference <= FLOAT_TOLERANCE ||
    difference <= FLOAT_TOLERANCE * Math.max(Math.abs(a), Math.abs(b))
  );
}

function deepEqual(
  expected: JsonValue,
  actual: JsonValue,
  numbersMatch: (a: number, b: number) => boolean,
): boolean {
  const pending: [JsonValue, JsonValue][] = [[expected, actual]];
  for (let pair = pending.pop(); pair !== undefined; pair = pending.pop()) {
    const [a, b] = pair;
    if (typeof a === 'number' && typeof b === 'number') {
      if (!numbersMatch(a, b)) {
        return false;
      }
      continue;
    }
    if (Array.isArray(a) || Array.isArray(b)) {
      if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
        return false;
      }
      a.forEach((element, index) => pending.push([element, b[index]]));
      continue;
    }
    const bothObjects =
      typeof a === 'object' &&
      a !== null &&
      typeof b === 'object' &&
      b !== null;
    if (!bothObjects) {
      if (a !== b) {
        return false;
      }
      continue;
    }
    const keys = Object.keys(a);
    const sameKeys =
      keys.length === Object.keys(b).length &&
      keys.every((key) => Object.hasOwn(b, key));
    if (!sameKeys) {
      return false;
    }
    keys.forEach((key) => pending.push([a[key], b[key]]));
  }
  return true;
}
