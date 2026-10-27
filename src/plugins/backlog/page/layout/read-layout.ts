import { readLayoutModule } from '../../../../shared/page/layout-host/read-layout-module';
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
// layout defines only the parts it changes; throws as readLayoutModule does,
// or naming the first key that is no part, or the first part that is not a
// function.
export function readBacklogLayout(
  module: unknown,
  name: string,
): BacklogLayout {
  const layout = readLayoutModule(module, name);
  for (const [key, part] of Object.entries(layout)) {
    if (!Object.hasOwn(LAYOUT_PARTS, key)) {
      throw new Error(`layout ${name}: ${key} is not a layout part`);
    }
    if (typeof part !== 'function') {
      throw new Error(`layout ${name}: ${key} is not a function`);
    }
  }
  return layout as BacklogLayout;
}
