import type {
  SettingControl,
  SettingLeaf,
  SettingSection,
} from '../../../contracts/user-config';
import { errorText } from '../../../shared/error-text';
import { isJsonObject } from '../../../shared/json';

export interface SettingRow {
  leaf: SettingLeaf;
  // The user's value when set, else the fallback's value, else undefined (unset).
  value: unknown;
  isSet: boolean;
}

// What a text box's text commits as: a value, the setting left unset, or a
// problem shown under the box.
export type BoxValue =
  | { type: 'value'; value: unknown }
  | { type: 'unset' }
  | { type: 'problem'; problem: string };

// The user's value at a dotted `path` of `layer`; `isSet` false when a key on
// the path is missing or a step is not an object.
function userValue(
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

// One row per leaf of `section`, in declaration order, read from the user's
// settings layer (null: no file).
export function settingRows(
  section: SettingSection,
  layer: Record<string, unknown> | null,
): SettingRow[] {
  return section.leaves.map((leaf) => {
    const user = userValue(layer, leaf.path);
    const value = user.isSet ? user.value : leaf.fallback?.value;
    return { leaf, value, isSet: user.isSet };
  });
}

// A value as its row prints it on one line.
export function valueText(value: unknown, control: SettingControl): string {
  if (value === undefined || value === null) {
    return 'Not set';
  }
  return control.kind === 'json' ? JSON.stringify(value) : String(value);
}

// What the text of a number, string or JSON box commits as. Throws for a
// control that opens no text box.
export function parseBoxText(text: string, control: SettingControl): BoxValue {
  switch (control.kind) {
    case 'number': {
      if (text.trim() === '') {
        return { type: 'unset' };
      }
      const value = Number(text);
      return Number.isFinite(value)
        ? { type: 'value', value }
        : { type: 'problem', problem: 'Enter a number' };
    }
    case 'string':
      return text === '' ? { type: 'unset' } : { type: 'value', value: text };
    case 'json':
      if (text.trim() === '') {
        return { type: 'unset' };
      }
      try {
        return { type: 'value', value: JSON.parse(text) };
      } catch (error) {
        return {
          type: 'problem',
          problem: `Not valid JSON: ${errorText(error)}`,
        };
      }
    default:
      throw new Error(`A ${control.kind} setting opens no text box`);
  }
}

// The text a row's box opens with.
export function boxText(row: SettingRow): string {
  if (row.value === undefined || row.value === null) {
    return '';
  }
  return row.leaf.control.kind === 'json'
    ? JSON.stringify(row.value, null, 2)
    : String(row.value);
}
