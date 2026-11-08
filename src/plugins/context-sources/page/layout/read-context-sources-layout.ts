import { readLayoutParts } from '../../../../shared/page/layout-host/read-layout-module';
import type { Layout } from '../../layouts/layout';

// Every part a context-sources layout may define, so a part added to the contract and
// missed here fails to compile.
const LAYOUT_PARTS: Record<keyof Layout, true> = {
  breakdown: true,
};

// The context-sources layout a user's `layout.js` module exports as its default. A
// layout defines only the parts it changes; throws as readLayoutParts does.
export function readContextSourcesLayout(
  module: unknown,
  name: string,
): Layout {
  return readLayoutParts<Layout>(module, name, LAYOUT_PARTS);
}
