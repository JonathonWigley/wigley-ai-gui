import type { Layout } from '../../layouts/layout';

const CARD_KINDS = ['question', 'finding', 'notice'] as const;

// The layout a user's `layout.js` module exports as its default; throws naming
// the first part it lacks.
export function readLayout(module: unknown, name: string): Layout {
  const layout = isRecord(module) ? module.default : undefined;
  if (!isRecord(layout)) {
    throw new Error(
      `layout ${name}: the default export is missing or not an object`,
    );
  }
  const cards = isRecord(layout.cards) ? layout.cards : {};
  for (const kind of CARD_KINDS) {
    if (typeof cards[kind] !== 'function') {
      throw new Error(
        `layout ${name}: cards.${kind} is missing or not a function`,
      );
    }
  }
  const hasValidHead =
    layout.head === undefined || typeof layout.head === 'function';
  if (!hasValidHead) {
    throw new Error(`layout ${name}: head is not a function`);
  }
  return layout as unknown as Layout;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
