import { readLayoutParts } from '../../../../shared/page/layout-host/read-layout-module';
import type { Layout } from '../../layouts/layout';

// Every part a keys layout may define.
const LAYOUT_PARTS: Record<keyof Layout, true> = {
  help: true,
  helpSection: true,
  helpRow: true,
  whichKey: true,
  whichKeyEntry: true,
  leaderSearchRow: true,
  titleBarButton: true,
  dialogFrame: true,
};

// The keys layout a user's `layout.js` module exports as its default. A
// layout defines only the parts it changes; throws naming the first key that
// is no part, or the first defined part that is not a function.
export function readKeysLayout(module: unknown, name: string): Layout {
  return readLayoutParts<Layout>(module, name, LAYOUT_PARTS);
}
