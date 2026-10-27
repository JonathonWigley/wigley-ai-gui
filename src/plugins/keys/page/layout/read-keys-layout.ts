import { readLayoutModule } from '../../../../shared/page/layout-host/read-layout-module';
import type { Layout } from '../../layouts/layout';

// Every part a keys layout may define.
const LAYOUT_PARTS: Record<keyof Layout, true> = {
  help: true,
  helpSection: true,
  helpRow: true,
  whichKey: true,
  whichKeyEntry: true,
  titleBarButton: true,
};

// The keys layout a user's `layout.js` module exports as its default. A
// layout defines only the parts it changes; throws naming the first key that
// is no part, or the first defined part that is not a function.
export function readKeysLayout(module: unknown, name: string): Layout {
  const layout = readLayoutModule(module, name);
  const keys = Object.keys(layout);
  for (const key of keys) {
    if (!Object.hasOwn(LAYOUT_PARTS, key)) {
      throw new Error(`layout ${name}: ${key} is not a layout part`);
    }
  }
  for (const key of keys) {
    const isValidPart =
      layout[key] === undefined || typeof layout[key] === 'function';
    if (!isValidPart) {
      throw new Error(`layout ${name}: ${key} is not a function`);
    }
  }
  return layout as Layout;
}
