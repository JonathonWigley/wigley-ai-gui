import { errorText } from '../../../../shared/error-text';
import type { ItemKind } from '../../contract';
import defaultLayout from '../../layouts/default/layout.js';
import type { CardAnswer, Layout, LayoutCard } from '../../layouts/layout';
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

type CardBuilders = {
  [K in ItemKind]: (
    parent: HTMLElement,
    input: CardInputs[K],
    kit: CardKits[K],
  ) => LayoutCard;
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

// The item's card at rail `position`, built by `layout` into `parent`. When
// the layout's builder throws, what it appended and the boxes it mounted are
// removed, the failure is logged, and the default layout's card is built in
// its place.
export function buildLayoutCard(
  layout: Layout,
  layoutName: string,
  parent: HTMLElement,
  round: RoundState,
  item: RailItem,
  position: number,
  deps: CardDeps,
): ItemCard {
  let built: BuiltCard;
  try {
    built = buildCard(layout.cards, parent, round, item, position, deps);
  } catch (error) {
    deps.log(
      'forms',
      `layout ${layoutName} ${item.kind} card failed: ${errorText(error)}`,
    );
    built = buildCard(defaultLayout.cards, parent, round, item, position, deps);
  }
  return hostCard(built, layoutName, item, deps);
}

// Builds through `cards`, then mounts the boxes the card left unmounted. On a
// throw, destroys the boxes it mounted and removes what it appended to
// `parent` before rethrowing.
function buildCard(
  cards: CardBuilders,
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
  cards: CardBuilders,
  kind: K,
  index: number,
  parent: HTMLElement,
  round: RoundState,
  position: number,
  deps: CardDeps,
): BuiltCard {
  const input = CARD_INPUTS[kind].cardInput(round.round, index);
  const kit = createCardKit(kind, index, input, round, position, deps);
  const card = cards[kind](parent, input, kit.kit);
  kit.appendUnmountedBoxes(card.element);
  return { card, kit };
}

// The ItemCard over a built card: `update` runs the kit's updaters, then, on
// an answerable item, shows its status on the card's element and runs the
// card's own `update`, whose first throw is logged.
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
    },
  };
}
