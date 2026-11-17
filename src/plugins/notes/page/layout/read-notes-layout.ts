import { readLayoutParts } from '../../../../shared/page/layout-host/read-layout-module';
import type { Layout } from '../../layouts/layout';

// Every part a notes layout may define, so a part added to the contract and
// missed here fails to compile.
const LAYOUT_PARTS: Record<keyof Layout, true> = {
  row: true,
  target: true,
  tags: true,
  images: true,
  image: true,
  session: true,
  actions: true,
  confirm: true,
  markupToolbar: true,
  pickerRow: true,
  cursorPrompt: true,
  dialogFrame: true,
};

// The notes layout a user's `layout.js` module exports as its default. A
// layout defines only the parts it changes; throws as readLayoutParts does.
export function readNotesLayout(module: unknown, name: string): Layout {
  return readLayoutParts<Layout>(module, name, LAYOUT_PARTS);
}
