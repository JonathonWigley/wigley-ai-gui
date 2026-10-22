import { RoundError } from '../round-error';
import type { JsonObject } from '../../../../shared/json';

export const MIN_CHOICES = 2;

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

// 'a'; 'a' and 'b'; 'a', 'b', and 'c'
export function quotedList(names: readonly string[]): string {
  const quoted = names.map((name) => `'${name}'`);
  if (quoted.length <= 2) {
    return quoted.join(' and ');
  }
  return `${quoted.slice(0, -1).join(', ')}, and ${quoted.at(-1)}`;
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

// optionNoun names one of the item's options in messages: 'choice', 'solution'.
export function parseRecommend(
  raw: unknown,
  title: string,
  optionCount: number,
  optionNoun: string,
  where: string,
): number {
  if (typeof raw !== 'number' || !Number.isInteger(raw)) {
    throw new RoundError(
      `${where}recommend must be the 1-based number of the recommended ` +
        `${optionNoun}, not ${pythonTypeName(raw)}.`,
    );
  }
  if (raw < 1 || raw > optionCount) {
    const options = `${optionCount} ${optionNoun}${optionCount === 1 ? '' : 's'}`;
    throw new RoundError(
      `${where}'${title}' has ${options}; recommend was ` +
        `${raw}. Use a number from 1 to ${optionCount}.`,
    );
  }
  return raw;
}
