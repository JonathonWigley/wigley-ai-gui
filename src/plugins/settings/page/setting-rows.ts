import type {
  SettingLeaf,
  SettingSection,
} from '../../../contracts/user-config';
import { userValue } from '../../../shared/json';
import type { SettingControlKind } from '../contract';

export interface SettingRow {
  leaf: SettingLeaf;
  // The user's value when set, else the fallback's value, else undefined (unset).
  value: unknown;
  isSet: boolean;
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
