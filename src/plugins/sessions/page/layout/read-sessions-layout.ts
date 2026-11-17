import { readLayoutParts } from '../../../../shared/page/layout-host/read-layout-module';
import type { Layout } from '../../layouts/layout';

// Every part a sessions layout may define, so a part added to the contract and
// missed here fails to compile.
const LAYOUT_PARTS: Record<keyof Layout, true> = {
  sideBar: true,
  section: true,
  group: true,
  row: true,
  pane: true,
  tabBar: true,
  tab: true,
  emptyText: true,
  popup: true,
  popupBar: true,
  renameDialog: true,
  pickerRow: true,
};

// The sessions layout a user's `layout.js` module exports as its default. A
// layout defines only the parts it changes; throws as readLayoutParts does.
export function readSessionsLayout(module: unknown, name: string): Layout {
  return readLayoutParts<Layout>(module, name, LAYOUT_PARTS);
}
