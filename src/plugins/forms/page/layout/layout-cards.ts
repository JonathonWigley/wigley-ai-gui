import type { Disposable } from '../../../../contracts/disposable';
import { errorText } from '../../../../shared/error-text';
import {
  drawPart,
  type DrawnPart,
  requireElementIn,
  type RollbackDeps,
} from '../../../../shared/page/layout-host/draw-part';
import type { MarkdownMount } from '../../../../shared/page/markdown-mount';
import type { KeyHints } from '../../../../contracts/plugin';
import defaultLayout from '../../layouts/default/layout.js';
import type { CardAnswer, LayoutCard, OtherCard } from '../../layouts/layout';
import { answerStatus, findingActionOf, itemAnswer } from '../round-answers';
import {
  type AnswerableItem,
  isAnswerable,
  kindItems,
  requireKind,
  type RoundItem,
  type RoundState,
  type TextTarget,
} from '../round-model';
import type {
  BuiltInCard,
  CardDeps,
  CardInputs,
  CardKits,
  ItemCard,
} from '../kinds/item-format';
import { roundInfo } from '../kinds/card-parts';
import { itemLabel } from '../kinds/formats';
import { type CardKit, createCardKit, createKindKit } from './card-kit';
import {
  type CardBuilder,
  cardBuilderOf,
  type LayoutPick,
} from './layout-resolver';

// A card a layout built, its element, and the kit it built it from.
interface BuiltCard {
  element: HTMLElement;
  card: LayoutCard;
  kit: CardKit;
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

// The item's card at rail `position`, drawn into `parent` by drawPart with
// the picked layout, or with `default` when the pick lacks the item's card or
// its card throws: a plugin kind's card draws with the layout's
// `cards.kinds[kind]` when it is a function, else with its `cards.other`, and
// falls back to `default`'s `other`. The boxes the card places, the anchors it
// names, its slot subscriptions and its markdown mounts are recorded for
// drawPart's rollback; `dispose` releases those boxes and disposes the rest,
// and leaves the card's element in place. With `rollback`, the drawn card's
// dispose is recorded in it, so the part the card sits in undoes the card
// when it rolls back.
export function buildLayoutCard(
  pick: LayoutPick,
  parent: HTMLElement,
  round: RoundState,
  item: RoundItem,
  position: number,
  deps: CardDeps,
  rollback?: RollbackDeps,
): Pick<DrawnPart<ItemCard>, 'built' | 'dispose'> {
  const { built, layoutName, dispose } = drawPart({
    owner: 'forms',
    parent,
    pick,
    defaultLayout,
    part: (layout) => cardBuilderOf(layout, item.kind),
    build: (cardBuilder, cardParent, rollback) =>
      buildCard(
        cardBuilder,
        item,
        cardParent,
        round,
        position,
        recordingDeps(deps, rollback),
      ),
    log: deps.log,
    partName: `${item.kind} card`,
  });
  rollback?.recordBox(dispose);
  return {
    built: hostCard(built, layoutName, item, isAnswerable(round, item), deps),
    dispose,
  };
}

// What a layout's card or pane places its text boxes and anchors its keys
// through, and where it records each anchor the kit names and each slot
// subscription and markdown mount it makes.
interface MountingDeps {
  placeBox(parent: HTMLElement, target: TextTarget, text: string): HTMLElement;
  releaseBox(target: TextTarget): void;
  keys: Pick<KeyHints, 'anchor'>;
  recordAnchor(anchor: Disposable): void;
  recordMount(mount: MarkdownMount): void;
}

// `deps` with each box it places recorded in `rollback` as released, so a
// rolled-back or disposed draw detaches the box's frame and the editor lives
// on, and each anchor it names, and each anchor the kit names and each slot
// subscription and markdown mount it records, also recorded in `rollback`.
export function recordingDeps<D extends MountingDeps>(
  deps: D,
  rollback: RollbackDeps,
): D {
  return {
    ...deps,
    placeBox(parent: HTMLElement, target: TextTarget, text: string) {
      const frame = deps.placeBox(parent, target, text);
      rollback.recordBox(() => deps.releaseBox(target));
      return frame;
    },
    recordAnchor(anchor: Disposable) {
      deps.recordAnchor(anchor);
      rollback.recordAnchor(anchor);
    },
    recordMount(mount: MarkdownMount) {
      deps.recordMount(mount);
      rollback.recordAnchor(mount);
    },
    keys: {
      ...deps.keys,
      anchor(...args: Parameters<KeyHints['anchor']>) {
        const anchor = deps.keys.anchor(...args);
        rollback.recordAnchor(anchor);
        return anchor;
      },
    },
  };
}

// Builds the item's card through `builder`, checks its element, then places
// the boxes the card left unplaced and places the contributed parts it left
// unplaced, in that order, at the end of its element. A built-in or `kinds`
// card's input comes from the item's kind's `cardInput.input`; the `other`
// card's is the item's OtherCard.
function buildCard(
  builder: CardBuilder,
  item: RoundItem,
  parent: HTMLElement,
  round: RoundState,
  position: number,
  deps: CardDeps,
): BuiltCard {
  const kind = requireKind(round.kinds, item);
  const kindItem = kindItems(round.round, item.kind)[item.index - 1];
  const kindInput = () =>
    kind.cardInput.input(kindItem, item.index, round.round);
  const { kit, card } = drawCard(builder, item, parent, round, position, {
    deps,
    kindInput,
    otherCard: () => ({
      kind: item.kind,
      label: itemLabel(round.kinds, item),
      title: kind.cardInput.title(kindItem),
      round: roundInfo(round.round),
    }),
  });
  const element = requireElementIn(
    parent,
    (card as LayoutCard | undefined)?.element,
    `${item.kind} card`,
  );
  kit.appendUnmountedBoxes(element);
  kit.appendUnplacedParts(element);
  return { element, card, kit };
}

// What drawCard builds a card's input from besides the item.
interface CardSources {
  deps: CardDeps;
  kindInput(): unknown;
  otherCard(): OtherCard;
}

// Runs `builder` into `parent` with its input and a kit made for it: a
// built-in card's own kit, or a plugin kind's KindKit.
function drawCard(
  builder: CardBuilder,
  item: RoundItem,
  parent: HTMLElement,
  round: RoundState,
  position: number,
  { deps, kindInput, otherCard }: CardSources,
): { kit: CardKit; card: LayoutCard } {
  if (builder.input === 'builtIn') {
    const kind = item.kind as BuiltInCard;
    const input = kindInput() as CardInputs[BuiltInCard];
    const kit = createCardKit(kind, item.index, input, round, position, deps);
    const build = builder.build as (
      parent: HTMLElement,
      input: CardInputs[BuiltInCard],
      kit: CardKits[BuiltInCard],
    ) => LayoutCard;
    return { kit, card: build(parent, input, kit.kit) };
  }
  const kit = createKindKit(item.kind, item.index, round, position, deps);
  const card =
    builder.input === 'kind'
      ? builder.build(parent, kindInput(), kit.kit)
      : builder.build(parent, otherCard(), kit.kit);
  return { kit, card };
}

// The ItemCard over a built card: `update` runs the kit's updaters, then, on
// an item of an answerable kind, shows its status on the card's element, runs
// the card's own `update`, whose first throw is logged, and then each
// contributed part's update.
function hostCard(
  built: BuiltCard,
  layoutName: string,
  item: RoundItem,
  answerable: boolean,
  deps: CardDeps,
): ItemCard {
  const { card, kit } = built;
  let isUpdateFailureLogged = false;
  return {
    element: card.element,
    update(round) {
      kit.update(round);
      if (!answerable) {
        return;
      }
      card.element.dataset.status = answerStatus(round, item);
      try {
        card.update?.(cardAnswer(round, item));
      } catch (error) {
        if (!isUpdateFailureLogged) {
          isUpdateFailureLogged = true;
          deps.log(
            `layout ${layoutName} ${item.kind} card update failed: ${errorText(error)}`,
          );
        }
      }
      kit.updateContributedParts();
    },
  };
}
