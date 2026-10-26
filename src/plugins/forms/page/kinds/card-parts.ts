import type { CommandId } from '../../../../contracts/commands';
import type { MarkdownRenderer } from '../../../../contracts/markdown';
import { button, element, markdownElement } from '../../../../shared/page/dom';
import { appendKeyHint } from '../../../../shared/page/key-hint';
import { inputFrame } from '../../../../shared/page/ui/input-frame';
import { sectionHeader } from '../../../../shared/page/ui/section-header';
import { tag } from '../../../../shared/page/ui/tag';
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

// The header naming the item's kind as a tag, with the status slot after it.
export function buildItemHead(
  parent: HTMLElement,
  kind: string,
): { header: HTMLElement; status: HTMLElement } {
  const header = element('header', 'item-head');
  const status = element('span', 'item-status');
  header.append(tag(kind), status);
  parent.append(header);
  return { header, status };
}

// A block of markdown under its section header; nothing and null for blank
// text.
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
    sectionHeader(label),
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

// A text box's field: its label and hint over the input frame `box`, which
// the editor mounts into.
export function buildField(
  parent: HTMLElement,
  className: string,
  label: string,
  hint: string,
): Field {
  const field = element('div', `field ${className}`);
  const caption = sectionHeader(label, element('span', 'field-hint', hint));
  const box = inputFrame();
  box.classList.add('box');
  field.append(caption, box);
  parent.append(field);
  return { element: field, box };
}

// The choice list's entries in the order of the choices drawn, and
// `updateKeys`, which shows each choice's keys again as the keymap now binds
// them.
export interface ChoiceList {
  entries: HTMLLIElement[];
  updateKeys(): void;
}

// Appends one choice per entry of `choices` to `list`, each inline markdown
// under its shown `number`, with the keys that pick that number; the choice
// numbered `recommended` is tagged, none when null. `pick` gets the clicked
// choice's number. `deps.keysFor` reads the keys in the card's scope.
export function buildChoiceList(
  list: HTMLElement,
  choices: { text: string; number: number }[],
  recommended: number | null,
  pick: (number: number) => void,
  deps: Pick<CardDeps, 'markdown' | 'platform'> & {
    keysFor(command: CommandId): string | null;
  },
): ChoiceList {
  const keyUpdaters: (() => void)[] = [];
  const entries = choices.map(({ text, number }) => {
    const entry = element('li', 'choice');
    const choicePick = button('choice-pick', '', () => pick(number));
    choicePick.append(
      element('span', 'choice-number', String(number)),
      markdownElement('span', 'choice-text', deps.markdown.inline(text)),
    );
    entry.append(choicePick);
    if (number === recommended) {
      entry.classList.add('is-recommended');
      choicePick.append(tag('Recommended', 'accent'));
    }
    const command = numberedCommand('choose', number);
    const readKeys = () => (command === null ? null : deps.keysFor(command));
    keyUpdaters.push(appendKeyHint(choicePick, readKeys, deps.platform));
    list.append(entry);
    return entry;
  });
  return {
    entries,
    updateKeys() {
      for (const update of keyUpdaters) {
        update();
      }
    },
  };
}
