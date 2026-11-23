// A JSON object: what `JSON.parse` returns for `{…}`.
export type JsonObject = Record<string, unknown>;

// Whether `value` is a plain object, neither null nor an array.
export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// A value's JSON kind as a problem message names it.
export type JsonKind =
  | 'an object'
  | 'an array'
  | 'a string'
  | 'a number'
  | 'a boolean'
  | 'null';

// The JSON kind of a value `JSON.parse` returned.
export function jsonKind(value: unknown): JsonKind {
  if (value === null) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return 'an array';
  }
  switch (typeof value) {
    case 'string':
      return 'a string';
    case 'number':
      return 'a number';
    case 'boolean':
      return 'a boolean';
    default:
      return 'an object';
  }
}

// The user's value at a dotted `path` of `layer`; `isSet` false when a key on
// the path is missing or a step is not an object.
export function userValue(
  layer: Record<string, unknown> | null,
  path: string,
): { isSet: boolean; value: unknown } {
  const keys = path.split('.');
  let parent: unknown = layer;
  for (const key of keys.slice(0, -1)) {
    parent = isJsonObject(parent) ? parent[key] : undefined;
  }
  const last = keys[keys.length - 1];
  if (!isJsonObject(parent) || !Object.hasOwn(parent, last)) {
    return { isSet: false, value: undefined };
  }
  return { isSet: true, value: parent[last] };
}

// Whether `value` is a string with at least one character.
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

// Whether `value` is an array holding only strings.
export function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === 'string')
  );
}

// The keys of `object` whose value JSON would write: an undefined value is
// left out, as `JSON.stringify` leaves it out.
function writtenKeys(object: JsonObject): string[] {
  return Object.keys(object).filter((key) => object[key] !== undefined);
}

// Whether two JSON values hold the same data: objects match by key in any
// order, arrays item by item in order, scalars by `===`.
export function isSameJson(a: unknown, b: unknown): boolean {
  const pending: [unknown, unknown][] = [[a, b]];
  for (let pair = pending.pop(); pair !== undefined; pair = pending.pop()) {
    const [left, right] = pair;
    if (left === right) {
      continue;
    }
    if (Array.isArray(left) && Array.isArray(right)) {
      if (left.length !== right.length) {
        return false;
      }
      left.forEach((item, index) => pending.push([item, right[index]]));
      continue;
    }
    if (isJsonObject(left) && isJsonObject(right)) {
      const keys = writtenKeys(left);
      const hasSameKeys =
        keys.length === writtenKeys(right).length &&
        keys.every((key) => right[key] !== undefined);
      if (!hasSameKeys) {
        return false;
      }
      keys.forEach((key) => pending.push([left[key], right[key]]));
      continue;
    }
    return false;
  }
  return true;
}
