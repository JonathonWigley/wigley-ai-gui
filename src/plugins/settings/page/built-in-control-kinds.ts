import { errorText } from '../../../shared/error-text';
import type { SettingBoxValue, SettingControlKind } from '../contract';

function parseNumber(text: string): SettingBoxValue {
  if (text.trim() === '') {
    return { type: 'unset' };
  }
  const value = Number(text);
  return Number.isFinite(value)
    ? { type: 'value', value }
    : { type: 'problem', problem: 'Enter a number' };
}

function parseString(text: string): SettingBoxValue {
  return text === '' ? { type: 'unset' } : { type: 'value', value: text };
}

function parseJson(text: string): SettingBoxValue {
  if (text.trim() === '') {
    return { type: 'unset' };
  }
  try {
    return { type: 'value', value: JSON.parse(text) };
  } catch (error) {
    return { type: 'problem', problem: `Not valid JSON: ${errorText(error)}` };
  }
}

// The kinds the settings page registers itself, in this order: a number or
// string in a line box, a boolean, a closed choice or a theme in the list
// picker, and an array or other structured value as JSON in a document box.
export const BUILT_IN_CONTROL_KINDS: readonly SettingControlKind[] = [
  {
    id: 'number',
    text: String,
    edit: { type: 'box', box: 'line', text: String, parse: parseNumber },
  },
  {
    id: 'string',
    text: String,
    edit: { type: 'box', box: 'line', text: String, parse: parseString },
  },
  {
    id: 'boolean',
    text: String,
    edit: { type: 'picker', items: () => [true, false], label: String },
  },
  {
    id: 'choice',
    text: String,
    edit: {
      type: 'picker',
      items: ({ leaf }) => leaf.control.choices ?? [],
      label: String,
    },
  },
  {
    id: 'theme',
    text: String,
    edit: {
      type: 'picker',
      items: ({ config }) => config.themes,
      label: String,
    },
  },
  {
    id: 'json',
    text: (value) => JSON.stringify(value),
    edit: {
      type: 'box',
      box: 'document',
      text: (value) => JSON.stringify(value, null, 2),
      parse: parseJson,
    },
  },
];
