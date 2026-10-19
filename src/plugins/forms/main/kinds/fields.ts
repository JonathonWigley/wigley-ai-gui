import { RoundError } from '../round-error';

export const MIN_CHOICES = 2;
export const MAX_CHOICES = 10;

export type JsonObject = Record<string, unknown>;

export function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function requireText(
  value: unknown,
  field: string,
  where: string,
): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new RoundError(
      `${where}${field} must be a non-empty string. Give it the text you ` +
        `would have written in the reply.`,
    );
  }
  return value;
}

export function fieldsMissing(item: JsonObject, required: string[]): string[] {
  return required.filter((field) => !Object.hasOwn(item, field)).sort();
}

export function fieldsOutside(item: JsonObject, allowed: string[]): string[] {
  return Object.keys(item)
    .filter((field) => !allowed.includes(field))
    .sort();
}

// Python's type names, so messages read as they did from the Python server.
function pythonTypeName(value: unknown): string {
  if (value === null || value === undefined) {
    return 'NoneType';
  }
  if (typeof value === 'boolean') {
    return 'bool';
  }
  if (typeof value === 'number') {
    return Number.isInteger(value) ? 'int' : 'float';
  }
  if (typeof value === 'string') {
    return 'str';
  }
  return Array.isArray(value) ? 'list' : 'dict';
}

export function parseRecommend(
  raw: unknown,
  title: string,
  choiceCount: number,
  where: string,
): number {
  if (typeof raw !== 'number' || !Number.isInteger(raw)) {
    throw new RoundError(
      `${where}recommend must be the 1-based number of the recommended ` +
        `choice, not ${pythonTypeName(raw)}.`,
    );
  }
  if (raw < 1 || raw > choiceCount) {
    throw new RoundError(
      `${where}'${title}' has ${choiceCount} choices; recommend was ` +
        `${raw}. Use a number from 1 to ${choiceCount}.`,
    );
  }
  return raw;
}
