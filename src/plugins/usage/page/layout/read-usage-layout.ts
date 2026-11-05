import { readLayoutParts } from '../../../../shared/page/layout-host/read-layout-module';
import type { Layout } from '../../layouts/layout';

// Every part a usage layout may define.
const LAYOUT_PARTS: Record<keyof Layout, true> = {
  statusLine: true,
  sessionLine: true,
  contextLine: true,
  spendLine: true,
  rowLine: true,
  rowCache: true,
  details: true,
};

// The usage layout a user's `layout.js` module exports as its default. A
// layout defines only the parts it changes; throws naming the first key that
// is no part, or the first defined part that is not a function.
export function readUsageLayout(module: unknown, name: string): Layout {
  return readLayoutParts<Layout>(module, name, LAYOUT_PARTS);
}
