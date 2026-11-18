import type { PartPick } from '../../../../shared/page/layout-host/draw-part';
import { pickLayout as pickHostLayout } from '../../../../shared/page/layout-host/pick';
import type { BuiltInItemKind, ItemKind } from '../../contract';
import { isBuiltInItemKind } from '../../item-kinds';
import type {
  KindCardBuilder,
  Layout,
  LayoutCards,
} from '../../layouts/layout';
import {
  isNoticesStop,
  kindItems,
  railItems,
  type RoundItem,
  type RoundState,
} from '../round-model';

// A pane of the forms view, its rail's head and foot strips and the pager
// over its cards included.
export type LayoutPane =
  | 'head'
  | 'rail'
  | 'railHead'
  | 'railFoot'
  | 'pager'
  | 'review'
  | 'notices';

// A part of the cancel prompt's dialog.
export type LayoutDialogPart = 'dialogFrame' | 'confirmBody';

// The card of a kind, a pane of the forms view, or a part of the cancel
// prompt's dialog: what one layout in a chain draws.
export type LayoutPart =
  | { card: ItemKind }
  | { pane: LayoutPane }
  | { dialog: LayoutDialogPart };

// The layout that draws a part, and its name.
export type LayoutPick = PartPick<Layout>;

// The builder a layout draws an item's card with, and the input it takes: a
// built-in kind's own card and its card input; a plugin kind's `kinds` builder
// and its kind's card input; or the `other` card and an OtherCard.
export type CardBuilder =
  | { input: 'builtIn'; build: LayoutCards[BuiltInItemKind] }
  | { input: 'kind'; build: KindCardBuilder }
  | { input: 'other'; build: LayoutCards['other'] };

// Where a layout's card for a kind comes from.
type CardSource = CardBuilder['input'];

// The sources a card of each kind reads, in order: a built-in kind its own
// card; a plugin kind its `cards.kinds` builder, then `cards.other`.
const BUILT_IN_CARD_SOURCES: readonly CardSource[] = ['builtIn'];
const PLUGIN_CARD_SOURCES: readonly CardSource[] = ['kind', 'other'];

// The pick for the card of each stop but the notices stop, in rail order
// (rail positions 0 to n - 1), for each notice's card, by notice index - 1,
// and for each pane.
export interface RoundPicks {
  cards: LayoutPick[];
  noticeCards: LayoutPick[];
  panes: Record<LayoutPane, LayoutPick>;
}

const DEFAULT_NAME = 'default';
const PANES: readonly LayoutPane[] = [
  'head',
  'rail',
  'railHead',
  'railFoot',
  'pager',
  'review',
  'notices',
];

// What each pane and dialog part reads from a layout; a layout defines the
// part when the read is a function.
const PART_READS: {
  [P in LayoutPane | LayoutDialogPart]: (layout: Layout) => unknown;
} = {
  head: (layout) => layout.head,
  rail: (layout) => layout.rail,
  railHead: (layout) => layout.railHead,
  railFoot: (layout) => layout.railFoot,
  pager: (layout) => layout.pager,
  review: (layout) => layout.review,
  notices: (layout) => layout.notices,
  dialogFrame: (layout) => layout.dialogFrame,
  confirmBody: (layout) => layout.confirmBody,
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
// nothing. A card takes one pass per source of its kind (`cardSources`): a
// built-in kind's reads `cards.<kind>`; a plugin kind's takes the first layout
// whose own `cards.kinds[kind]` is a function, and when none is, the first
// whose `cards.other` is.
export function pickLayout(
  part: LayoutPart,
  chain: readonly string[],
  loaded: ReadonlyMap<string, Layout>,
): LayoutPick {
  if (!('card' in part)) {
    const read = PART_READS['pane' in part ? part.pane : part.dialog];
    return pickHostLayout(
      chain,
      loaded,
      (layout) => typeof read(layout) === 'function',
    );
  }
  const kind = part.card;
  const picks = cardSources(kind).map((source) =>
    pickHostLayout(
      chain,
      loaded,
      (layout) => cardBuilderFrom(layout, kind, source) !== undefined,
    ),
  );
  return (
    picks.find((pick) => pick.name !== DEFAULT_NAME) ?? picks[picks.length - 1]
  );
}

// The layout's builder for a card of `kind`, from the first of the kind's
// sources it defines; undefined when it defines none.
export function cardBuilderOf(
  layout: Layout,
  kind: ItemKind,
): CardBuilder | undefined {
  for (const source of cardSources(kind)) {
    const builder = cardBuilderFrom(layout, kind, source);
    if (builder !== undefined) {
      return builder;
    }
  }
  return undefined;
}

function cardSources(kind: ItemKind): readonly CardSource[] {
  return isBuiltInItemKind(kind) ? BUILT_IN_CARD_SOURCES : PLUGIN_CARD_SOURCES;
}

// The layout's builder for a card of `kind` from `source` when it is a
// function; `cards.kinds` counts its own keys alone, so an inherited member
// such as `constructor` is no builder.
function cardBuilderFrom(
  layout: Layout,
  kind: ItemKind,
  source: CardSource,
): CardBuilder | undefined {
  const cards = layout.cards;
  if (source === 'builtIn') {
    const build = isBuiltInItemKind(kind) ? cards?.[kind] : undefined;
    return typeof build === 'function'
      ? { input: 'builtIn', build }
      : undefined;
  }
  if (source === 'kind') {
    const kinds = cards?.kinds;
    const build =
      kinds !== undefined && Object.hasOwn(kinds, kind)
        ? kinds[kind]
        : undefined;
    return typeof build === 'function' ? { input: 'kind', build } : undefined;
  }
  const build = cards?.other;
  return typeof build === 'function' ? { input: 'other', build } : undefined;
}

// The layout the item itself names, through its kind's `cardInput.layout`;
// null for none and for a kind the round has no registration for.
export function itemLayout(round: RoundState, item: RoundItem): string | null {
  const kind = round.kinds.get(item.kind);
  const kindItem = kindItems(round.round, item.kind)[item.index - 1];
  return kind === undefined ? null : kind.cardInput.layout(kindItem);
}

// Every layout the round names, its own first, then its items' by rail
// order, then the notices' in order, without nulls or repeats.
export function roundLayoutNames(round: RoundState): string[] {
  const names = [
    round.round.layout,
    ...roundItems(round).map((item) => itemLayout(round, item)),
  ];
  return [...new Set(names.filter((name) => name !== null))];
}

// Every registered kind's items: the rail's stops in rail order, then the
// items of the kinds with no rail order (the notices) in order.
function roundItems(round: RoundState): RoundItem[] {
  const offRail = round.kinds
    .kinds()
    .filter((kind) => kind.railOrder === null)
    .flatMap((kind) => kindItemsOf(round, kind.spec.id));
  return [...cardStops(round), ...offRail];
}

function kindItemsOf(round: RoundState, kind: ItemKind): RoundItem[] {
  return kindItems(round.round, kind).map((_, i) => ({ kind, index: i + 1 }));
}

// The rail's stops but the notices stop, in rail order.
function cardStops(round: RoundState): RoundItem[] {
  return railItems(round).flatMap((item) =>
    isNoticesStop(item) ? [] : [item],
  );
}

// Picks each card's layout through its item's chain, and each pane's through
// the chain with no item.
export function pickRoundLayouts(
  round: RoundState,
  userLayout: string,
  loaded: ReadonlyMap<string, Layout>,
): RoundPicks {
  const roundLayout = round.round.layout;
  const pickCard = (item: RoundItem) =>
    pickLayout(
      { card: item.kind },
      layoutChain(itemLayout(round, item), roundLayout, userLayout),
      loaded,
    );
  const paneChain = layoutChain(null, roundLayout, userLayout);
  const pickPane = (pane: LayoutPane) =>
    pickLayout({ pane }, paneChain, loaded);
  return {
    cards: cardStops(round).map(pickCard),
    noticeCards: kindItemsOf(round, 'notice').map(pickCard),
    panes: {
      head: pickPane('head'),
      rail: pickPane('rail'),
      railHead: pickPane('railHead'),
      railFoot: pickPane('railFoot'),
      pager: pickPane('pager'),
      review: pickPane('review'),
      notices: pickPane('notices'),
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

// True when both picks have the same name and the same layout object.
export function isSamePick(a: LayoutPick, b: LayoutPick): boolean {
  return a.name === b.name && a.layout === b.layout;
}
