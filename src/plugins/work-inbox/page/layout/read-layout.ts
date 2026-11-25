import { readLayoutParts } from '../../../../shared/page/layout-host/read-layout-module';
import type { InboxLayout } from '../../layouts/layout';

// Every part an Inbox layout may define, so a part added to the contract and missed here fails to compile.
const LAYOUT_PARTS: Record<keyof InboxLayout, true> = {
  sideBar: true,
  sectionGroup: true,
  sectionRow: true,
  main: true,
  status: true,
  problem: true,
  filter: true,
  cardGroup: true,
  card: true,
  empty: true,
  detail: true,
  detailEmpty: true,
};

// The Inbox layout a user's `layout.js` module exports as its default. A layout defines only the parts it changes;
// throws as readLayoutParts does.
export function readInboxLayout(module: unknown, name: string): InboxLayout {
  return readLayoutParts<InboxLayout>(module, name, LAYOUT_PARTS);
}
