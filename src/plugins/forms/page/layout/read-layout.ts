import type { Layout, LayoutCards } from '../../layouts/layout';

// Every key a layout may define, and every key its `cards` may.
const LAYOUT_PARTS: Record<keyof Layout, true> = {
  cards: true,
  head: true,
  rail: true,
  review: true,
};
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
// defines only the parts it changes; throws naming the first key that is no
// part, or the first part that is not a function.
export function readLayout(module: unknown, name: string): Layout {
  const layout = isRecord(module) ? module.default : undefined;
  if (!isRecord(layout)) {
    throw new Error(
      `layout ${name}: the default export is missing or not an object`,
    );
  }
  for (const key of Object.keys(layout)) {
    if (!Object.hasOwn(LAYOUT_PARTS, key)) {
      throw new Error(`layout ${name}: ${key} is not a layout part`);
    }
  }
  if (layout.cards !== undefined) {
    requireCards(layout.cards, name);
  }
  for (const part of Object.keys(FUNCTION_PARTS)) {
    const isValidPart =
      layout[part] === undefined || typeof layout[part] === 'function';
    if (!isValidPart) {
      throw new Error(`layout ${name}: ${part} is not a function`);
    }
  }
  return layout as unknown as Layout;
}

// Throws unless `cards` is an object whose every key is a card kind holding a
// function.
function requireCards(cards: unknown, name: string): void {
  if (!isRecord(cards)) {
    throw new Error(`layout ${name}: cards is not an object`);
  }
  const kinds = Object.keys(cards);
  for (const kind of kinds) {
    if (!Object.hasOwn(CARD_KINDS, kind)) {
      throw new Error(`layout ${name}: cards.${kind} is not a card kind`);
    }
  }
  for (const kind of kinds) {
    const isValidCard =
      cards[kind] === undefined || typeof cards[kind] === 'function';
    if (!isValidCard) {
      throw new Error(`layout ${name}: cards.${kind} is not a function`);
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
