import type { Timers } from '../../../contracts/ambient';
import type { CommandId } from '../../../contracts/commands';
import type { Disposable } from '../../../contracts/disposable';
import type { ContentScroll, ScrollStep } from '../../../contracts/editor';
import type { PluginLog } from '../../../contracts/log';
import type { MarkdownRenderer } from '../../../contracts/markdown';
import type { ResizeTarget } from '../../../contracts/panes';
import type { OsName } from '../../../contracts/platform';
import type { LayoutState } from '../../../contracts/state';
import type { UiState } from '../../../contracts/ui-state';
import { errorText } from '../../../shared/error-text';
import { scrollContent } from '../../../shared/content-scroll';
import type { FormsView } from '../contract';
import { formsCommand, formsScope } from '../ids';
import type { Layout } from '../layouts/layout';
import { element } from '../../../shared/page/dom';
import {
  type EditorBoxes,
  keepFocusedBox,
} from '../../../shared/page/editor-boxes';
import type { KeyHints, ShownLayouts } from '../../../contracts/plugin';
import type {
  BaseKitDeps,
  KitCommands,
} from '../../../shared/page/layout-host/base-kit';
import { createStatusLine } from '../../../shared/page/status-line';
import { textLineHeightPx } from '../../../shared/page/text-line';
import { textButton } from '../../../shared/page/ui/button';
import {
  disposeAnchors,
  keyChevron,
  keyEdge,
  recordingAnchor,
} from '../../../shared/page/ui/key-anchors';
import { createSplit, type Split } from '../../../shared/page/ui/split';
import type { FormsContributions } from './contributions';
import type { BoxRef } from './boxes';
import {
  type FormsAction,
  type FormsState,
  progress,
  railItems,
  type RoundState,
  type TextTarget,
} from './form-state';
import { roundInfo } from './kinds/card-parts';
import type { CardDeps, ItemCard } from './kinds/item-format';
import { baseKitDepsFor, createFormsBaseKit } from './layout/card-kit';
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
import {
  hasOtherUnanswered,
  pagerText,
  railHeadText,
  roundSaveLabel,
  roundSaveState,
} from './view-model';

// `getState` reads the forms state, so a rail click logs only a jump that
// moved. `platform` is the OS key hints are drawn for; `uiState` keeps the
// rail's dragged width; `timers` runs the split's resize prompt linger.
// `commands` is what every kit's `command` checks and runs; `contributions`
// holds the card parts and review columns other plugins added; `state` is
// what every kit's `state` reads.
export interface RoundViewDeps {
  markdown: MarkdownRenderer;
  boxes: Pick<
    EditorBoxes<BoxRef>,
    | 'mount'
    | 'destroyBox'
    | 'destroyForm'
    | 'isMounted'
    | 'active'
    | 'activeMode'
    | 'focus'
    | 'formIdOf'
  >;
  keys: Pick<KeyHints, 'keysFor' | 'onKeymapChanged' | 'anchor'>;
  dispatch(action: FormsAction): void;
  getState(): FormsState;
  run(command: CommandId): void;
  commands: KitCommands;
  contributions: Pick<FormsContributions, 'cardParts' | 'reviewColumns'>;
  platform: OsName;
  state: LayoutState;
  uiState: UiState;
  timers: Timers;
  log: PluginLog;
}

// `update` draws the round for the view whose pane shows: under the cancel
// prompt, the view keeping the round returns to. `rebuild` rebuilds the
// view's children from `round` with the layouts it picked, remounting every
// box from the round's answers; the round's focused box takes focus again,
// and the main column keeps its scroll while the round shows the same item.
// `setLayouts` picks the round's layouts again from `shown` and rebuilds when
// a pick changed.
// `scrollBy` scrolls the main column by `step`, down for 1 and up for -1.
// `resizeTarget` is the view's rail | main split, which the resize keys move
// while the round shows.
// `dispose` disposes every anchor and markdown mount the view made and its
// split, and stops it following keymap changes; its owner calls it when it
// drops the view.
export interface RoundView {
  element: HTMLElement;
  update(round: RoundState, view: FormsView): void;
  rebuild(round: RoundState): void;
  setLayouts(shown: ShownLayouts<Layout>, round: RoundState): void;
  scrollBy(step: ScrollStep, direction: 1 | -1): ContentScroll;
  resizeTarget: ResizeTarget;
  dispose(): void;
}

// The children of a round view one build makes.
interface RoundParts {
  main: HTMLElement;
  layoutHead: HTMLElement | null;
  // Disposes the head's anchors and mounts and draws the layout's head again
  // in its slot; nothing for a layout with no head.
  redrawLayoutHead(): void;
  railHead: RailHead;
  rail: RailPane;
  pager: ItemPager;
  itemsPane: HTMLElement;
  itemCards: ItemCard[];
  review: ReviewPane;
  // Disposes every anchor and markdown mount the build made, the head's
  // included.
  dispose(): void;
}

// The rail's header: the open count, the save state and the unanswered pair.
interface RailHead {
  update(round: RoundState): void;
}

// The focused item's place in the round, between the item keys.
interface ItemPager {
  element: HTMLElement;
  update(round: RoundState): void;
}

// One open round's DOM, built with its editors: a split with the rail header,
// the rail pane and the Review button in its start pane, and the layout's
// head, the item pager, every item's card and the review pane, which holds the
// round note, in its end pane, each card and pane drawn by the layout
// `pickRoundLayouts` picks for it from `shown`. A render only updates it, the
// rail taking the latest dragged width of any round; new layouts that change a
// pick rebuild both panes, as `rebuild` does, keeping the rail's dragged
// width, the focused box and the main column's scroll. Every key hint is an
// anchor, which redraws itself on a keymap change; the change draws the
// layout's head again, shown or hidden, for the text it drew from the keys.
// `attach` places the root in the page once, before any editor mounts.
export function createRoundView(
  attach: (root: HTMLElement) => void,
  round: RoundState,
  shown: ShownLayouts<Layout>,
  deps: RoundViewDeps,
): RoundView {
  const split = createSplit({
    initial: 240,
    min: 160,
    endMin: 224,
    uiState: deps.uiState,
    stateKey: 'rail-width',
    anchor: deps.keys.anchor,
    timers: deps.timers,
  });
  const root = split.element;
  root.classList.add('round');
  split.end.classList.add('round-main');
  // Editors mount into attached elements, so they can measure themselves.
  attach(root);
  let shownView: FormsView = 'forms';
  let shownFocus = -1;
  const build = (current: RoundState, roundPicks: RoundPicks) =>
    buildRoundParts(split, current, roundPicks, deps);
  let picks = pickRoundLayouts(round.round, shown.user, shown.layouts);
  let parts = build(round, picks);

  const view: RoundView = {
    element: root,
    update(current, viewName) {
      // Every round's rail shares one stored width, and the view is updated
      // each time it is shown, so this picks up another round's drag.
      split.reloadWidth();
      shownView = viewName;
      const isForms = viewName === 'forms';
      const isReview = viewName === 'review';
      if (parts.layoutHead !== null) {
        parts.layoutHead.hidden = !isForms;
      }
      parts.railHead.update(current);
      parts.rail.update(current, viewName);
      parts.pager.element.hidden = !isForms;
      parts.pager.update(current);
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
      keepFocusedBox(deps.boxes, current.formId, () => {
        deps.boxes.destroyForm(current.formId);
        parts.dispose();
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
    resizeTarget: split,
    dispose() {
      parts.dispose();
      split.dispose();
      keysChange.dispose();
    },
  };
  const keysChange = deps.keys.onKeymapChanged(() => parts.redrawLayoutHead());
  return view;
}

// The anchor keys a build hands its parts.
type AnchorKeys = Pick<KeyHints, 'keysFor' | 'anchor'>;

// `keys`, keeping each anchor it names in `anchors`.
function recordingKeys(keys: AnchorKeys, anchors: Disposable[]): AnchorKeys {
  return { ...keys, anchor: recordingAnchor(keys.anchor, anchors) };
}

// Builds the split's start pane, the rail header, the rail pane and the rail
// foot, and the round's main column in its end pane: the layout's head, the
// item pager, the items pane of cards, and the review pane, each card and pane
// drawn by its pick in `picks`. A rail click acts on the forms view the state
// holds as it lands, the cancel prompt included. Every part anchors its keys
// through one recording `keys` and records its markdown mounts beside those
// anchors, the head into its own, so `dispose` reaches them all.
function buildRoundParts(
  split: Split,
  round: RoundState,
  picks: RoundPicks,
  deps: RoundViewDeps,
): RoundParts {
  const anchors: Disposable[] = [];
  const headAnchors: Disposable[] = [];
  const keys = recordingKeys(deps.keys, anchors);
  const items = railItems(round.round);
  const mountBox = (parent: HTMLElement, target: TextTarget, text: string) =>
    deps.boxes.mount(parent, { roundId: round.formId, target }, text);
  const destroyBox = (target: TextTarget) =>
    deps.boxes.destroyBox({ roundId: round.formId, target });
  const paneDeps: PaneDeps = {
    markdown: deps.markdown,
    platform: deps.platform,
    log: deps.log,
    keys,
    dispatch: deps.dispatch,
    getState: deps.getState,
    run: deps.run,
    mountBox,
    destroyBox,
    shownView: () => deps.getState().view,
    commands: deps.commands,
    contributions: deps.contributions,
    state: deps.state,
    recordAnchor: (anchor) => anchors.push(anchor),
    recordMount: (mount) => anchors.push(mount),
  };
  const railHead = buildRailHead(split.start, keys);
  const rail = buildRailPane(picks.panes.rail, split.start, round, paneDeps);
  buildRailFoot(split.start, keys, deps);
  const main = split.end;

  const headDeps: HeadDeps = {
    ...baseKitDepsFor(
      {
        ...deps,
        keys: recordingKeys(deps.keys, headAnchors),
        recordAnchor: (anchor) => headAnchors.push(anchor),
        recordMount: (mount) => headAnchors.push(mount),
      },
      formsScope('forms'),
    ),
    log: deps.log,
  };
  const headPick = picks.panes.head;
  const layoutHead = buildLayoutHead(
    main,
    round,
    headPick,
    headDeps,
    headAnchors,
  );
  const pager = buildItemPager(main, keys);
  const itemsPane = element('div', 'items');
  main.append(itemsPane);
  const cardDeps: CardDeps = {
    markdown: deps.markdown,
    mountBox,
    destroyBox,
    dispatch: deps.dispatch,
    toggleDontAsk: () => deps.run(formsCommand('toggleDontAsk')),
    keys,
    platform: deps.platform,
    log: deps.log,
    commands: deps.commands,
    contributions: deps.contributions,
    state: deps.state,
    recordAnchor: (anchor) => anchors.push(anchor),
    recordMount: (mount) => anchors.push(mount),
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
        disposeAnchors(headAnchors);
        drawLayoutHead(layoutHead, round, headPick, headDeps, headAnchors);
      }
    },
    railHead,
    rail,
    pager,
    itemsPane,
    itemCards,
    review,
    dispose() {
      disposeAnchors(anchors);
      disposeAnchors(headAnchors);
    },
  };
}

// Appends `header.rail-head` to `parent`: the open count, the round's save
// state, and the unanswered pair, `⌥P ◂ ▸ ⌥N`, hidden while no other
// untouched item is left to jump to.
function buildRailHead(parent: HTMLElement, keys: AnchorKeys): RailHead {
  const head = element('header', 'rail-head');
  const text = element('span', 'rail-head-text');
  const statusLine = createStatusLine();
  const previous = element('span');
  const next = element('span');
  const edge = keyEdge('rail-edge', [
    previous,
    keyChevron('◂'),
    keyChevron('▸'),
    next,
  ]);
  head.append(
    text,
    element('span', 'rail-head-separator', '·'),
    statusLine.element,
    edge,
  );
  parent.append(head);
  const scope = formsScope('forms');
  keys.anchor(previous, formsCommand('prevUnanswered'), { scope });
  keys.anchor(next, formsCommand('nextUnanswered'), { scope });
  return {
    update(round) {
      text.textContent = railHeadText(progress(round));
      statusLine.update(true, {
        save: roundSaveLabel(round),
        saveState: roundSaveState(round) ?? '',
      });
      edge.classList.toggle('is-no-target', !hasOtherUnanswered(round));
    },
  };
}

// Appends `footer.rail-foot` to `parent`, holding the Review button.
function buildRailFoot(
  parent: HTMLElement,
  keys: AnchorKeys,
  deps: Pick<RoundViewDeps, 'run'>,
) {
  const command = formsCommand('openReview');
  const review = textButton('Review', () => deps.run(command), {
    variant: 'ghost',
  });
  const reviewKeys = element('span');
  review.append(reviewKeys);
  const foot = element('footer', 'rail-foot');
  foot.append(review);
  parent.append(foot);
  keys.anchor(reviewKeys, command, { scope: formsScope('forms') });
}

// Appends `div.item-pager` to `parent`, `⌃H ‹ F1 of 6 › ⌃L`: each item key
// with its chevron in an edge cell, hidden while the round holds fewer than
// two items.
function buildItemPager(parent: HTMLElement, keys: AnchorKeys): ItemPager {
  const pager = element('div', 'item-pager');
  const previous = element('span');
  const next = element('span');
  const start = keyEdge('item-pager-edge', [previous, keyChevron('‹')]);
  const text = element('span', 'item-pager-text');
  const end = keyEdge('item-pager-edge', [keyChevron('›'), next]);
  pager.append(start, text, end);
  parent.append(pager);
  const scope = formsScope('forms');
  keys.anchor(previous, formsCommand('prevItem'), { scope });
  keys.anchor(next, formsCommand('nextItem'), { scope });
  return {
    element: pager,
    update(round) {
      text.textContent = pagerText(round);
      const hasNoOtherItem = railItems(round.round).length < 2;
      start.classList.toggle('is-no-target', hasNoOtherItem);
      end.classList.toggle('is-no-target', hasNoOtherItem);
    },
  };
}

// The head kit's deps over the forms view's keys, and the log.
type HeadDeps = BaseKitDeps & Pick<CardDeps, 'log'>;

// The slot above the cards the picked layout's head draws into, carrying
// `data-layout` naming that layout and `data-layout-owner="forms"`; null for a
// layout with no head.
// `anchors` holds the anchors `deps` names.
function buildLayoutHead(
  parent: HTMLElement,
  round: RoundState,
  pick: LayoutPick,
  deps: HeadDeps,
  anchors: Disposable[],
): HTMLElement | null {
  if (typeof pick.layout.head !== 'function') {
    return null;
  }
  const slot = element('div', 'layout-head');
  slot.dataset.layout = pick.name;
  slot.dataset.layoutOwner = 'forms';
  parent.append(slot);
  drawLayoutHead(slot, round, pick, deps, anchors);
  return slot;
}

// Empties `slot` and draws the picked layout's head into it, with the keys
// the keymap binds now. The head holds no text boxes, so a redraw loses no
// answer. A head that throws is logged, disposes `anchors`, the anchors
// `deps` names, and leaves the slot empty.
function drawLayoutHead(
  slot: HTMLElement,
  round: RoundState,
  pick: LayoutPick,
  deps: HeadDeps,
  anchors: Disposable[],
) {
  slot.replaceChildren();
  try {
    pick.layout.head?.(slot, roundInfo(round.round), createFormsBaseKit(deps));
  } catch (error) {
    disposeAnchors(anchors);
    slot.replaceChildren();
    deps.log(`layout ${pick.name} head failed: ${errorText(error)}`);
  }
}
