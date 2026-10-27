import {
  isRecord,
  readLayoutModule,
} from '../../../../shared/page/layout-host/read-layout-module';
import type { PrimerLayout, PrimerLayoutCards } from '../../layouts/layout';

// Every key a primer layout may define, and every key its `cards` may.
const LAYOUT_PARTS: Record<keyof PrimerLayout, true> = {
  cards: true,
  rail: true,
  review: true,
};
const CARD_PARTS: Record<keyof PrimerLayoutCards, true> = {
  feature: true,
  task: true,
  item: true,
};

// The primer layout a user's `layout.js` module exports as its default. A
// layout defines only the parts it changes; throws naming the first key that
// is no part, the first `cards` key that is no card, or the first part that
// is not a function.
export function readPrimerLayout(module: unknown, name: string): PrimerLayout {
  const layout = readLayoutModule(module, name);
  for (const key of Object.keys(layout)) {
    if (!Object.hasOwn(LAYOUT_PARTS, key)) {
      throw new Error(`layout ${name}: ${key} is not a layout part`);
    }
  }
  if (layout.cards !== undefined) {
    requireCards(layout.cards, name);
  }
  for (const part of ['rail', 'review']) {
    requireFunction(layout[part], part, name);
  }
  return layout as PrimerLayout;
}

// Throws unless `cards` is an object whose every key is a card holding a
// function.
function requireCards(cards: unknown, name: string): void {
  if (!isRecord(cards)) {
    throw new Error(`layout ${name}: cards is not an object`);
  }
  for (const key of Object.keys(cards)) {
    if (!Object.hasOwn(CARD_PARTS, key)) {
      throw new Error(`layout ${name}: cards.${key} is not a card`);
    }
  }
  for (const [key, card] of Object.entries(cards)) {
    requireFunction(card, `cards.${key}`, name);
  }
}

// Throws unless `part` is left out or a function.
function requireFunction(part: unknown, key: string, name: string): void {
  if (part !== undefined && typeof part !== 'function') {
    throw new Error(`layout ${name}: ${key} is not a function`);
  }
}
