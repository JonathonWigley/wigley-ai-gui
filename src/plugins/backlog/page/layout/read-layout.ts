import { readLayoutParts } from '../../../../shared/page/layout-host/read-layout-module';
import type { BacklogLayout } from '../../layouts/layout';

// Every part a Backlog layout may define, so a part added to the contract and
// missed here fails to compile.
const LAYOUT_PARTS: Record<keyof BacklogLayout, true> = {
  homes: true,
  list: true,
  detail: true,
  editor: true,
  repoHeader: true,
  homeRow: true,
  groupHeader: true,
  followupRow: true,
  planRow: true,
  featureRow: true,
  taskRow: true,
  empty: true,
  followupDetail: true,
  docDetail: true,
  pickerRow: true,
  confirmBody: true,
};

// The Backlog layout a user's `layout.js` module exports as its default. A
// layout defines only the parts it changes; throws as readLayoutParts does.
export function readBacklogLayout(
  module: unknown,
  name: string,
): BacklogLayout {
  return readLayoutParts<BacklogLayout>(module, name, LAYOUT_PARTS);
}
