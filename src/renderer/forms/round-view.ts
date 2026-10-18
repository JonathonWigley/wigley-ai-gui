import type { CommandId } from '../../contracts/commands';
import type { MarkdownRenderer } from '../../contracts/markdown';
import { button, element, markdownElement } from './dom';
import type { EditorBoxes } from './editor-boxes';
import {
  type FormsAction,
  type FormsView,
  progress,
  questionStatus,
  type RailItem,
  railItems,
  type RoundState,
} from './form-state';
import {
  progressText,
  type ReviewRow,
  reviewRows,
  statusLabel,
} from './view-model';

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

interface ItemView {
  element: HTMLElement;
  update(round: RoundState): void;
}

interface Field {
  element: HTMLElement;
  box: HTMLElement;
}

// One open round's DOM, built once with its editors: the rail, every item's
// pane, the review and the round note. A render only updates it.
export function createRoundView(
  parent: HTMLElement,
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
  parent.append(root);

  const head = buildHead(main, round, deps.markdown);
  const itemsPane = element('div', 'items');
  main.append(itemsPane);
  let shownView: FormsView = 'forms';
  let isHelpShown = false;
  const railEntries = items.map((item, position) =>
    buildRailEntry(railList, round, item, () => {
      const action = railPickAction(shownView, isHelpShown, item, position);
      if (action !== null) {
        deps.dispatch(action);
      }
    }),
  );
  const itemViews = items.map((item, position) =>
    item.kind === 'notice'
      ? buildNotice(itemsPane, round, item.index, position, deps)
      : buildQuestion(itemsPane, round, item.index, position, deps),
  );
  const review = buildReview(main, deps);
  const note = buildField(
    main,
    'field-note',
    'Round note',
    'anything about the round as a whole - optional',
  );
  deps.boxes.mount(
    note.box,
    { roundId: round.roundId, target: { field: 'note' } },
    round.note,
  );

  let shownFocus = -1;
  return {
    element: root,
    update(current, view, isHelpOpen) {
      shownView = view;
      isHelpShown = isHelpOpen;
      const isForms = view === 'forms';
      const isReview = view === 'review' || view === 'confirm';
      head.update(current);
      railEntries.forEach((entry, position) => {
        const item = items[position];
        updateRailEntry(entry, current, item, position, isReview);
        const action = railPickAction(view, isHelpOpen, item, position);
        entry.pick.disabled = action === null;
      });
      itemsPane.hidden = !isForms;
      itemViews.forEach((itemView, position) => {
        const isShown = isForms && position === current.focus;
        itemView.element.hidden = !isShown;
        if (isShown) {
          itemView.update(current);
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
): { update(round: RoundState): void } {
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
    update(current) {
      progressLine.textContent = progressText(progress(current));
    },
  };
}

function itemTitle(round: RoundState, item: RailItem): string {
  return item.kind === 'notice'
    ? round.round.notices[item.index - 1].title
    : round.round.questions[item.index - 1].title;
}

function railNumber(item: RailItem): string {
  return item.kind === 'notice' ? `N${item.index}` : String(item.index);
}

// What clicking a rail item does: focus it in the forms view, jump to its
// question in the review, as Enter on its row does; null where the rail is
// inert, under the confirm and help overlays.
function railPickAction(
  view: FormsView,
  isHelpOpen: boolean,
  item: RailItem,
  position: number,
): FormsAction | null {
  if (isHelpOpen) {
    return null;
  }
  if (view === 'forms') {
    return { type: 'focusItem', item: position };
  }
  const isReviewQuestion = view === 'review' && item.kind === 'question';
  return isReviewQuestion ? { type: 'reviewJump', row: item.index - 1 } : null;
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
  const title = itemTitle(round, item);
  const pick = button('rail-item', '', onClick);
  pick.title = title;
  pick.append(
    element('span', 'rail-dot'),
    element('span', 'rail-number', railNumber(item)),
    element('span', 'rail-title', title),
  );
  entry.append(pick);
  parent.append(entry);
  return { element: entry, pick };
}

// While the review is open, untouched questions are flagged in the rail.
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
      : questionStatus(round.answers[item.index - 1]);
  entry.element.dataset.status = status;
  entry.element.classList.toggle('is-focused', position === round.focus);
  entry.element.classList.toggle(
    'is-flagged',
    isReview && status === 'untouched',
  );
}

function buildField(
  parent: HTMLElement,
  className: string,
  label: string,
  hint: string,
): Field {
  const field = element('div', `field ${className}`);
  const caption = element('div', 'field-label');
  caption.append(
    element('span', 'label', label),
    element('span', 'hint', hint),
  );
  const box = element('div', 'box');
  field.append(caption, box);
  parent.append(field);
  return { element: field, box };
}

// The item's context with its fold control; null when it has no context.
function buildContext(
  parent: HTMLElement,
  text: string,
  markdown: MarkdownRenderer,
  onToggle: () => void,
): { update(folded: boolean): void } | null {
  if (text.trim() === '') {
    return null;
  }
  const section = element('section', 'context');
  const toggle = button('fold-toggle', 'Context', onToggle);
  const body = markdownElement('div', 'context-body md', markdown.block(text));
  section.append(toggle, body);
  parent.append(section);
  return {
    update(folded) {
      body.hidden = folded;
      toggle.setAttribute('aria-expanded', String(!folded));
      section.classList.toggle('is-folded', folded);
    },
  };
}

function buildItemHead(
  parent: HTMLElement,
  number: string,
  title: string,
): HTMLElement {
  const head = element('header', 'item-head');
  const status = element('span', 'item-status');
  head.append(
    element('span', 'item-number', number),
    element('h2', 'item-title', title),
    status,
  );
  parent.append(head);
  return status;
}

function buildQuestion(
  parent: HTMLElement,
  round: RoundState,
  index: number,
  position: number,
  deps: RoundViewDeps,
): ItemView {
  const question = round.round.questions[index - 1];
  const answer = round.answers[index - 1];
  const { roundId } = round;
  const focusThis = () => deps.dispatch({ type: 'focusItem', item: position });

  const article = element('article', 'item question');
  parent.append(article);
  const statusChip = buildItemHead(article, String(index), question.title);
  const context = buildContext(article, question.context, deps.markdown, () => {
    focusThis();
    deps.dispatch({ type: 'toggleFold' });
  });
  article.append(
    markdownElement('div', 'ask md', deps.markdown.block(question.question)),
  );
  const choiceList = element('ol', 'choices');
  article.append(choiceList);
  const choiceEntries = question.choices.map((text, i) => {
    const choice = i + 1;
    const entry = element('li', 'choice');
    const pick = button('choice-pick', '', () => {
      focusThis();
      deps.dispatch({ type: 'choose', choice });
    });
    pick.append(
      element('span', 'choice-number', String(choice)),
      markdownElement('span', 'choice-text', deps.markdown.inline(text)),
    );
    entry.append(pick);
    if (choice === question.recommend) {
      entry.classList.add('is-recommended');
      pick.append(element('span', 'badge badge-recommend', 'Recommended'));
      if (question.rationale.trim() !== '') {
        const rationale = element('details', 'rationale');
        rationale.append(
          element('summary', '', 'Why recommended'),
          markdownElement('div', 'md', deps.markdown.block(question.rationale)),
        );
        entry.append(rationale);
      }
    }
    choiceList.append(entry);
    return entry;
  });

  const what = buildField(
    article,
    'field-what',
    'Your own answer',
    'if none of the choices fit - optional',
  );
  const why = buildField(
    article,
    'field-why',
    'Why',
    'optional, carried into the plan',
  );
  const toggles = element('div', 'toggles');
  const notApplicable = button('toggle', 'Not applicable', () => {
    focusThis();
    deps.dispatch({ type: 'toggleNotApplicable' });
  });
  const dontAsk = button('toggle', "Don't ask me this", () => {
    focusThis();
    deps.run('forms.toggleDontAsk');
  });
  toggles.append(notApplicable, dontAsk);
  article.append(toggles);
  const reason = buildField(
    article,
    'field-reason',
    'Why not ask this',
    'sent to the agent with your answer - optional',
  );
  deps.boxes.mount(
    what.box,
    { roundId, target: { field: 'what', question: index } },
    answer.what,
  );
  deps.boxes.mount(
    why.box,
    { roundId, target: { field: 'why', question: index } },
    answer.why,
  );
  deps.boxes.mount(
    reason.box,
    { roundId, target: { field: 'dontAskReason', question: index } },
    answer.dontAskReason,
  );

  return {
    element: article,
    update(current) {
      const now = current.answers[index - 1];
      const status = questionStatus(now);
      article.dataset.status = status;
      statusChip.textContent =
        status === 'untouched' ? '' : statusLabel(status);
      context?.update(current.folded[position]);
      choiceEntries.forEach((entry, i) =>
        entry.classList.toggle('is-selected', now.choice === i + 1),
      );
      choiceList.classList.toggle('is-locked', now.notApplicable);
      notApplicable.setAttribute('aria-pressed', String(now.notApplicable));
      dontAsk.setAttribute('aria-pressed', String(now.dontAsk));
      reason.element.hidden = !now.dontAsk;
    },
  };
}

function buildNotice(
  parent: HTMLElement,
  round: RoundState,
  index: number,
  position: number,
  deps: RoundViewDeps,
): ItemView {
  const notice = round.round.notices[index - 1];
  const article = element('article', 'item notice');
  parent.append(article);
  const badge = buildItemHead(article, `N${index}`, notice.title);
  badge.className = 'badge badge-notice';
  badge.dataset.badge = notice.badge;
  badge.textContent = notice.badge;
  const context = buildContext(article, notice.context, deps.markdown, () => {
    deps.dispatch({ type: 'focusItem', item: position });
    deps.dispatch({ type: 'toggleFold' });
  });
  const comment = buildField(
    article,
    'field-comment',
    'Comment',
    'optional - say if this needs a second look',
  );
  deps.boxes.mount(
    comment.box,
    { roundId: round.roundId, target: { field: 'comment', notice: index } },
    round.noticeComments[index - 1],
  );
  return {
    element: article,
    update(current) {
      context?.update(current.folded[position]);
    },
  };
}

function buildReview(
  parent: HTMLElement,
  deps: RoundViewDeps,
): { element: HTMLElement; update(round: RoundState): void } {
  const section = element('section', 'review');
  const summary = element('p', 'review-summary');
  const list = element('ol', 'review-rows');
  const actions = element('div', 'review-actions');
  actions.append(
    button('button button-primary', 'Submit', () => deps.run('forms.submit')),
    button('button', 'Cancel round', () => deps.run('forms.askCancel')),
  );
  section.append(
    element('h2', 'review-title', 'Review'),
    summary,
    list,
    actions,
  );
  parent.append(section);
  return {
    element: section,
    update(round) {
      const counts = progress(round);
      const untouched =
        counts.untouched > 0
          ? ` ${counts.untouched} not answered; they are sent as untouched.`
          : '';
      summary.textContent = `${progressText(counts)}.${untouched}`;
      list.replaceChildren(
        ...reviewRows(round).map((row) => buildReviewRow(row, deps)),
      );
      list.querySelector('.is-cursor')?.scrollIntoView({ block: 'nearest' });
    },
  };
}

function buildReviewRow(row: ReviewRow, deps: RoundViewDeps): HTMLLIElement {
  const entry = element('li', 'review-row');
  entry.dataset.status = row.status;
  entry.classList.toggle('is-cursor', row.isCursor);
  const pick = button('review-pick', '', () =>
    deps.dispatch({ type: 'reviewJump', row: row.row }),
  );
  const answer = element('span', 'review-answer');
  if (row.choice > 0) {
    answer.append(
      element('span', 'choice-number', String(row.choice)),
      markdownElement(
        'span',
        'choice-text',
        deps.markdown.inline(row.choiceText),
      ),
    );
    if (row.tookRecommendation) {
      answer.append(element('span', 'badge badge-recommend', 'Recommended'));
    }
  } else {
    answer.textContent = statusLabel(row.status);
  }
  pick.append(
    element('span', 'review-number', String(row.number)),
    element('span', 'review-question', row.title),
    answer,
  );
  entry.append(pick);
  const details: [string, string][] = [
    ['Your own answer', row.what],
    ['Why', row.why],
  ];
  for (const [label, text] of details) {
    if (text.trim() !== '') {
      entry.append(element('p', 'review-detail', `${label}: ${text}`));
    }
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
