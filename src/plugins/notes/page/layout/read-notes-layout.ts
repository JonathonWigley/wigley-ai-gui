import { readLayoutModule } from '../../../../shared/page/layout-host/read-layout-module';
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
};

// The notes layout a user's `layout.js` module exports as its default. A
// layout defines only the parts it changes; throws as readLayoutModule does,
// or naming the first key that is no part, or the first part that is not a
// function.
export function readNotesLayout(module: unknown, name: string): Layout {
  const layout = readLayoutModule(module, name);
  for (const [key, part] of Object.entries(layout)) {
    if (!Object.hasOwn(LAYOUT_PARTS, key)) {
      throw new Error(`layout ${name}: ${key} is not a layout part`);
    }
    if (typeof part !== 'function') {
      throw new Error(`layout ${name}: ${key} is not a function`);
    }
  }
  return layout as Layout;
}
