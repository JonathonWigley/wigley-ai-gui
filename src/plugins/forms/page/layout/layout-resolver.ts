import type { Round } from '../../contract';
import type { Layout } from '../../layouts/layout';
import { type RailItem, railItems, ROUND_ITEMS } from '../form-state';

// A card kind or a pane of the forms view: what one layout in a chain draws.
export type LayoutPart =
  | 'question'
  | 'finding'
  | 'notice'
  | 'head'
  | 'rail'
  | 'review';

// The layout that draws a part, and its name.
export interface LayoutPick {
  name: string;
  layout: Layout;
}

type LayoutPane = 'head' | 'rail' | 'review';

// The pick for each of a round's cards, in rail order, and for each pane.
export interface RoundPicks {
  cards: LayoutPick[];
  panes: Record<LayoutPane, LayoutPick>;
}

const DEFAULT_NAME = 'default';
const PANES: readonly LayoutPane[] = ['head', 'rail', 'review'];

// What each part reads from a layout; a layout defines the part when the read
// is a function.
const PART_READS: { [P in LayoutPart]: (layout: Layout) => unknown } = {
  question: (layout) => layout.cards?.question,
  finding: (layout) => layout.cards?.finding,
  notice: (layout) => layout.cards?.notice,
  head: (layout) => layout.head,
  // No layout defines a rail or a review pane, so both resolve to `default`.
  rail: () => undefined,
  review: () => undefined,
};

// The names to look a part up in, first to last: the item's layout, the
// round's, the user's, then `default`, without nulls or repeats.
export function layoutChain(
  itemLayout: string | null,
  roundLayout: string | null,
  userLayout: string,
): string[] {
  const names = [itemLayout, roundLayout, userLayout, DEFAULT_NAME];
  return [...new Set(names.filter((name) => name !== null))];
}

// The first layout in `chain` that `loaded` holds and that defines `part`;
// `default` ends the chain whatever it defines, so a part `default` lacks
// resolves to it and draws nothing. A name `loaded` lacks is skipped. Throws
// when `loaded` lacks `default`.
export function pickLayout(
  part: LayoutPart,
  chain: readonly string[],
  loaded: ReadonlyMap<string, Layout>,
): LayoutPick {
  const fallback = loaded.get(DEFAULT_NAME);
  if (fallback === undefined) {
    throw new Error(`layout ${DEFAULT_NAME} is not loaded`);
  }
  for (const name of chain) {
    if (name === DEFAULT_NAME) {
      break;
    }
    const layout = loaded.get(name);
    const definesPart =
      layout !== undefined && typeof PART_READS[part](layout) === 'function';
    if (definesPart) {
      return { name, layout };
    }
  }
  return { name: DEFAULT_NAME, layout: fallback };
}

// The layout the item itself names; null for none.
export function itemLayout(round: Round, item: RailItem): string | null {
  return ROUND_ITEMS[item.kind](round)[item.index - 1].layout;
}

// Every layout the round names, its own first, then its items' in rail order,
// without nulls or repeats.
export function roundLayoutNames(round: Round): string[] {
  const names = [
    round.layout,
    ...railItems(round).map((item) => itemLayout(round, item)),
  ];
  return [...new Set(names.filter((name) => name !== null))];
}

// Picks each card's layout through its item's chain, and each pane's through
// the chain with no item.
export function pickRoundLayouts(
  round: Round,
  userLayout: string,
  loaded: ReadonlyMap<string, Layout>,
): RoundPicks {
  const cards = railItems(round).map((item) =>
    pickLayout(
      item.kind,
      layoutChain(itemLayout(round, item), round.layout, userLayout),
      loaded,
    ),
  );
  const paneChain = layoutChain(null, round.layout, userLayout);
  return {
    cards,
    panes: {
      head: pickLayout('head', paneChain, loaded),
      rail: pickLayout('rail', paneChain, loaded),
      review: pickLayout('review', paneChain, loaded),
    },
  };
}

// True when every card and pane has the same name and the same layout object
// in both.
export function picksEqual(a: RoundPicks, b: RoundPicks): boolean {
  const isSameCards =
    a.cards.length === b.cards.length &&
    a.cards.every((pick, position) => isSamePick(pick, b.cards[position]));
  return (
    isSameCards &&
    PANES.every((pane) => isSamePick(a.panes[pane], b.panes[pane]))
  );
}

function isSamePick(a: LayoutPick, b: LayoutPick): boolean {
  return a.name === b.name && a.layout === b.layout;
}
