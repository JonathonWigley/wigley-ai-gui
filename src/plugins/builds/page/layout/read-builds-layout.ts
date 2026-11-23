import { readLayoutParts } from '../../../../shared/page/layout-host/read-layout-module';
import type { BuildsLayout } from '../../layouts/layout';

// Every part a builds layout may define, so a part added to the contract and missed here fails to compile.
const LAYOUT_PARTS: Record<keyof BuildsLayout, true> = {
  sideBar: true,
  main: true,
  allEntry: true,
  backendHeading: true,
  gameEntry: true,
  gameHeader: true,
  feedHeader: true,
  setGroup: true,
  buildRow: true,
  buildDetail: true,
  empty: true,
  pickerRow: true,
};

// The builds layout a user's `layout.js` module exports as its default. A layout defines only the parts it changes;
// throws as readLayoutParts does.
export function readBuildsLayout(module: unknown, name: string): BuildsLayout {
  return readLayoutParts<BuildsLayout>(module, name, LAYOUT_PARTS);
}
