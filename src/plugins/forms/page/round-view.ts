import type { CommandId } from '../../../contracts/commands';
import type { MarkdownRenderer } from '../../../contracts/markdown';
import { formsCommand } from '../ids';
import { button, element, markdownElement } from '../../../shared/page/dom';
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
import { buildField, statusLabel } from './kinds/card-parts';
import { FORMATS, itemLabel } from './kinds/formats';
import type { CardDeps } from './kinds/item-format';
import { progressText, type ReviewRow, reviewRows } from './view-model';

export interface RoundViewDeps {
  markdown: MarkdownRenderer;
  boxes: Pick<EditorBoxes, 'mount'>;
  dispatch(action: FormsAction): void;
  run(command: CommandId): void;
}

export interface RoundView {
  element: HTMLElement;
  // `view` is the view under any help overlay.
  update(round: RoundState, view: FormsView, isHelpOpen: boolean): void;
}

// One open round's DOM, built once with its editors: the rail, every item's
// card, and the review with the round note. A render only updates it. `attach`
// places the root in the page once, before any editor mounts.
export function createRoundView(
  attach: (root: HTMLElement) => void,
  round: RoundState,
  deps: RoundViewDeps,
): RoundView {
  const items = railItems(round.round);
  const root = element('section', 'round');
  const rail = element('nav', 'rail');
  rail.setAttribute('aria-label', 'Items');
  const railList = element('ol', 'rail-list');
  rail.append(railList);
  const main = element('div', 'round-main');
  root.append(rail, main);
  // Editors mount into attached elements, so they can measure themselves.
  attach(root);

  const head = buildHead(main, round, deps.markdown);
  const itemsPane = element('div', 'items');
  main.append(itemsPane);
  let shownView: FormsView = 'forms';
  let isHelpShown = false;
  const reviewRowAt = reviewRowsByRailPosition(round);
  const railEntries = items.map((item, position) =>
    buildRailEntry(railList, round, item, () => {
      const action = railPickAction(
        shownView,
        isHelpShown,
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
    dispatch: deps.dispatch,
    toggleDontAsk: () => deps.run(formsCommand('toggleDontAsk')),
  };
  const itemCards = items.map((item, position) =>
    FORMATS[item.kind].buildCard(
      itemsPane,
      round,
      item.index,
      position,
      cardDeps,
    ),
  );
  const review = buildReview(main, round, deps);

  let shownFocus = -1;
  return {
    element: root,
    update(current, view, isHelpOpen) {
      shownView = view;
      isHelpShown = isHelpOpen;
      const isForms = view === 'forms';
      const isReview = view === 'review' || view === 'confirm';
      head.element.hidden = !isReview;
      head.update(current);
      railEntries.forEach((entry, position) => {
        const item = items[position];
        updateRailEntry(entry, current, item, position, isReview);
        const action = railPickAction(
          view,
          isHelpOpen,
          position,
          reviewRowAt[position],
        );
        entry.pick.disabled = action === null;
      });
      itemsPane.hidden = !isForms;
      itemCards.forEach((card, position) => {
        const isShown = isForms && position === current.focus;
        card.element.hidden = !isShown;
        if (isShown) {
          card.update(current);
        }
      });
      review.element.hidden = !isReview;
      if (isReview) {
        review.update(current);
      }
      if (current.focus !== shownFocus) {
        shownFocus = current.focus;
        main.scrollTop = 0;
        railEntries[current.focus]?.element.scrollIntoView({
          block: 'nearest',
        });
      }
    },
  };
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
// inert, at a notice in the review and under the confirm and help overlays.
function railPickAction(
  view: FormsView,
  isHelpOpen: boolean,
  position: number,
  reviewRow: number | undefined,
): FormsAction | null {
  if (isHelpOpen) {
    return null;
  }
  if (view === 'forms') {
    return { type: 'focusItem', item: position };
  }
  const isReviewItem = view === 'review' && reviewRow !== undefined;
  return isReviewItem ? { type: 'reviewJump', row: reviewRow } : null;
}

interface RailEntry {
  element: HTMLLIElement;
  pick: HTMLButtonElement;
}

function buildRailEntry(
  parent: HTMLElement,
  round: RoundState,
  item: RailItem,
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
  entry.append(pick);
  parent.append(entry);
  return { element: entry, pick };
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

// The review's rows, then the round note, then Submit and Cancel; the note
// shows only while the review or the cancel prompt does.
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
  actions.append(
    button('button button-primary', 'Submit', () =>
      deps.run(formsCommand('submit')),
    ),
    button('button', 'Cancel round', () => deps.run(formsCommand('askCancel'))),
  );
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
      list.replaceChildren(
        ...reviewRows(current).map((row) => buildReviewRow(row, deps)),
      );
      list.querySelector('.is-cursor')?.scrollIntoView({ block: 'nearest' });
    },
  };
}

const MISSING_HINTS: Record<NonNullable<ReviewRow['missing']>, string> = {
  solution: 'needs a solution',
  action: 'needs an action',
};

// A finding with a complete pick reads as its action, then its solution; one
// missing half its pick names the missing half in place of its status.
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
