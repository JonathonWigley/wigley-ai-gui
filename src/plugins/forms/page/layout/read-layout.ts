import {
  isRecord,
  readLayoutModule,
  requireLayoutParts,
} from '../../../../shared/page/layout-host/read-layout-module';
import type { Layout, LayoutCards } from '../../layouts/layout';

// The parts a layout defines as functions: every part but `cards`.
const FUNCTION_PARTS: Record<Exclude<keyof Layout, 'cards'>, true> = {
  head: true,
  rail: true,
  review: true,
};
const CARD_KINDS: Record<keyof LayoutCards, true> = {
  question: true,
  finding: true,
  notice: true,
};

// The layout a user's `layout.js` module exports as its default. A layout
// defines only the parts it changes; throws as readLayoutModule does, or as
// requireLayoutParts does over the layout and then over its `cards`, or when
// `cards` is not an object.
export function readLayout(module: unknown, name: string): Layout {
  const layout = readLayoutModule(module, name);
  const { cards, ...rest } = layout;
  requireLayoutParts(rest, name, FUNCTION_PARTS);
  if (cards !== undefined) {
    if (!isRecord(cards)) {
      throw new Error(`layout ${name}: cards is not an object`);
    }
    requireLayoutParts(cards, name, CARD_KINDS, 'cards.');
  }
  return layout as Layout;
}
