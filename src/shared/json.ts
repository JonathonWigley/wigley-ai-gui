// A JSON object: what `JSON.parse` returns for `{…}`.
export type JsonObject = Record<string, unknown>;

// Whether `value` is a plain object, neither null nor an array.
export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
