// What the user config files share: reading one as a JSON object.

import { isJsonObject, type JsonObject } from '../../shared/json';

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
