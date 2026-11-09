import { readLayoutParts } from '../../../../shared/page/layout-host/read-layout-module';
import type { SettingsLayout } from '../../layouts/layout';

// Every part a settings layout may define; each is a function.
const LAYOUT_PARTS: Record<keyof SettingsLayout, true> = {
  sections: true,
  rows: true,
  sectionRow: true,
  settingRow: true,
  pluginRow: true,
  keyRow: true,
  leaderRow: true,
  advancedRow: true,
  groupHeader: true,
  empty: true,
  problem: true,
  pickerRow: true,
};

// The layout a user's `layout.js` module exports as its default. A layout
// defines only the parts it changes; throws as readLayoutParts does.
export function readSettingsLayout(
  module: unknown,
  name: string,
): SettingsLayout {
  return readLayoutParts<SettingsLayout>(module, name, LAYOUT_PARTS);
}
