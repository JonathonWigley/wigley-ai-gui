// A JSON object: what `JSON.parse` returns for `{…}`.
export type JsonObject = Record<string, unknown>;

// Whether `value` is a plain object, neither null nor an array.
export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
