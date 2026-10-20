import type { MarkdownRenderer } from '../../../../contracts/markdown';
import {
  appendKeys,
  button,
  element,
  markdownElement,
} from '../../../../shared/page/dom';
import type { AnswerStatus, Round } from '../../contract';
import { numberedCommand } from '../../ids';
import type { RoundInfo } from '../../layouts/layout';
import type { CardDeps } from './item-format';

export interface Field {
  element: HTMLElement;
  box: HTMLElement;
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

// The round's heading and overview, as every card input carries them.
export function roundInfo(round: Round): RoundInfo {
  return { heading: round.heading, overview: round.overview };
}

// The header naming the item's kind, with the status slot after the label.
export function buildItemHead(
  parent: HTMLElement,
  kind: string,
): { header: HTMLElement; status: HTMLElement } {
  const header = element('header', 'item-head');
  const status = element('span', 'item-status');
  header.append(element('span', 'item-kind', kind), status);
  parent.append(header);
  return { header, status };
}

// A labelled block of markdown; nothing and null for blank text.
export function buildSection(
  parent: HTMLElement,
  label: string,
  text: string,
  markdown: MarkdownRenderer,
): HTMLElement | null {
  if (text.trim() === '') {
    return null;
  }
  const section = element('section', 'context');
  section.append(
    element('div', 'context-label', label),
    markdownElement('div', 'context-body md', markdown.block(text)),
  );
  parent.append(section);
  return section;
}

// The labelled reason under a choice: why one would pick it, or why it is
// recommended.
export function buildChoiceReason(
  label: string,
  text: string,
  markdown: MarkdownRenderer,
): HTMLElement {
  const reason = element('div', 'choice-reason');
  reason.append(
    element('div', 'choice-reason-label', label),
    markdownElement('div', 'choice-reason-body md', markdown.block(text)),
  );
  return reason;
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

// Appends one choice per text to `list`, each inline markdown with the keys
// that pick it, the recommended one badged; `pick` gets the clicked choice,
// 1-based.
export function buildChoiceList(
  list: HTMLElement,
  texts: string[],
  recommend: number,
  pick: (choice: number) => void,
  deps: Pick<CardDeps, 'markdown' | 'keysFor'>,
): HTMLLIElement[] {
  return texts.map((text, i) => {
    const choice = i + 1;
    const entry = element('li', 'choice');
    const choicePick = button('choice-pick', '', () => pick(choice));
    choicePick.append(
      element('span', 'choice-number', String(choice)),
      markdownElement('span', 'choice-text', deps.markdown.inline(text)),
    );
    entry.append(choicePick);
    if (choice === recommend) {
      entry.classList.add('is-recommended');
      choicePick.append(
        element('span', 'badge badge-recommend', 'Recommended'),
      );
    }
    const command = numberedCommand('choose', choice);
    appendKeys(choicePick, command === null ? null : deps.keysFor(command));
    list.append(entry);
    return entry;
  });
}
