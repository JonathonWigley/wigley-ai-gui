import { readLayoutParts } from '../../../../shared/page/layout-host/read-layout-module';
import type { AudioPickerLayout } from '../../layouts/layout';

// Every part an audio picker layout may define.
const PARTS: Record<keyof AudioPickerLayout, true> = {
  head: true,
  moment: true,
  candidate: true,
  none: true,
  notes: true,
  confirmBody: true,
  dialogFrame: true,
};

// The audio picker layout a user's `layout.js` module exports as its default.
// A layout defines only the parts it changes; throws naming the first key that
// is no part, then the first part that is not a function.
export function readPickerLayout(
  module: unknown,
  name: string,
): AudioPickerLayout {
  return readLayoutParts<AudioPickerLayout>(module, name, PARTS);
}
