import { readLayoutParts } from '../../../../shared/page/layout-host/read-layout-module';
import type { BoardLayout } from '../../layouts/layout';

// Every part a Board layout may define, so a part added to the contract and missed here fails to compile.
const LAYOUT_PARTS: Record<keyof BoardLayout, true> = {
  board: true,
  status: true,
  problem: true,
  column: true,
  card: true,
  empty: true,
  detail: true,
  detailEmpty: true,
};

// The Board layout a user's `layout.js` module exports as its default. A layout defines only the parts it changes;
// throws as readLayoutParts does.
export function readBoardLayout(module: unknown, name: string): BoardLayout {
  return readLayoutParts<BoardLayout>(module, name, LAYOUT_PARTS);
}
