import type { CommandId } from '../../../contracts/commands';
import type { Log } from '../../../contracts/log';
import type { MarkdownRenderer } from '../../../contracts/markdown';
import type { Platform } from '../../../contracts/platform';
import type { UiState } from '../../../contracts/ui-state';
import { errorText } from '../../../shared/error-text';
import type { KeysPageExports } from '../../keys/contract';
import { type FormsCommandName, formsCommand, formsScope } from '../ids';
import type { Layout } from '../layouts/layout';
import { button, element, markdownElement } from '../../../shared/page/dom';
import { textButton } from '../../../shared/page/ui/button';
import { row as rowPart } from '../../../shared/page/ui/row';
import { createSplit, type Split } from '../../../shared/page/ui/split';
import { setDotStatus, statusDot } from '../../../shared/page/ui/status-dot';
import { tag } from '../../../shared/page/ui/tag';
import type { EditorBoxes } from './editor-boxes';
import {
  answerableItems,
  answerStatus,
  type FormsAction,
  type FormsView,
  progress,
  type RailItem,
  railItems,
  railPosition,
  type RoundState,
} from './form-state';
import {
  appendKeyHint,
  buildField,
  keyHint,
  roundInfo,
  statusLabel,
} from './kinds/card-parts';
import { FORMATS, itemLabel } from './kinds/formats';
import type { CardDeps, ItemCard } from './kinds/item-format';
import { createHeadKit } from './layout/card-kit';
import { buildLayoutCard } from './layout/layout-cards';
import {
  progressText,
  railDotStatus,
  railPickAction,
  type ReviewRow,
  reviewRows,
  reviewRowsChanged,
} from './view-model';

// `platform` is the OS key hints are drawn for; `uiState` keeps the rail's
// dragged width.
export interface RoundViewDeps {
  markdown: MarkdownRenderer;
  boxes: Pick<EditorBoxes, 'mount' | 'destroyBox' | 'destroyRound'>;
  keys: Pick<KeysPageExports, 'keysFor' | 'onChanged'>;
  dispatch(action: FormsAction): void;
  run(command: CommandId): void;
  platform: Platform;
  uiState: UiState;
  log: Log;
}

// `setLayout` rebuilds the view's children with `layout`'s cards and head
// from `round`, remounting every box. `dispose` stops the view following
// keymap changes; its owner calls it when it drops the view.
export interface RoundView {
  element: HTMLElement;
  update(round: RoundState, view: FormsView): void;
  setLayout(layout: Layout, layoutName: string, round: RoundState): void;
  dispose(): void;
}

// The children of a round view one build makes.
interface RoundParts {
  items: RailItem[];
  main: HTMLElement;
  head: { element: HTMLElement; update(round: RoundState): void };
  layoutHead: HTMLElement | null;
  // Draws the layout's head again in its slot; nothing for a layout with no
  // head.
  redrawLayoutHead(): void;
  railEntries: RailEntry[];
  itemsPane: HTMLElement;
  itemCards: ItemCard[];
  review: ReviewPart;
}

// `update` rebuilds the rows only when reviewRowsChanged says they differ
// from the last draw, and scrolls the cursor row into view on a rebuild and
// when `isNewlyShown`; `forgetRows` makes the next `update` rebuild them.
interface ReviewPart {
  element: HTMLElement;
  update(round: RoundState, isNewlyShown: boolean): void;
  forgetRows(): void;
}

// One open round's DOM, built with its editors: a split with the rail in its
// start pane, and the layout's head, every item's card and the review with
// the round note in its end pane. A render only updates it, the rail taking
// the latest dragged width of any round; a new layout rebuilds both panes,
// keeping the rail's dragged width. A keymap change
// draws the layout's head again, shown or hidden, since showing the view only
// updates it, and has the review rebuild its rows at its next update; while
// the view shows, the change also updates it with the round it last showed,
// so every key hint reads the new keys. `attach` places the
// root in the page once, before any editor mounts.
export function createRoundView(
  attach: (root: HTMLElement) => void,
  round: RoundState,
  layout: Layout,
  layoutName: string,
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
  const build = (current: RoundState, cardLayout: Layout, name: string) =>
    buildRoundParts(split, current, cardLayout, name, deps, () => shownView);
  let parts = build(round, layout, layoutName);

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
      const { items } = parts;
      parts.head.element.hidden = !isReview;
      parts.head.update(current);
      if (parts.layoutHead !== null) {
        parts.layoutHead.hidden = !isForms;
      }
      parts.railEntries.forEach((entry, position) => {
        updateRailEntry(entry, current, items[position], position, isReview);
      });
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
        parts.railEntries[current.focus]?.element.scrollIntoView({
          block: 'nearest',
        });
      }
    },
    setLayout(nextLayout, nextName, current) {
      deps.boxes.destroyRound(current.roundId);
      split.start.replaceChildren();
      split.end.replaceChildren();
      parts = build(current, nextLayout, nextName);
      shownFocus = -1;
      view.update(current, shownView);
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

// Builds the rail into the split's start pane and the round's main column
// into its end pane: the review's head, the layout's head, the items pane of
// cards, and the review. `shownView` reads the view last shown, which decides
// what a rail click does.
function buildRoundParts(
  split: Split,
  round: RoundState,
  layout: Layout,
  layoutName: string,
  deps: RoundViewDeps,
  shownView: () => FormsView,
): RoundParts {
  const items = railItems(round.round);
  const rail = element('nav', 'rail');
  rail.setAttribute('aria-label', 'Items');
  const railList = element('ol', 'rail-list');
  rail.append(railList);
  split.start.append(rail);
  const main = split.end;

  const head = buildHead(main, round, deps.markdown);
  const keysFor = (command: CommandId) =>
    deps.keys.keysFor(command, formsScope('forms'));
  const headDeps: HeadDeps = {
    markdown: deps.markdown,
    keysFor,
    platform: deps.platform,
    log: deps.log,
  };
  const layoutHead = buildLayoutHead(main, round, layout, layoutName, headDeps);
  const itemsPane = element('div', 'items');
  main.append(itemsPane);
  const reviewRowAt = reviewRowsByRailPosition(round);
  const railEntries = items.map((item, position) =>
    buildRailEntry(railList, round, item, () => {
      const action = railPickAction(
        shownView(),
        position,
        reviewRowAt[position],
      );
      if (action !== null) {
        deps.dispatch(action);
      }
    }),
  );
  const cardDeps: CardDeps = {
    markdown: deps.markdown,
    mountBox: (parent, target, text) =>
      deps.boxes.mount(parent, { roundId: round.roundId, target }, text),
    destroyBox: (target) =>
      deps.boxes.destroyBox({ roundId: round.roundId, target }),
    dispatch: deps.dispatch,
    toggleDontAsk: () => deps.run(formsCommand('toggleDontAsk')),
    keysFor,
    platform: deps.platform,
    log: deps.log,
  };
  const itemCards = items.map((item, position) =>
    buildLayoutCard(
      layout,
      layoutName,
      itemsPane,
      round,
      item,
      position,
      cardDeps,
    ),
  );
  const review = buildReview(main, round, deps);
  return {
    items,
    main,
    head,
    layoutHead,
    redrawLayoutHead() {
      if (layoutHead !== null) {
        drawLayoutHead(layoutHead, round, layout, layoutName, headDeps);
      }
    },
    railEntries,
    itemsPane,
    itemCards,
    review,
  };
}

type HeadDeps = Pick<CardDeps, 'markdown' | 'keysFor' | 'platform' | 'log'>;

// The slot above the cards the layout's head draws into; null for a layout
// with no head.
function buildLayoutHead(
  parent: HTMLElement,
  round: RoundState,
  layout: Layout,
  layoutName: string,
  deps: HeadDeps,
): HTMLElement | null {
  if (layout.head === undefined) {
    return null;
  }
  const slot = element('div', 'layout-head');
  parent.append(slot);
  drawLayoutHead(slot, round, layout, layoutName, deps);
  return slot;
}

// Empties `slot` and draws the layout's head into it, with the keys the
// keymap binds now. The head holds no text boxes, so a redraw loses no
// answer. A head that throws is logged and leaves the slot empty.
function drawLayoutHead(
  slot: HTMLElement,
  round: RoundState,
  layout: Layout,
  layoutName: string,
  deps: HeadDeps,
) {
  slot.replaceChildren();
  try {
    layout.head?.(slot, roundInfo(round.round), createHeadKit(deps));
  } catch (error) {
    slot.replaceChildren();
    deps.log('forms', `layout ${layoutName} head failed: ${errorText(error)}`);
  }
}

function buildHead(
  parent: HTMLElement,
  round: RoundState,
  markdown: MarkdownRenderer,
): { element: HTMLElement; update(round: RoundState): void } {
  const head = element('header', 'round-head');
  head.append(element('h1', 'round-heading', round.round.heading));
  if (round.round.overview.trim() !== '') {
    head.append(
      markdownElement(
        'div',
        'round-overview',
        markdown.inline(round.round.overview),
      ),
    );
  }
  const progressLine = element('p', 'round-progress');
  head.append(progressLine);
  parent.append(head);
  return {
    element: head,
    update(current) {
      progressLine.textContent = progressText(progress(current));
    },
  };
}

// Each rail position's review row; undefined at a notice, which has none.
function reviewRowsByRailPosition(round: RoundState): (number | undefined)[] {
  const rows: (number | undefined)[] = [];
  answerableItems(round.round).forEach((item, row) => {
    rows[railPosition(round.round, item)] = row;
  });
  return rows;
}

// An item's row in the rail, and the status dot it leads with.
interface RailEntry {
  element: HTMLElement;
  dot: HTMLElement;
}

// The item's number and title as a list row, its title also the tooltip for
// the ellipsis.
function buildRailEntry(
  parent: HTMLElement,
  round: RoundState,
  item: RailItem,
  onClick: () => void,
): RailEntry {
  const title = FORMATS[item.kind].title(round.round, item.index);
  const dot = statusDot('idle');
  const leading = element('span', 'rail-lead');
  leading.append(dot, element('span', 'rail-number', itemLabel(item)));
  const entry = rowPart({
    density: 'list',
    tag: 'li',
    label: title,
    leading,
    onClick,
  });
  entry.classList.add('rail-entry');
  entry.title = title;
  parent.append(entry);
  return { element: entry, dot };
}

// The focused item's row is selected; while the review is open, untouched
// items are flagged in the rail.
function updateRailEntry(
  entry: RailEntry,
  round: RoundState,
  item: RailItem,
  position: number,
  isReview: boolean,
) {
  const status =
    item.kind === 'notice'
      ? 'notice'
      : answerStatus(round, { kind: item.kind, index: item.index });
  const isFlagged = isReview && status === 'untouched';
  entry.element.dataset.status = status;
  entry.element.classList.toggle('is-selected', position === round.focus);
  entry.element.classList.toggle('is-flagged', isFlagged);
  setDotStatus(entry.dot, railDotStatus(status, isFlagged));
}

// The review's rows, then the round note, then Send answers and Cancel round
// with the review's keys for them; the note shows only while the review or the
// cancel prompt does. The summary and the buttons' keys redraw on every
// update; the rows only when they change. The cursor row scrolls into view
// when the rows change and each time the review is shown again.
function buildReview(
  parent: HTMLElement,
  round: RoundState,
  deps: RoundViewDeps,
): ReviewPart {
  let drawn: RoundState | null = null;
  const section = element('section', 'review');
  const summary = element('p', 'review-summary');
  const list = element('ol', 'review-rows');
  section.append(element('h2', 'review-title', 'Review'), summary, list);
  parent.append(section);
  const note = buildField(
    section,
    'field-note',
    'Round note',
    'Optional. Anything about the round as a whole.',
  );
  deps.boxes.mount(
    note.box,
    { roundId: round.roundId, target: { field: 'note' } },
    round.note,
  );
  const actions = element('div', 'review-actions');
  const submit = textButton(
    'Send answers',
    () => deps.run(formsCommand('submit')),
    { variant: 'primary' },
  );
  const redrawSubmitKeys = appendKeyHint(
    submit,
    () => reviewKeysFor(deps, 'submit'),
    deps.platform,
  );
  const cancel = textButton('Cancel round', () =>
    deps.run(formsCommand('askCancel')),
  );
  const redrawCancelKeys = appendKeyHint(
    cancel,
    () => reviewKeysFor(deps, 'askCancel'),
    deps.platform,
  );
  actions.append(submit, cancel);
  section.append(actions);
  return {
    element: section,
    update(current, isNewlyShown) {
      const counts = progress(current);
      const untouched =
        counts.untouched > 0
          ? ` ${counts.untouched} not answered; they are sent as untouched.`
          : '';
      summary.textContent = `${progressText(counts)}.${untouched}`;
      redrawSubmitKeys();
      redrawCancelKeys();
      const isRowsChanged = reviewRowsChanged(drawn, current);
      if (isRowsChanged) {
        drawn = current;
        list.replaceChildren(
          ...reviewRows(current).map((row) => buildReviewRow(row, deps)),
        );
      }
      if (isRowsChanged || isNewlyShown) {
        list.querySelector('.is-cursor')?.scrollIntoView({ block: 'nearest' });
      }
    },
    forgetRows() {
      drawn = null;
    },
  };
}

// The review scope's keys for a forms command; null when unbound there.
function reviewKeysFor(
  deps: RoundViewDeps,
  command: FormsCommandName,
): string | null {
  return deps.keys.keysFor(formsCommand(command), formsScope('review'));
}

const MISSING_HINTS: Record<NonNullable<ReviewRow['missing']>, string> = {
  solution: 'Needs a solution',
  action: 'Needs an action',
};

// A finding with a complete pick reads as its action, then its solution; one
// missing half its pick names the missing half in place of its status. The
// cursor's row shows the keys that jump to its item, as clicking it does.
function buildReviewRow(row: ReviewRow, deps: RoundViewDeps): HTMLLIElement {
  const entry = element('li', 'review-row');
  entry.dataset.status = row.status;
  entry.classList.toggle('is-cursor', row.isCursor);
  const pick = button('review-pick', '', () =>
    deps.dispatch({ type: 'reviewJump', row: row.row }),
  );
  const answer = element('span', 'review-answer');
  if (row.actionLabel !== '') {
    answer.append(element('span', 'review-action', row.actionLabel));
    if (row.choice > 0) {
      answer.append(element('span', 'review-separator', '—'));
    }
  }
  if (row.choice > 0) {
    answer.append(
      element('span', 'choice-number', String(row.choice)),
      markdownElement(
        'span',
        'choice-text',
        deps.markdown.inline(row.choiceText),
      ),
    );
  }
  if (row.recommended) {
    answer.append(tag('Recommended', 'accent'));
  }
  const showsPick = row.actionLabel !== '' || row.choice > 0;
  if (!showsPick) {
    answer.textContent =
      row.missing === null
        ? statusLabel(row.status)
        : MISSING_HINTS[row.missing];
  }
  pick.append(
    element('span', 'review-number', row.label),
    element('span', 'review-question', row.title),
    answer,
  );
  const hint = row.isCursor
    ? keyHint(reviewKeysFor(deps, 'reviewJump'), deps.platform)
    : null;
  if (hint !== null) {
    pick.append(hint);
  }
  entry.append(pick);
  if (row.notes.trim() !== '') {
    entry.append(element('p', 'review-detail', `Notes: ${row.notes}`));
  }
  if (row.dontAsk) {
    const reason = row.dontAskReason.trim();
    entry.append(
      element(
        'p',
        'review-detail',
        reason === '' ? "Don't ask me this" : `Don't ask me this: ${reason}`,
      ),
    );
  }
  return entry;
}
