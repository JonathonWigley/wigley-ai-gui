// What the user config files share: reading one as a JSON object, and naming
// a value's JSON kind in a problem message.

import { isJsonObject, type JsonObject } from '../../shared/json';

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

// `text` parsed as a JSON object. Throws an Error whose message is the problem
// as the user reads it: not JSON, or not an object at the top level.
export function parseJsonObject(text: string): JsonObject {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`Not valid JSON: ${(error as SyntaxError).message}`);
  }
  if (!isJsonObject(parsed)) {
    throw new Error('The top level must be a JSON object.');
  }
  return parsed;
}
