import { readLayoutParts } from '../../../../shared/page/layout-host/read-layout-module';
import type { Layout } from '../../layouts/layout';

// Every part a workflow layout may define, so a part added to the contract
// and missed here fails to compile.
const LAYOUT_PARTS: Record<keyof Layout, true> = {
  chip: true,
  strip: true,
  sidePane: true,
};

// The workflow layout a user's `layout.js` module exports as its default. A
// layout defines only the parts it changes; throws as readLayoutParts does.
export function readWorkflowLayout(module: unknown, name: string): Layout {
  return readLayoutParts<Layout>(module, name, LAYOUT_PARTS);
}
