import { readLayoutParts } from '../../../../shared/page/layout-host/read-layout-module';
import type { SchedulingLayout } from '../../layouts/layout';

// Every part a Schedules layout may define, so a part added to the contract and
// missed here fails to compile.
const LAYOUT_PARTS: Record<keyof SchedulingLayout, true> = {
  list: true,
  detail: true,
  editor: true,
  newTaskRow: true,
  taskRow: true,
  empty: true,
  notice: true,
  taskDetail: true,
  historyRow: true,
  fieldRow: true,
  pickerRow: true,
  confirmBody: true,
  dialogFrame: true,
};

// The Schedules layout a user's `layout.js` module exports as its default. A
// layout defines only the parts it changes; throws as readLayoutParts does.
export function readSchedulingLayout(
  module: unknown,
  name: string,
): SchedulingLayout {
  return readLayoutParts<SchedulingLayout>(module, name, LAYOUT_PARTS);
}
