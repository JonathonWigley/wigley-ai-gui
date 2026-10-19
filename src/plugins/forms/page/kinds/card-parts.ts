import type { MarkdownRenderer } from '../../../../contracts/markdown';
import { button, element, markdownElement } from '../../../../shared/page/dom';
import type { AnswerStatus } from '../../contract';
import {
  type AnswerableItem,
  answerStatus,
  type ItemAnswer,
  itemAnswer,
  type RoundState,
} from '../form-state';
import type { AnswerableFormat, CardDeps, ItemCard } from './item-format';

export interface Field {
  element: HTMLElement;
  box: HTMLElement;
}

// The parts of an answerable card its answer changes.
interface AnswerParts {
  card: HTMLElement;
  statusChip: HTMLElement;
  choiceList: HTMLElement;
  choices: HTMLLIElement[];
}

const STATUS_LABELS: Record<AnswerStatus, string> = {
  answered: 'Answered',
  not_applicable: 'Not applicable',
  untouched: 'Not answered',
};

export function statusLabel(status: AnswerStatus): string {
  return STATUS_LABELS[status];
}

// An item's number: its kind's rail prefix and its 1-based index.
export function labelFor(railPrefix: string, index: number): string {
  return `${railPrefix}${index}`;
}

// The item's label and title; returns the status slot after the title.
export function buildItemHead(
  parent: HTMLElement,
  label: string,
  title: string,
): HTMLElement {
  const head = element('header', 'item-head');
  const status = element('span', 'item-status');
  head.append(
    element('span', 'item-number', label),
    element('h2', 'item-title', title),
    status,
  );
  parent.append(head);
  return status;
}

// A labelled block of markdown; nothing for blank text.
export function buildSection(
  parent: HTMLElement,
  label: string,
  text: string,
  markdown: MarkdownRenderer,
) {
  if (text.trim() === '') {
    return;
  }
  const section = element('section', 'context');
  section.append(
    element('div', 'context-label', label),
    markdownElement('div', 'context-body md', markdown.block(text)),
  );
  parent.append(section);
}

export function buildField(
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

// Appends one choice per text to `list`, each inline markdown, the
// recommended one badged; `pick` gets the clicked choice, 1-based.
function buildChoiceList(
  list: HTMLElement,
  texts: string[],
  recommend: number,
  pick: (choice: number) => void,
  markdown: MarkdownRenderer,
): HTMLLIElement[] {
  return texts.map((text, i) => {
    const choice = i + 1;
    const entry = element('li', 'choice');
    const choicePick = button('choice-pick', '', () => pick(choice));
    choicePick.append(
      element('span', 'choice-number', String(choice)),
      markdownElement('span', 'choice-text', markdown.inline(text)),
    );
    entry.append(choicePick);
    if (choice === recommend) {
      entry.classList.add('is-recommended');
      choicePick.append(
        element('span', 'badge badge-recommend', 'Recommended'),
      );
    }
    list.append(entry);
    return entry;
  });
}

// The Notes box, the Not applicable and Don't ask toggles and the reason box,
// for `item` at rail `position`; `update` shows an answer's toggles and hides
// the reason box while Don't ask is off.
function buildAnswerControls(
  parent: HTMLElement,
  round: RoundState,
  item: AnswerableItem,
  position: number,
  deps: CardDeps,
): { update(answer: ItemAnswer): void } {
  const answer = itemAnswer(round, item);
  const focusThis = () => deps.dispatch({ type: 'focusItem', item: position });
  const notes = buildField(
    parent,
    'field-notes',
    'Notes',
    'your own answer or your reasoning - optional, sent to the agent',
  );
  const toggles = element('div', 'toggles');
  const notApplicable = button('toggle', 'Not applicable', () => {
    focusThis();
    deps.dispatch({ type: 'toggleNotApplicable' });
  });
  const dontAsk = button('toggle', "Don't ask me this", () => {
    focusThis();
    deps.toggleDontAsk();
  });
  toggles.append(notApplicable, dontAsk);
  parent.append(toggles);
  const reason = buildField(
    parent,
    'field-reason',
    'Why not ask this',
    'sent to the agent with your answer - optional',
  );
  deps.mountBox(notes.box, { field: 'notes', item }, answer.notes);
  deps.mountBox(
    reason.box,
    { field: 'dontAskReason', item },
    answer.dontAskReason,
  );
  return {
    update(current) {
      notApplicable.setAttribute('aria-pressed', String(current.notApplicable));
      dontAsk.setAttribute('aria-pressed', String(current.dontAsk));
      reason.element.hidden = !current.dontAsk;
    },
  };
}

// Shows an answer's status on the card and its chip, its choice selected,
// and the choices locked while not applicable.
function showAnswer(parts: AnswerParts, answer: ItemAnswer) {
  const status = answerStatus(answer);
  parts.card.dataset.status = status;
  parts.statusChip.textContent =
    status === 'untouched' ? '' : statusLabel(status);
  parts.choices.forEach((entry, i) =>
    entry.classList.toggle('is-selected', answer.choice === i + 1),
  );
  parts.choiceList.classList.toggle('is-locked', answer.notApplicable);
}

// The choice list and answer controls under an answerable card's sections,
// and the card's update; `choices` takes a kind's extras.
export function buildAnswerableCard(
  article: HTMLElement,
  statusChip: HTMLElement,
  format: AnswerableFormat,
  round: RoundState,
  item: AnswerableItem,
  position: number,
  deps: CardDeps,
): { card: ItemCard; choices: HTMLLIElement[] } {
  const choiceList = element('ol', 'choices');
  article.append(choiceList);
  const choices = buildChoiceList(
    choiceList,
    format.choiceTexts(round.round, item.index),
    format.recommend(round.round, item.index),
    (choice) => {
      deps.dispatch({ type: 'focusItem', item: position });
      deps.dispatch({ type: 'choose', choice });
    },
    deps.markdown,
  );
  const controls = buildAnswerControls(article, round, item, position, deps);
  const parts = { card: article, statusChip, choiceList, choices };
  return {
    card: {
      element: article,
      update(current) {
        const answer = itemAnswer(current, item);
        showAnswer(parts, answer);
        controls.update(answer);
      },
    },
    choices,
  };
}
