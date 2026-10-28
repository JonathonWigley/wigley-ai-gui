import { readLayoutParts } from '../../shared/page/layout-host/read-layout-module';
import type { Layout } from './layouts/layout';

// Every part a shell layout may define; each is a function.
const LAYOUT_PARTS: Record<keyof Layout, true> = {
  titleContext: true,
  devTag: true,
  configProblems: true,
  activityItem: true,
};

// The layout a user's `layout.js` module exports as its default. A layout
// defines only the parts it changes; throws as readLayoutParts does.
export function readShellLayout(module: unknown, name: string): Layout {
  return readLayoutParts<Layout>(module, name, LAYOUT_PARTS);
}
