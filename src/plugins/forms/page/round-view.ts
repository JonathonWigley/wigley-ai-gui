import type { CommandId } from '../../../contracts/commands';
import type { Log } from '../../../contracts/log';
import type { MarkdownRenderer } from '../../../contracts/markdown';
import { errorText } from '../../../shared/error-text';
import type { KeysPageExports } from '../../keys/contract';
import {
  type FormsCommandName,
  formsCommand,
  formsScope,
  numberedCommand,
} from '../ids';
import type { Layout } from '../layouts/layout';
import {
  appendKeys,
  button,
  element,
  markdownElement,
  showKeys,
} from '../../../shared/page/dom';
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
import { buildField, roundInfo, statusLabel } from './kinds/card-parts';
import { FORMATS, itemLabel } from './kinds/formats';
import type { CardDeps, ItemCard } from './kinds/item-format';
import { createHeadKit } from './layout/card-kit';
import { buildLayoutCard } from './layout/layout-cards';
import { progressText, type ReviewRow, reviewRows } from './view-model';

export interface RoundViewDeps {
  markdown: MarkdownRenderer;
  boxes: Pick<EditorBoxes, 'mount' | 'destroyBox' | 'destroyRound'>;
  keys: Pick<KeysPageExports, 'keysFor' | 'onChanged'>;
  dispatch(action: FormsAction): void;
  run(command: CommandId): void;
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
  // Each rail position's review row.
  reviewRowAt: (number | undefined)[];
  main: HTMLElement;
  head: { element: HTMLElement; update(round: RoundState): void };
  layoutHead: HTMLElement | null;
  // Draws the layout's head again in its slot; nothing for a layout with no
  // head.
  redrawLayoutHead(): void;
  railEntries: RailEntry[];
  itemsPane: HTMLElement;
  itemCards: ItemCard[];
  review: { element: HTMLElement; update(round: RoundState): void };
}

// One open round's DOM, built with its editors: the rail, the layout's head
// and every item's card, and the review with the round note. A render only
// updates it; a new layout rebuilds it. A keymap change draws the layout's
// head again, shown or hidden, since showing the view only updates it; while
// the view shows, the change also updates it with the round it last showed,
// so every key hint reads the new keys. `attach` places the root in the page
// once, before any editor mounts.
export function createRoundView(
  attach: (root: HTMLElement) => void,
  round: RoundState,
  layout: Layout,
  layoutName: string,
  deps: RoundViewDeps,
): RoundView {
  const root = element('section', 'round');
  // Editors mount into attached elements, so they can measure themselves.
  attach(root);
  let shownView: FormsView = 'forms';
  let shownRound: RoundState | null = null;
  let shownFocus = -1;
  const build = (current: RoundState, cardLayout: Layout, name: string) =>
    buildRoundParts(root, current, cardLayout, name, deps, () => shownView);
  let parts = build(round, layout, layoutName);

  const view: RoundView = {
    element: root,
    update(current, viewName) {
      shownView = viewName;
      shownRound = current;
      const isForms = viewName === 'forms';
      const isReview = viewName === 'review' || viewName === 'confirm';
      const { items, reviewRowAt } = parts;
      parts.head.element.hidden = !isReview;
      parts.head.update(current);
      if (parts.layoutHead !== null) {
        parts.layoutHead.hidden = !isForms;
      }
      parts.railEntries.forEach((entry, position) => {
        const item = items[position];
        updateRailEntry(entry, current, item, position, isReview);
        entry.keys = showKeys(
          entry.pick,
          entry.keys,
          isForms ? entry.readKeys() : null,
        );
        const action = railPickAction(
          viewName,
          position,
          reviewRowAt[position],
        );
        entry.pick.disabled = action === null;
      });
      parts.itemsPane.hidden = !isForms;
      parts.itemCards.forEach((card, position) => {
        const isShown = isForms && position === current.focus;
        card.element.hidden = !isShown;
        if (isShown) {
          card.update(current);
        }
      });
      parts.review.element.hidden = !isReview;
      if (isReview) {
        parts.review.update(current);
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
      root.replaceChildren();
      parts = build(current, nextLayout, nextName);
      shownFocus = -1;
      view.update(current, shownView);
    },
    dispose() {
      keysChange.dispose();
    },
  };
  const keysChange = deps.keys.onChanged(() => {
    parts.redrawLayoutHead();
    if (shownRound !== null && !root.hidden) {
      view.update(shownRound, shownView);
    }
  });
  return view;
}

// Builds the rail and the round's main column into `root`: the review's
// head, the layout's head, the items pane of cards, and the review.
// `shownView` reads the view last shown, which decides what a rail click does.
function buildRoundParts(
  root: HTMLElement,
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
  const main = element('div', 'round-main');
  root.append(rail, main);

  const head = buildHead(main, round, deps.markdown);
  const keysFor = (command: CommandId) =>
    deps.keys.keysFor(command, formsScope('forms'));
  const headDeps = { markdown: deps.markdown, keysFor, log: deps.log };
  const layoutHead = buildLayoutHead(main, round, layout, layoutName, headDeps);
  const itemsPane = element('div', 'items');
  main.append(itemsPane);
  const reviewRowAt = reviewRowsByRailPosition(round);
  const railEntries = items.map((item, position) =>
    buildRailEntry(railList, round, item, deps.keys, () => {
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
    reviewRowAt,
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

type HeadDeps = Pick<CardDeps, 'markdown' | 'keysFor' | 'log'>;

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

// What clicking a rail item does: focus it in the forms view, jump to its
// row's item in the review, as Enter on the row does; null where the rail is
// inert, at a notice in the review and under the confirm overlay.
function railPickAction(
  view: FormsView,
  position: number,
  reviewRow: number | undefined,
): FormsAction | null {
  if (view === 'forms') {
    return { type: 'focusItem', item: position };
  }
  const isReviewItem = view === 'review' && reviewRow !== undefined;
  return isReviewItem ? { type: 'reviewJump', row: reviewRow } : null;
}

// `keys` is the hint shown of the keys that jump to the entry's item from the
// form, absent when none do or outside the form; `readKeys` reads those keys
// from the keymap as it is now.
interface RailEntry {
  element: HTMLLIElement;
  pick: HTMLButtonElement;
  keys: HTMLElement | null;
  readKeys(): string | null;
}

// A question's entry shows the keys that jump to it, as clicking it does in
// the form.
function buildRailEntry(
  parent: HTMLElement,
  round: RoundState,
  item: RailItem,
  keys: RoundViewDeps['keys'],
  onClick: () => void,
): RailEntry {
  const entry = element('li', 'rail-entry');
  const title = FORMATS[item.kind].title(round.round, item.index);
  const pick = button('rail-item', '', onClick);
  pick.title = title;
  pick.append(
    element('span', 'rail-dot'),
    element('span', 'rail-number', itemLabel(item)),
    element('span', 'rail-title', title),
  );
  const command =
    item.kind === 'question' ? numberedCommand('jumpTo', item.index) : null;
  const readKeys = () =>
    command === null ? null : keys.keysFor(command, formsScope('forms'));
  const hint = appendKeys(pick, readKeys());
  entry.append(pick);
  parent.append(entry);
  return { element: entry, pick, keys: hint, readKeys };
}

// While the review is open, untouched items are flagged in the rail.
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
  entry.element.dataset.status = status;
  entry.element.classList.toggle('is-focused', position === round.focus);
  entry.element.classList.toggle(
    'is-flagged',
    isReview && status === 'untouched',
  );
}

// The review's rows, then the round note, then Submit and Cancel with the
// review's keys for them; the note shows only while the review or the cancel
// prompt does.
function buildReview(
  parent: HTMLElement,
  round: RoundState,
  deps: RoundViewDeps,
): { element: HTMLElement; update(round: RoundState): void } {
  const section = element('section', 'review');
  const summary = element('p', 'review-summary');
  const list = element('ol', 'review-rows');
  section.append(element('h2', 'review-title', 'Review'), summary, list);
  parent.append(section);
  const note = buildField(
    section,
    'field-note',
    'Round note',
    'anything about the round as a whole - optional',
  );
  deps.boxes.mount(
    note.box,
    { roundId: round.roundId, target: { field: 'note' } },
    round.note,
  );
  const actions = element('div', 'review-actions');
  const submit = button('button button-primary', 'Submit', () =>
    deps.run(formsCommand('submit')),
  );
  let submitKeys = appendKeys(submit, reviewKeysFor(deps, 'submit'));
  const cancel = button('button', 'Cancel round', () =>
    deps.run(formsCommand('askCancel')),
  );
  let cancelKeys = appendKeys(cancel, reviewKeysFor(deps, 'askCancel'));
  actions.append(submit, cancel);
  section.append(actions);
  return {
    element: section,
    update(current) {
      const counts = progress(current);
      const untouched =
        counts.untouched > 0
          ? ` ${counts.untouched} not answered; they are sent as untouched.`
          : '';
      summary.textContent = `${progressText(counts)}.${untouched}`;
      submitKeys = showKeys(submit, submitKeys, reviewKeysFor(deps, 'submit'));
      cancelKeys = showKeys(
        cancel,
        cancelKeys,
        reviewKeysFor(deps, 'askCancel'),
      );
      list.replaceChildren(
        ...reviewRows(current).map((row) => buildReviewRow(row, deps)),
      );
      list.querySelector('.is-cursor')?.scrollIntoView({ block: 'nearest' });
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
  solution: 'needs a solution',
  action: 'needs an action',
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
    answer.append(element('span', 'badge badge-recommend', 'Recommended'));
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
  if (row.isCursor) {
    appendKeys(pick, reviewKeysFor(deps, 'reviewJump'));
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
