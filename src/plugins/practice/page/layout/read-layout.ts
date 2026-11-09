import { readLayoutParts } from '../../../../shared/page/layout-host/read-layout-module';
import type { PracticeLayout } from '../../layouts/layout';

// Every part a Practice layout may define, so a part added to the contract and
// missed here fails to compile.
const LAYOUT_PARTS: Record<keyof PracticeLayout, true> = {
  list: true,
  listHeader: true,
  problemRow: true,
  empty: true,
  noProblem: true,
};

// The Practice layout a user's `layout.js` module exports as its default. A
// layout defines only the parts it changes; throws as readLayoutParts does.
export function readPracticeLayout(
  module: unknown,
  name: string,
): PracticeLayout {
  return readLayoutParts<PracticeLayout>(module, name, LAYOUT_PARTS);
}
