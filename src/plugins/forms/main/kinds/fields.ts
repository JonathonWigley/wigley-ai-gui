import { RoundError, type RoundErrorPath } from '../../contract';
import type { JsonObject } from '../../../../shared/json';

export const MIN_CHOICES = 2;

// A saved field's text, '' when it is not a string.
export function textOrEmpty(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function requireText(
  value: unknown,
  field: string,
  at: RoundErrorPath,
): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new RoundError({
      path: at,
      problem: `${field} must be a non-empty string.`,
      detail: 'Give it the text you would have written in the reply.',
    });
  }
  return value;
}

const ITEM_LAYOUT_DESCRIPTION =
  "The layout that draws this item's card, over the form's layout: a " +
  "folder name in the app's forms layouts folder.";

// The optional `layout` of a question, notice or finding in the tool schema.
export const ITEM_LAYOUT_SCHEMA: Record<string, unknown> = {
  type: 'string',
  description: ITEM_LAYOUT_DESCRIPTION,
};

// The round's or an item's layout name, kept as sent, or null when absent or
// null. Whether the layouts folder holds it is checked apart, so a saved round
// re-parses after its layout leaves the folder.
export function parseLayoutField(
  item: JsonObject,
  at: RoundErrorPath,
): string | null {
  const layout = item.layout;
  if (layout === undefined || layout === null) {
    return null;
  }
  if (typeof layout !== 'string' || layout.trim() === '') {
    throw new RoundError({
      path: at,
      problem: 'layout must be a layout name: a non-empty string.',
    });
  }
  return layout;
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
  at: RoundErrorPath,
): number {
  if (typeof raw !== 'number' || !Number.isInteger(raw)) {
    throw new RoundError({
      path: at,
      problem:
        `recommend must be the 1-based number of the recommended ` +
        `${optionNoun}, not ${pythonTypeName(raw)}.`,
    });
  }
  if (raw < 1 || raw > optionCount) {
    const options = `${optionCount} ${optionNoun}${optionCount === 1 ? '' : 's'}`;
    throw new RoundError({
      path: at,
      problem: `'${title}' has ${options}; recommend was ${raw}.`,
      detail: `Use a number from 1 to ${optionCount}.`,
    });
  }
  return raw;
}
