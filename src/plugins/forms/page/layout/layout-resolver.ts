import type { PartPick } from '../../../../shared/page/layout-host/draw-part';
import { pickLayout as pickHostLayout } from '../../../../shared/page/layout-host/pick';
import type { Round } from '../../contract';
import type { Layout } from '../../layouts/layout';
import { answerableItems, type RoundItem, ROUND_ITEMS } from '../form-state';

// A card kind or a pane of the forms view: what one layout in a chain draws.
export type LayoutPart =
  | 'question'
  | 'finding'
  | 'notice'
  | 'head'
  | 'rail'
  | 'review'
  | 'notices';

// The layout that draws a part, and its name.
export type LayoutPick = PartPick<Layout>;

type LayoutPane = 'head' | 'rail' | 'review' | 'notices';

// The pick for each finding's and question's card, in rail order (rail
// positions 0 to n - 1), for each notice's card, by notice index - 1, and for
// each pane.
export interface RoundPicks {
  cards: LayoutPick[];
  noticeCards: LayoutPick[];
  panes: Record<LayoutPane, LayoutPick>;
}

const DEFAULT_NAME = 'default';
const PANES: readonly LayoutPane[] = ['head', 'rail', 'review', 'notices'];

// What each part reads from a layout; a layout defines the part when the read
// is a function.
const PART_READS: { [P in LayoutPart]: (layout: Layout) => unknown } = {
  question: (layout) => layout.cards?.question,
  finding: (layout) => layout.cards?.finding,
  notice: (layout) => layout.cards?.notice,
  head: (layout) => layout.head,
  rail: (layout) => layout.rail,
  review: (layout) => layout.review,
  notices: (layout) => layout.notices,
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

// The host's pick of the first layout in `chain` that defines `part`, its
// read being a function; a part `default` lacks resolves to it and draws
// nothing.
export function pickLayout(
  part: LayoutPart,
  chain: readonly string[],
  loaded: ReadonlyMap<string, Layout>,
): LayoutPick {
  return pickHostLayout(
    chain,
    loaded,
    (layout) => typeof PART_READS[part](layout) === 'function',
  );
}

// The layout the item itself names; null for none.
export function itemLayout(round: Round, item: RoundItem): string | null {
  return ROUND_ITEMS[item.kind](round)[item.index - 1].layout;
}

// Every layout the round names, its own first, then its findings' and
// questions' in rail order, then its notices' in order, without nulls or
// repeats.
export function roundLayoutNames(round: Round): string[] {
  const names = [
    round.layout,
    ...roundItems(round).map((item) => itemLayout(round, item)),
  ];
  return [...new Set(names.filter((name) => name !== null))];
}

// The findings and questions in rail order, then the notices in order.
function roundItems(round: Round): RoundItem[] {
  return [...answerableItems(round), ...noticeItems(round)];
}

function noticeItems(round: Round): RoundItem[] {
  return round.notices.map((_, i) => ({ kind: 'notice', index: i + 1 }));
}

// Picks each card's layout through its item's chain, and each pane's through
// the chain with no item.
export function pickRoundLayouts(
  round: Round,
  userLayout: string,
  loaded: ReadonlyMap<string, Layout>,
): RoundPicks {
  const pickCard = (item: RoundItem) =>
    pickLayout(
      item.kind,
      layoutChain(itemLayout(round, item), round.layout, userLayout),
      loaded,
    );
  const paneChain = layoutChain(null, round.layout, userLayout);
  return {
    cards: answerableItems(round).map(pickCard),
    noticeCards: noticeItems(round).map(pickCard),
    panes: {
      head: pickLayout('head', paneChain, loaded),
      rail: pickLayout('rail', paneChain, loaded),
      review: pickLayout('review', paneChain, loaded),
      notices: pickLayout('notices', paneChain, loaded),
    },
  };
}

// True when every card, notice card and pane has the same name and the same
// layout object in both.
export function picksEqual(a: RoundPicks, b: RoundPicks): boolean {
  return (
    isSamePickList(a.cards, b.cards) &&
    isSamePickList(a.noticeCards, b.noticeCards) &&
    PANES.every((pane) => isSamePick(a.panes[pane], b.panes[pane]))
  );
}

function isSamePickList(a: LayoutPick[], b: LayoutPick[]): boolean {
  return (
    a.length === b.length &&
    a.every((pick, position) => isSamePick(pick, b[position]))
  );
}

function isSamePick(a: LayoutPick, b: LayoutPick): boolean {
  return a.name === b.name && a.layout === b.layout;
}
