import { readLayoutModule } from '../../../../shared/page/layout-host/read-layout-module';
import type { SettingsLayout } from '../../layouts/layout';

// Every part a settings layout may define; each is a function.
const LAYOUT_PARTS: Record<keyof SettingsLayout, true> = {
  sections: true,
  rows: true,
  sectionRow: true,
  settingRow: true,
  keyRow: true,
  leaderRow: true,
  advancedRow: true,
  groupHeader: true,
  empty: true,
  problem: true,
  pickerRow: true,
};

// The layout a user's `layout.js` module exports as its default. A layout
// defines only the parts it changes; throws as readLayoutModule does, or
// naming the first key that is no part, or the first part that is not a
// function.
export function readSettingsLayout(
  module: unknown,
  name: string,
): SettingsLayout {
  const layout = readLayoutModule(module, name);
  for (const key of Object.keys(layout)) {
    if (!Object.hasOwn(LAYOUT_PARTS, key)) {
      throw new Error(`layout ${name}: ${key} is not a layout part`);
    }
  }
  for (const [part, builder] of Object.entries(layout)) {
    const isValidPart = builder === undefined || typeof builder === 'function';
    if (!isValidPart) {
      throw new Error(`layout ${name}: ${part} is not a function`);
    }
  }
  return layout as SettingsLayout;
}
