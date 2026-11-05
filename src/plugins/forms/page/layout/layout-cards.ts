import { errorText } from '../../../../shared/error-text';
import {
  drawPart,
  requireElementIn,
  type RollbackDeps,
} from '../../../../shared/page/layout-host/draw-part';
import type { MarkdownMount } from '../../../../shared/page/markdown-mount';
import type { KeyHints } from '../../../../contracts/plugin';
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

// FORMATS as a table of card inputs, which keeps each kind's input tied to
// its kind.
const CARD_INPUTS: { [K in ItemKind]: ItemFormat<CardInputs[K]> } = FORMATS;

// A card a layout built, its element, and the kit it built it from.
interface BuiltCard {
  element: HTMLElement;
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

// The item's card at rail `position`, drawn into `parent` by drawPart with
// the picked layout, or with `default` when the pick lacks the item's kind or
// its card throws. The boxes the card mounts, the anchors it names and its
// markdown mounts are recorded for drawPart's rollback.
export function buildLayoutCard(
  pick: LayoutPick,
  parent: HTMLElement,
  round: RoundState,
  item: RailItem,
  position: number,
  deps: CardDeps,
): ItemCard {
  const { built, layoutName } = drawPart({
    owner: 'forms',
    parent,
    pick,
    defaultLayout,
    part: (layout): CardBuilders[ItemKind] | undefined =>
      layout.cards?.[item.kind],
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
  return hostCard(built, layoutName, item, deps);
}

// What a layout's card or pane mounts its text boxes and anchors its keys
// through, and where it records each markdown mount it makes.
interface MountingDeps {
  mountBox(parent: HTMLElement, target: TextTarget, text: string): void;
  destroyBox(target: TextTarget): void;
  keys: Pick<KeyHints, 'anchor'>;
  recordMount(mount: MarkdownMount): void;
}

// `deps` with each box it mounts, each anchor it names and each markdown
// mount it records also recorded in `rollback`.
export function recordingDeps<D extends MountingDeps>(
  deps: D,
  rollback: RollbackDeps,
): D {
  return {
    ...deps,
    mountBox(parent: HTMLElement, target: TextTarget, text: string) {
      deps.mountBox(parent, target, text);
      rollback.recordBox(() => deps.destroyBox(target));
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

// Builds the item's card through `build`, checks its element, then mounts the
// boxes the card left unmounted and places the contributed parts it left
// unplaced, in that order, at the end of its element.
function buildCard<K extends ItemKind>(
  build: CardBuilders[K],
  item: { kind: K; index: number },
  parent: HTMLElement,
  round: RoundState,
  position: number,
  deps: CardDeps,
): BuiltCard {
  const input = CARD_INPUTS[item.kind].cardInput(round.round, item.index);
  const kit = createCardKit(
    item.kind,
    item.index,
    input,
    round,
    position,
    deps,
  );
  const card = build(parent, input, kit.kit);
  const element = requireElementIn(
    parent,
    (card as LayoutCard | undefined)?.element,
    `${item.kind} card`,
  );
  kit.appendUnmountedBoxes(element);
  kit.appendUnplacedParts(element);
  return { element, card, kit };
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
            `layout ${layoutName} ${item.kind} card update failed: ${errorText(error)}`,
          );
        }
      }
      kit.updateContributedParts();
    },
  };
}
