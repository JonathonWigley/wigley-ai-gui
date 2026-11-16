import type {
  SettingLeaf,
  SettingSection,
} from '../../../contracts/user-config';
import { isJsonObject } from '../../../shared/json';
import type { SettingControlKind } from '../contract';

export interface SettingRow {
  leaf: SettingLeaf;
  // The user's value when set, else the fallback's value, else undefined (unset).
  value: unknown;
  isSet: boolean;
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

// A value as its row prints it on one line: `Not set` when unset or null,
// else as `kind` prints it, or as JSON when no registration holds the row's
// kind.
export function valueText(
  value: unknown,
  kind: SettingControlKind | undefined,
): string {
  if (value === undefined || value === null) {
    return 'Not set';
  }
  return kind === undefined ? JSON.stringify(value) : kind.text(value);
}
