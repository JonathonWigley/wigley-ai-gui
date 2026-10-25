import { errorText } from '../../../../shared/error-text';
import type { ItemKind } from '../../contract';
import defaultLayout from '../../layouts/default/layout.js';
import type { CardAnswer, LayoutCard } from '../../layouts/layout';
import {
  type AnswerableItem,
  answerStatus,
  findingActionOf,
  itemAnswer,
  type RailItem,
  type RoundState,
  type TextTarget,
} from '../form-state';
import { FORMATS } from '../kinds/formats';
import type {
  CardDeps,
  CardInputs,
  CardKits,
  ItemCard,
  ItemFormat,
} from '../kinds/item-format';
import { answerableOf, type CardKit, createCardKit } from './card-kit';
import type { LayoutPick } from './layout-resolver';

type CardBuilders = {
  [K in ItemKind]: (
    parent: HTMLElement,
    input: CardInputs[K],
    kit: CardKits[K],
  ) => LayoutCard;
};

// The cards a card is built from, and the name of their layout.
interface DrawingCards {
  name: string;
  cards: Partial<CardBuilders>;
}

const DEFAULT_CARDS: DrawingCards = {
  name: 'default',
  cards: defaultLayout.cards,
};

// FORMATS as a table of card inputs, which keeps each kind's input tied to
// its kind.
const CARD_INPUTS: { [K in ItemKind]: ItemFormat<CardInputs[K]> } = FORMATS;

// A card a layout built, with the kit it built it from.
interface BuiltCard {
  card: LayoutCard;
  kit: CardKit<ItemKind>;
}

// The item's answer as a layout card's `update` receives it.
export function cardAnswer(
  round: RoundState,
  item: AnswerableItem,
): CardAnswer {
  const answer = itemAnswer(round, item);
  const action = findingActionOf(round, item);
  return {
    status: answerStatus(round, item),
    choice: answer.choice === 0 ? null : answer.choice,
    notApplicable: answer.notApplicable,
    dontAsk: answer.dontAsk,
    action: action === '' ? null : action,
  };
}

// The item's card at rail `position`, built into `parent` by the picked
// layout, or by `default` when the pick lacks the item's kind. When the
// picked card throws, or returns no element appended to `parent`, what it
// appended and the boxes it mounted are removed, the failure is logged, and
// the default layout's card is built in its place. The card's element carries
// `data-layout` naming the layout that drew it.
export function buildLayoutCard(
  pick: LayoutPick,
  parent: HTMLElement,
  round: RoundState,
  item: RailItem,
  position: number,
  deps: CardDeps,
): ItemCard {
  const picked = pick.layout.cards;
  const definesKind =
    picked !== undefined && typeof picked[item.kind] === 'function';
  let drawn = definesKind ? { name: pick.name, cards: picked } : DEFAULT_CARDS;
  let built: BuiltCard;
  try {
    built = buildCard(drawn.cards, parent, round, item, position, deps);
  } catch (error) {
    deps.log(
      'forms',
      `layout ${drawn.name} ${item.kind} card failed: ${errorText(error)}`,
    );
    drawn = DEFAULT_CARDS;
    built = buildCard(drawn.cards, parent, round, item, position, deps);
  }
  built.card.element.dataset.layout = drawn.name;
  return hostCard(built, drawn.name, item, deps);
}

// Builds through `cards`, checks the card's element, then mounts the boxes
// the card left unmounted and places the contributed parts it left unplaced,
// in that order, at the end of its element. On a throw, destroys the boxes it
// mounted and removes what it appended to `parent` before rethrowing.
function buildCard(
  cards: Partial<CardBuilders>,
  parent: HTMLElement,
  round: RoundState,
  item: RailItem,
  position: number,
  deps: CardDeps,
): BuiltCard {
  const mounted: TextTarget[] = [];
  const recordingDeps: CardDeps = {
    ...deps,
    mountBox(boxParent, target, text) {
      deps.mountBox(boxParent, target, text);
      mounted.push(target);
    },
  };
  const existing = new Set(parent.childNodes);
  try {
    return buildCardOf(
      cards,
      item.kind,
      item.index,
      parent,
      round,
      position,
      recordingDeps,
    );
  } catch (error) {
    for (const target of mounted) {
      deps.destroyBox(target);
    }
    // childNodes is live, so the appended nodes are collected before removal.
    const appended = Array.from(parent.childNodes).filter(
      (node) => !existing.has(node),
    );
    for (const node of appended) {
      node.remove();
    }
    throw error;
  }
}

function buildCardOf<K extends ItemKind>(
  cards: Partial<CardBuilders>,
  kind: K,
  index: number,
  parent: HTMLElement,
  round: RoundState,
  position: number,
  deps: CardDeps,
): BuiltCard {
  const input = CARD_INPUTS[kind].cardInput(round.round, index);
  const build = cards[kind];
  if (build === undefined) {
    throw new Error(`${kind} card is not defined`);
  }
  const kit = createCardKit(kind, index, input, round, position, deps);
  const card = build(parent, input, kit.kit);
  requireElementIn(card, kind, parent);
  kit.appendUnmountedBoxes(card.element);
  kit.appendUnplacedParts(card.element);
  return { card, kit };
}

// A layout's card must return an element it appended to `parent`: the host
// shows, hides and marks that node.
function requireElementIn(
  card: LayoutCard | null | undefined,
  kind: ItemKind,
  parent: HTMLElement,
): void {
  const element = card?.element;
  if (!(element instanceof HTMLElement)) {
    throw new Error(`${kind} card returned no element`);
  }
  if (element.parentNode !== parent) {
    throw new Error(`${kind} card's element is not appended to parent`);
  }
}

// The ItemCard over a built card: `update` runs the kit's updaters, then, on
// an answerable item, shows its status on the card's element, runs the card's
// own `update`, whose first throw is logged, and then each contributed part's
// update.
function hostCard(
  built: BuiltCard,
  layoutName: string,
  item: RailItem,
  deps: CardDeps,
): ItemCard {
  const { card, kit } = built;
  const answerable = answerableOf(item);
  let isUpdateFailureLogged = false;
  return {
    element: card.element,
    update(round) {
      kit.update(round);
      if (answerable === null) {
        return;
      }
      card.element.dataset.status = answerStatus(round, answerable);
      try {
        card.update?.(cardAnswer(round, answerable));
      } catch (error) {
        if (!isUpdateFailureLogged) {
          isUpdateFailureLogged = true;
          deps.log(
            'forms',
            `layout ${layoutName} ${item.kind} card update failed: ${errorText(error)}`,
          );
        }
      }
      kit.updateContributedParts();
    },
  };
}
