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
  railHead: true,
  railFoot: true,
  pager: true,
  review: true,
  notices: true,
  dialogFrame: true,
  confirmBody: true,
};
// The named cards; `kinds` is read on its own.
const CARD_KINDS: Record<Exclude<keyof LayoutCards, 'kinds'>, true> = {
  question: true,
  finding: true,
  notice: true,
  other: true,
};

// The layout a user's `layout.js` module exports as its default. A layout
// defines only the parts it changes; throws as readLayoutModule does, or as
// requireLayoutParts does over the layout and then over its named cards, or
// when `cards` is not an object, or when `cards.kinds` is not an object or
// holds a value that is neither a function nor undefined.
export function readLayout(module: unknown, name: string): Layout {
  const layout = readLayoutModule(module, name);
  const { cards, ...rest } = layout;
  requireLayoutParts(rest, name, FUNCTION_PARTS);
  if (cards !== undefined) {
    if (!isRecord(cards)) {
      throw new Error(`layout ${name}: cards is not an object`);
    }
    const { kinds, ...namedCards } = cards;
    requireLayoutParts(namedCards, name, CARD_KINDS, 'cards.');
    if (kinds !== undefined) {
      requireKindCards(kinds, name);
    }
  }
  return layout as Layout;
}

// Throws `layout <name>: cards.kinds is not an object`, or
// `layout <name>: cards.kinds.<id> is not a function` for the first value that
// is neither a function nor undefined.
function requireKindCards(kinds: unknown, name: string) {
  if (!isRecord(kinds)) {
    throw new Error(`layout ${name}: cards.kinds is not an object`);
  }
  for (const [id, builder] of Object.entries(kinds)) {
    if (builder !== undefined && typeof builder !== 'function') {
      throw new Error(`layout ${name}: cards.kinds.${id} is not a function`);
    }
  }
}
