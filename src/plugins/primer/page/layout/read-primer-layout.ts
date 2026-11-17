import {
  isRecord,
  readLayoutModule,
  requireLayoutParts,
} from '../../../../shared/page/layout-host/read-layout-module';
import type { PrimerLayout, PrimerLayoutCards } from '../../layouts/layout';

// Every pane a primer layout may define besides its `cards`, and every card
// its `cards` may.
const PANE_PARTS: Record<Exclude<keyof PrimerLayout, 'cards'>, true> = {
  tasks: true,
  items: true,
  review: true,
  confirmBody: true,
  dialogFrame: true,
};
const CARD_PARTS: Record<keyof PrimerLayoutCards, true> = {
  feature: true,
  task: true,
  item: true,
};

// The primer layout a user's `layout.js` module exports as its default. A
// layout defines only the parts it changes; throws naming `rail`, with the
// `tasks` and `items` parts it became, then the first key that is no part,
// the first pane that is not a function, then the first `cards` key that is
// no card or not a function.
export function readPrimerLayout(module: unknown, name: string): PrimerLayout {
  const layout = readLayoutModule(module, name);
  const { cards, ...panes } = layout;
  if (Object.hasOwn(panes, 'rail')) {
    throw new Error(
      `layout ${name}: rail is not a layout part; it became the tasks and items parts`,
    );
  }
  requireLayoutParts(panes, name, PANE_PARTS);
  if (cards !== undefined) {
    if (!isRecord(cards)) {
      throw new Error(`layout ${name}: cards is not an object`);
    }
    requireLayoutParts(cards, name, CARD_PARTS, 'cards.');
  }
  return layout as PrimerLayout;
}
