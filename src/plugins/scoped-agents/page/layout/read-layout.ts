import { readLayoutParts } from '../../../../shared/page/layout-host/read-layout-module';
import type { ScopedAgentsLayout } from '../../layouts/layout';

// Every part a scoped-agents layout may define, so a part added to the
// contract and missed here fails to compile.
const LAYOUT_PARTS: Record<keyof ScopedAgentsLayout, true> = {
  askBox: true,
};

// The scoped-agents layout a user's `layout.js` module exports as its default.
// A layout defines only the parts it changes; throws as readLayoutParts does.
export function readScopedAgentsLayout(
  module: unknown,
  name: string,
): ScopedAgentsLayout {
  return readLayoutParts<ScopedAgentsLayout>(module, name, LAYOUT_PARTS);
}
