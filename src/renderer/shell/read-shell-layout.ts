import { readLayoutModule } from '../../shared/page/layout-host/read-layout-module';
import type { Layout } from './layouts/layout';

// Every part a shell layout may define; each is a function.
const LAYOUT_PARTS: Record<keyof Layout, true> = {
  titleContext: true,
  devTag: true,
  configProblems: true,
  activityItem: true,
};

// The layout a user's `layout.js` module exports as its default. A layout
// defines only the parts it changes; throws as readLayoutModule does, or
// naming the first key that is no part, or the first part that is not a
// function.
export function readShellLayout(module: unknown, name: string): Layout {
  const layout = readLayoutModule(module, name);
  for (const key of Object.keys(layout)) {
    if (!Object.hasOwn(LAYOUT_PARTS, key)) {
      throw new Error(`layout ${name}: ${key} is not a layout part`);
    }
  }
  for (const [part, builder] of Object.entries(layout)) {
    const isValidPart = builder === undefined || typeof builder === 'function';
    if (!isValidPart) {
      throw new Error(`layout ${name}: ${part} is not a function`);
    }
  }
  return layout as Layout;
}
