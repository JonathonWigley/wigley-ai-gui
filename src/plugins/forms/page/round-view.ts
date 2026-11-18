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
import type { FormsScreen } from '../contract';
import { formsScope } from '../ids';
import type {
  Layout,
  PagerInput,
  RailFootInput,
  RailHeadInput,
} from '../layouts/layout';
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
import type { DrawnPart } from '../../../shared/page/layout-host/draw-part';
import {
  createStatusLine,
  type StatusLine,
} from '../../../shared/page/status-line';
import { textLineHeightPx } from '../../../shared/page/text-line';
import {
  disposeAnchors,
  recordingAnchor,
} from '../../../shared/page/ui/key-anchors';
import { createSplit, type Split } from '../../../shared/page/ui/split';
import type { FormsContributions } from './contributions';
import type { BoxRef } from './boxes';
import {
  isNoticesStop,
  railItems,
  type RoundState,
  type TextTarget,
} from './round-model';
import { roundInfo } from './kinds/card-parts';
import type { CardDeps, ItemCard } from './kinds/item-format';
import { baseKitDepsFor, createFormsBaseKit } from './layout/card-kit';
import { buildLayoutCard } from './layout/layout-cards';
import {
  buildNoticesPane,
  buildRailPane,
  buildReviewPane,
  drawPager,
  drawRailFoot,
  drawRailHead,
  type DrawnChrome,
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
  pagerInput,
  railFootInput,
  railHeadInput,
  roundSaveLabel,
  roundSaveState,
} from './view-model';

// `platform` is the OS key hints are drawn for; `uiState` keeps the rail's
// dragged width; `timers` runs the split's resize prompt linger. `commands`
// is what every kit's `command` checks and runs, and every click of a card
// and pane runs through; `contributions`
// holds the card parts and review columns other plugins added; `state` is
// what every kit's `state` reads.
export interface RoundViewDeps {
  markdown: MarkdownRenderer;
  boxes: Pick<
    EditorBoxes<BoxRef>,
    | 'mount'
    | 'destroyBox'
    | 'destroyForm'
    | 'destroyReleased'
    | 'isMounted'
    | 'editorOf'
    | 'active'
    | 'activeMode'
    | 'focus'
    | 'formIdOf'
  >;
  keys: Pick<KeyHints, 'keysFor' | 'onKeymapChanged' | 'anchor'>;
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
// prompt, the view keeping the round returns to. A round whose page kinds
// differ from those the view was built with picks its layouts again and
// rebuilds before it updates, so a card of a kind that left is dropped and
// one that arrived is drawn. `rebuild` rebuilds the
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
  update(round: RoundState, view: FormsScreen): void;
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
  // The round's save status, which the rail head's kit places.
  statusLine: StatusLine;
  railHead: ChromeStrip<RailHeadInput>;
  rail: RailPane;
  railFoot: ChromeStrip<RailFootInput>;
  pager: ChromeStrip<PagerInput>;
  itemsPane: HTMLElement;
  itemCards: ItemCard[];
  review: ReviewPane;
  // Disposes every anchor and markdown mount the build made, the head's and
  // each chrome strip's last draw's included.
  dispose(): void;
}

// One chrome strip of a build: the slot it draws into, its last draw and the
// input that draw took; `draw` draws it into the slot.
interface ChromeStrip<Input extends object> {
  slot: HTMLElement;
  draw(input: Input): DrawnPart<DrawnChrome>;
  drawn: DrawnPart<DrawnChrome> | null;
  input: Input | null;
}

// One open round's DOM, built with its editors: a split with the rail head,
// the rail pane and the rail foot in its start pane, and the layout's
// head, the item pager, every rail stop's card, the notices
// pane and the review pane, which holds the round note, in its end pane, each
// card, pane and strip drawn by the layout `pickRoundLayouts` picks for it
// from `shown`. A render only updates it, each strip (the rail head and foot,
// the item pager) drawing again when its input changed, the
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
  let shownView: FormsScreen = 'forms';
  let shownFocus = -1;
  const build = (current: RoundState, roundPicks: RoundPicks) =>
    buildRoundParts(split, current, roundPicks, deps);
  let shownLayouts = shown;
  let picks = pickRoundLayouts(round, shown.user, shown.layouts);
  let builtKinds = round.kinds;
  let parts = build(round, picks);

  const view: RoundView = {
    element: root,
    update(current, viewName) {
      if (current.kinds !== builtKinds) {
        shownView = viewName;
        picks = pickRoundLayouts(
          current,
          shownLayouts.user,
          shownLayouts.layouts,
        );
        view.rebuild(current);
        return;
      }
      // Every round's rail shares one stored width, and the view is updated
      // each time it is shown, so this picks up another round's drag.
      split.reloadWidth();
      shownView = viewName;
      const isForms = viewName === 'forms';
      const isReview = viewName === 'review';
      if (parts.layoutHead !== null) {
        parts.layoutHead.hidden = !isForms;
      }
      updateChrome(parts, current);
      parts.rail.update(current, viewName);
      parts.pager.slot.hidden = !isForms;
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
        builtKinds = current.kinds;
        parts = build(current, picks);
        shownFocus = -1;
        view.update(current, shownView);
        if (showsSameItem) {
          parts.main.scrollTop = scrollTop;
        }
      });
    },
    setLayouts(nextShown, current) {
      shownLayouts = nextShown;
      const nextPicks = pickRoundLayouts(
        current,
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

// Builds the split's start pane, the rail head's slot, the rail pane and the
// rail foot's slot, and the round's main column in its end pane: the layout's
// head, the item pager's slot, the items pane of cards and the notices pane at
// the notices stop's rail position, and the review pane, each card, pane and
// strip drawn by its pick in `picks`. Every card and pane anchors its keys
// through one recording `keys` and records its markdown mounts beside those
// anchors, the head into its own, and each strip's draw keeps its own, so
// `dispose` reaches them all.
function buildRoundParts(
  split: Split,
  round: RoundState,
  picks: RoundPicks,
  deps: RoundViewDeps,
): RoundParts {
  const anchors: Disposable[] = [];
  const headAnchors: Disposable[] = [];
  const keys = recordingKeys(deps.keys, anchors);
  const items = railItems(round);
  const mountBox = (parent: HTMLElement, target: TextTarget, text: string) =>
    deps.boxes.mount(parent, { roundId: round.formId, target }, text);
  const destroyBox = (target: TextTarget) =>
    deps.boxes.destroyBox({ roundId: round.formId, target });
  const paneDeps: PaneDeps = {
    markdown: deps.markdown,
    platform: deps.platform,
    log: deps.log,
    keys,
    run: deps.run,
    mountBox,
    destroyBox,
    commands: deps.commands,
    contributions: deps.contributions,
    state: deps.state,
    recordAnchor: (anchor) => anchors.push(anchor),
    recordMount: (mount) => anchors.push(mount),
  };
  // Each strip's draw owns the anchors and mounts it makes, so a redraw
  // releases the last draw's.
  const chromeDeps: PaneDeps = {
    ...paneDeps,
    keys: deps.keys,
    recordAnchor: () => {},
    recordMount: () => {},
  };
  const statusLine = createStatusLine();
  const railHead = chromeStrip('rail-head-slot', (slot, input: RailHeadInput) =>
    drawRailHead(
      picks.panes.railHead,
      slot,
      input,
      statusLine.element,
      chromeDeps,
    ),
  );
  split.start.append(railHead.slot);
  updateStrip(railHead, railHeadInput(round));
  const rail = buildRailPane(picks.panes.rail, split.start, round, paneDeps);
  const railFoot = chromeStrip('rail-foot-slot', (slot, input: RailFootInput) =>
    drawRailFoot(picks.panes.railFoot, slot, input, chromeDeps),
  );
  split.start.append(railFoot.slot);
  updateStrip(railFoot, railFootInput(round));
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
  const pager = chromeStrip('item-pager-slot', (slot, input: PagerInput) =>
    drawPager(picks.panes.pager, slot, input, chromeDeps),
  );
  main.append(pager.slot);
  updateStrip(pager, pagerInput(round));
  const itemsPane = element('div', 'items');
  main.append(itemsPane);
  const cardDeps: CardDeps = {
    markdown: deps.markdown,
    mountBox,
    destroyBox,
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
    isNoticesStop(item)
      ? buildNoticesPane(
          picks.panes.notices,
          picks.noticeCards,
          itemsPane,
          round,
          position,
          paneDeps,
          cardDeps,
        )
      : buildLayoutCard(
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
    statusLine,
    railHead,
    rail,
    railFoot,
    pager,
    itemsPane,
    itemCards,
    review,
    dispose() {
      disposeAnchors(anchors);
      disposeAnchors(headAnchors);
      railHead.drawn?.dispose();
      railFoot.drawn?.dispose();
      pager.drawn?.dispose();
    },
  };
}

// A strip whose slot is `div.<slotClass>`, drawn by `draw`, with no draw yet.
function chromeStrip<Input extends object>(
  slotClass: string,
  draw: (slot: HTMLElement, input: Input) => DrawnPart<DrawnChrome>,
): ChromeStrip<Input> {
  const slot = element('div', slotClass);
  return {
    slot,
    draw: (input) => draw(slot, input),
    drawn: null,
    input: null,
  };
}

// Draws each chrome strip again whose input changed, then keeps the save
// status current and marks the strips' edges `is-no-target`: the rail head's
// while no other untouched item is left, the pager's while the round holds
// fewer than two stops.
function updateChrome(parts: RoundParts, round: RoundState) {
  updateStrip(parts.railHead, railHeadInput(round));
  updateStrip(parts.railFoot, railFootInput(round));
  updateStrip(parts.pager, pagerInput(round));
  parts.statusLine.update(true, {
    save: roundSaveLabel(round),
    saveState: roundSaveState(round) ?? '',
  });
  markEdges(parts.railHead, !hasOtherUnanswered(round));
  markEdges(parts.pager, railItems(round).length < 2);
}

// Draws the strip again when it has no draw or a field of its input changed:
// the last draw disposed, its slot emptied, then drawn.
function updateStrip<Input extends object>(
  strip: ChromeStrip<Input>,
  input: Input,
) {
  if (isSameInput(strip.input, input)) {
    return;
  }
  strip.drawn?.dispose();
  strip.slot.replaceChildren();
  strip.drawn = strip.draw(input);
  strip.input = input;
}

// Whether every field of `next` equals that field of `drawn`.
function isSameInput<Input extends object>(
  drawn: Input | null,
  next: Input,
): boolean {
  if (drawn === null) {
    return false;
  }
  return (Object.keys(next) as (keyof Input)[]).every(
    (field) => drawn[field] === next[field],
  );
}

// Toggles `is-no-target` on each edge the strip's last draw drew.
function markEdges(strip: ChromeStrip<object>, isNoTarget: boolean) {
  for (const edge of strip.drawn?.built.edges ?? []) {
    edge.classList.toggle('is-no-target', isNoTarget);
  }
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
