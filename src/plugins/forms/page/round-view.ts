import type { CommandId } from '../../../contracts/commands';
import type { ContentScroll, ScrollStep } from '../../../contracts/editor';
import type { Log } from '../../../contracts/log';
import type { MarkdownRenderer } from '../../../contracts/markdown';
import type { Platform } from '../../../contracts/platform';
import type { UiState } from '../../../contracts/ui-state';
import { errorText } from '../../../shared/error-text';
import { scrollContent } from '../../../shared/content-scroll';
import type { KeysPageExports } from '../../keys/contract';
import type { FormsView } from '../contract';
import { formsCommand, formsScope } from '../ids';
import type { Layout } from '../layouts/layout';
import { element } from '../../../shared/page/dom';
import type { ShownLayouts } from '../../../shared/page/layout-loader';
import { textLineHeightPx } from '../../../shared/page/text-line';
import { createSplit, type Split } from '../../../shared/page/ui/split';
import type { FormsContributions } from './contributions';
import type { EditorBoxes } from './editor-boxes';
import {
  type FormsAction,
  type FormsState,
  railItems,
  type RoundState,
  type TextTarget,
} from './form-state';
import { roundInfo } from './kinds/card-parts';
import type { CardDeps, ItemCard } from './kinds/item-format';
import {
  createHeadKit,
  type HeadKitDeps,
  headKitDepsFor,
} from './layout/card-kit';
import type { KitCommands } from './layout/kit-commands';
import { buildLayoutCard } from './layout/layout-cards';
import {
  buildRailPane,
  buildReviewPane,
  type PaneDeps,
  type RailPane,
  type ReviewPane,
} from './layout/layout-panes';
import {
  type LayoutPick,
  pickRoundLayouts,
  picksEqual,
  type RoundPicks,
} from './layout/layout-resolver';

// `getState` reads the forms state, so a rail click logs only a jump that
// moved. `platform` is the OS key hints are drawn for; `uiState` keeps the
// rail's dragged width. `commands` is what every kit's `command` checks and
// runs; `contributions` holds the card parts and review columns other plugins
// added.
export interface RoundViewDeps {
  markdown: MarkdownRenderer;
  boxes: Pick<
    EditorBoxes,
    | 'mount'
    | 'destroyBox'
    | 'destroyRound'
    | 'isMounted'
    | 'active'
    | 'activeMode'
    | 'focus'
  >;
  keys: Pick<KeysPageExports, 'keysFor' | 'onChanged'>;
  dispatch(action: FormsAction): void;
  getState(): FormsState;
  run(command: CommandId): void;
  commands: KitCommands;
  contributions: Pick<FormsContributions, 'cardParts' | 'reviewColumns'>;
  platform: Platform;
  uiState: UiState;
  log: Log;
}

// `rebuild` rebuilds the view's children from `round` with the layouts it
// picked, remounting every box from the round's answers; the round's focused
// box takes focus again, and the main column keeps its scroll while the round
// shows the same item. `setLayouts` picks
// the round's layouts again from `shown` and rebuilds when a pick changed.
// `scrollBy` scrolls the main column by `step`, down for 1 and up for -1.
// `dispose` stops the view following keymap changes; its owner calls it when
// it drops the view.
export interface RoundView {
  element: HTMLElement;
  update(round: RoundState, view: FormsView): void;
  rebuild(round: RoundState): void;
  setLayouts(shown: ShownLayouts<Layout>, round: RoundState): void;
  scrollBy(step: ScrollStep, direction: 1 | -1): ContentScroll;
  dispose(): void;
}

// The children of a round view one build makes.
interface RoundParts {
  main: HTMLElement;
  layoutHead: HTMLElement | null;
  // Draws the layout's head again in its slot; nothing for a layout with no
  // head.
  redrawLayoutHead(): void;
  rail: RailPane;
  itemsPane: HTMLElement;
  itemCards: ItemCard[];
  review: ReviewPane;
}

// One open round's DOM, built with its editors: a split with the rail pane in
// its start pane, and the layout's head, every item's card and the review
// pane, which holds the round note, in its end pane, each card and pane drawn
// by the layout `pickRoundLayouts` picks for it from `shown`. A render only
// updates it, the rail taking the latest dragged width of any round; new
// layouts that change a pick rebuild both panes, as `rebuild` does, keeping
// the rail's dragged width, the focused box and the main column's scroll. A
// keymap change draws the layout's head again, shown or hidden, since
// showing the view only updates it, and has the review redraw its rows at its
// next update; while the view shows, the change also updates it with the
// round it last showed, so every key hint reads the new keys. `attach` places
// the root in the page once, before any editor mounts.
export function createRoundView(
  attach: (root: HTMLElement) => void,
  round: RoundState,
  shown: ShownLayouts<Layout>,
  deps: RoundViewDeps,
): RoundView {
  const split = createSplit({
    initial: 240,
    min: 160,
    max: 400,
    uiState: deps.uiState,
    stateKey: 'rail-width',
  });
  const root = split.element;
  root.classList.add('round');
  split.end.classList.add('round-main');
  // Editors mount into attached elements, so they can measure themselves.
  attach(root);
  let shownView: FormsView = 'forms';
  let shownRound: RoundState | null = null;
  let shownFocus = -1;
  const build = (current: RoundState, roundPicks: RoundPicks) =>
    buildRoundParts(split, current, roundPicks, deps, () => shownView);
  let picks = pickRoundLayouts(round.round, shown.user, shown.layouts);
  let parts = build(round, picks);

  const view: RoundView = {
    element: root,
    update(current, viewName) {
      // Every round's rail shares one stored width, and the view is updated
      // each time it is shown, so this picks up another round's drag.
      split.reloadWidth();
      shownView = viewName;
      shownRound = current;
      const isForms = viewName === 'forms';
      const isReview = viewName === 'review' || viewName === 'confirm';
      if (parts.layoutHead !== null) {
        parts.layoutHead.hidden = !isForms;
      }
      parts.rail.update(current, viewName);
      parts.itemsPane.hidden = !isForms;
      parts.itemCards.forEach((card, position) => {
        const isShown = isForms && position === current.focus;
        card.element.hidden = !isShown;
        if (isShown) {
          card.update(current);
        }
      });
      const wasReviewHidden = parts.review.element.hidden === true;
      parts.review.element.hidden = !isReview;
      if (isReview) {
        parts.review.update(current, wasReviewHidden);
      }
      if (current.focus !== shownFocus) {
        shownFocus = current.focus;
        parts.main.scrollTop = 0;
        parts.rail.showEntry(current.focus);
      }
    },
    rebuild(current) {
      const showsSameItem = current.focus === shownFocus;
      const scrollTop = parts.main.scrollTop;
      keepFocusedBox(deps.boxes, current.roundId, () => {
        deps.boxes.destroyRound(current.roundId);
        split.start.replaceChildren();
        split.end.replaceChildren();
        parts = build(current, picks);
        shownFocus = -1;
        view.update(current, shownView);
        if (showsSameItem) {
          parts.main.scrollTop = scrollTop;
        }
      });
    },
    setLayouts(nextShown, current) {
      const nextPicks = pickRoundLayouts(
        current.round,
        nextShown.user,
        nextShown.layouts,
      );
      if (picksEqual(nextPicks, picks)) {
        return;
      }
      picks = nextPicks;
      view.rebuild(current);
    },
    scrollBy(step, direction) {
      return scrollContent(
        parts.main,
        step,
        direction,
        textLineHeightPx(parts.main),
      );
    },
    dispose() {
      keysChange.dispose();
    },
  };
  const keysChange = deps.keys.onChanged(() => {
    parts.review.forgetRows();
    parts.redrawLayoutHead();
    if (shownRound !== null && !root.hidden) {
      view.update(shownRound, shownView);
    }
  });
  return view;
}

// Runs `rebuild`, which destroys and remounts the boxes of round `roundId`,
// then focuses the round's box that had focus before it again, when the
// rebuilt round still mounts it. A box in insert mode comes back in insert
// mode at its text's end; the cursor, any other vim mode and undo are lost.
export function keepFocusedBox(
  boxes: Pick<EditorBoxes, 'active' | 'activeMode' | 'focus' | 'isMounted'>,
  roundId: string,
  rebuild: () => void,
) {
  const active = boxes.active();
  const focused = active?.roundId === roundId ? active : null;
  const wasInserting = boxes.activeMode()?.mode === 'insert';
  rebuild();
  if (focused === null || !boxes.isMounted(focused)) {
    return;
  }
  boxes.focus(focused, wasInserting ? { insertAtEnd: true } : undefined);
}

// Builds the rail pane into the split's start pane and the round's main
// column into its end pane: the layout's head, the items pane of cards, and
// the review pane, each card and pane drawn by its pick in `picks`.
// `shownView` reads the view last shown, which decides what a rail click
// does.
function buildRoundParts(
  split: Split,
  round: RoundState,
  picks: RoundPicks,
  deps: RoundViewDeps,
  shownView: () => FormsView,
): RoundParts {
  const items = railItems(round.round);
  const mountBox = (parent: HTMLElement, target: TextTarget, text: string) =>
    deps.boxes.mount(parent, { roundId: round.roundId, target }, text);
  const destroyBox = (target: TextTarget) =>
    deps.boxes.destroyBox({ roundId: round.roundId, target });
  const paneDeps: PaneDeps = {
    markdown: deps.markdown,
    platform: deps.platform,
    log: deps.log,
    keys: deps.keys,
    dispatch: deps.dispatch,
    getState: deps.getState,
    run: deps.run,
    mountBox,
    destroyBox,
    shownView,
    commands: deps.commands,
    contributions: deps.contributions,
  };
  const rail = buildRailPane(picks.panes.rail, split.start, round, paneDeps);
  const main = split.end;

  const headDeps: HeadDeps = {
    ...headKitDepsFor(deps, formsScope('forms')),
    log: deps.log,
  };
  const headPick = picks.panes.head;
  const layoutHead = buildLayoutHead(main, round, headPick, headDeps);
  const itemsPane = element('div', 'items');
  main.append(itemsPane);
  const cardDeps: CardDeps = {
    markdown: deps.markdown,
    mountBox,
    destroyBox,
    dispatch: deps.dispatch,
    toggleDontAsk: () => deps.run(formsCommand('toggleDontAsk')),
    keys: deps.keys,
    platform: deps.platform,
    log: deps.log,
    commands: deps.commands,
    contributions: deps.contributions,
  };
  const itemCards = items.map((item, position) =>
    buildLayoutCard(
      picks.cards[position],
      itemsPane,
      round,
      item,
      position,
      cardDeps,
    ),
  );
  const review = buildReviewPane(picks.panes.review, main, round, paneDeps);
  return {
    main,
    layoutHead,
    redrawLayoutHead() {
      if (layoutHead !== null) {
        drawLayoutHead(layoutHead, round, headPick, headDeps);
      }
    },
    rail,
    itemsPane,
    itemCards,
    review,
  };
}

// The head kit's deps over the forms view's keys, and the log.
type HeadDeps = HeadKitDeps & Pick<CardDeps, 'log'>;

// The slot above the cards the picked layout's head draws into, carrying
// `data-layout` naming that layout; null for a layout with no head.
function buildLayoutHead(
  parent: HTMLElement,
  round: RoundState,
  pick: LayoutPick,
  deps: HeadDeps,
): HTMLElement | null {
  if (typeof pick.layout.head !== 'function') {
    return null;
  }
  const slot = element('div', 'layout-head');
  slot.dataset.layout = pick.name;
  parent.append(slot);
  drawLayoutHead(slot, round, pick, deps);
  return slot;
}

// Empties `slot` and draws the picked layout's head into it, with the keys
// the keymap binds now. The head holds no text boxes, so a redraw loses no
// answer. A head that throws is logged and leaves the slot empty.
function drawLayoutHead(
  slot: HTMLElement,
  round: RoundState,
  pick: LayoutPick,
  deps: HeadDeps,
) {
  slot.replaceChildren();
  try {
    pick.layout.head?.(slot, roundInfo(round.round), createHeadKit(deps));
  } catch (error) {
    slot.replaceChildren();
    deps.log('forms', `layout ${pick.name} head failed: ${errorText(error)}`);
  }
}
