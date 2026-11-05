import { readLayoutParts } from '../../../../shared/page/layout-host/read-layout-module';
import type { Layout } from '../../layouts/layout';

// Every part a docs layout may define.
const LAYOUT_PARTS: Record<keyof Layout, true> = {
  treePane: true,
  treeLine: true,
  treeRow: true,
  docPane: true,
  emptyDoc: true,
  docHeader: true,
  diskBanner: true,
  conflictPrompt: true,
  docBody: true,
  editorFrame: true,
  boxDialog: true,
  completion: true,
  confirmDialog: true,
  pickerRow: true,
  pageFrame: true,
  pageAside: true,
  asideHeading: true,
  asideLink: true,
  sectionEditControl: true,
  recentChanges: true,
  listPage: true,
  listRow: true,
  sidebarSwitch: true,
  mainEmpty: true,
};

// The docs layout a user's `layout.js` module exports as its default. A
// layout defines only the parts it changes; a part set to undefined is left
// out. Throws naming the first key that is no part, or the first defined part
// that is not a function.
export function readDocsLayout(module: unknown, name: string): Layout {
  return readLayoutParts<Layout>(module, name, LAYOUT_PARTS);
}
