import { readLayoutParts } from '../../../../shared/page/layout-host/read-layout-module';
import type { BacklogLayout } from '../../layouts/layout';

// Every part a Backlog layout may define, so a part added to the contract and
// missed here fails to compile.
const LAYOUT_PARTS: Record<keyof BacklogLayout, true> = {
  table: true,
  filters: true,
  tableRow: true,
  empty: true,
  tableStatus: true,
  review: true,
  reviewItem: true,
  commits: true,
  strip: true,
  chunkCard: true,
  newChunk: true,
  pickerRow: true,
};

// The Backlog layout a user's `layout.js` module exports as its default. A
// layout defines only the parts it changes; throws as readLayoutParts does.
export function readBacklogLayout(
  module: unknown,
  name: string,
): BacklogLayout {
  return readLayoutParts<BacklogLayout>(module, name, LAYOUT_PARTS);
}
