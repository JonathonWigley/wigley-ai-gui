import type { CommandArg, CommandId } from '../../../../contracts/commands';
import type { MarkdownRenderer } from '../../../../contracts/markdown';
import { button, element } from '../../../../shared/page/dom';
import type { MarkdownMount } from '../../../../shared/page/markdown-mount';
import { boxHint } from '../../../../shared/page/ui/key-anchors';
import { sectionHeader } from '../../../../shared/page/ui/section-header';
import { tag } from '../../../../shared/page/ui/tag';
import type { AnswerStatus, Round } from '../../contract';
import { formsCommand } from '../../ids';
import { NUMBER_KEY_COUNT } from '../../manifest';
import type { RoundInfo } from '../../layouts/layout';
import type { CardDeps } from './item-format';

export interface Field {
  element: HTMLElement;
  box: HTMLElement;
}

// Names the anchor for `command` on `element`, in the scope of the part
// drawing.
export type PartAnchor = (
  element: HTMLElement,
  command: CommandId,
  options?: { arg?: CommandArg },
) => void;

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

// The reason under a choice: why one would pick it, or why it is recommended,
// its text drawn through `deps.mount`. A null `label` draws no label element,
// only the body.
export function buildChoiceReason(
  label: string | null,
  text: string,
  deps: { markdown: MarkdownRenderer; mount: MarkdownMount },
): HTMLElement {
  const reason = element('div', 'choice-reason');
  const body = element('div', 'choice-reason-body md');
  if (label !== null) {
    reason.append(element('div', 'choice-reason-label', label));
  }
  reason.append(body);
  deps.mount.draw(body, deps.markdown.block(text));
  return reason;
}

// A text box's field, appended to `parent`: its label, the anchor `labelKeys`
// names when given, and its hint, then the box's input frame, which
// `placeFrame` appends to the field once the field is attached and returns.
// The field is new on each draw; the frame is the box's own, moved in.
export function buildField(
  parent: HTMLElement,
  className: string,
  label: string,
  hint: string,
  labelKeys: { command: CommandId; anchor: PartAnchor } | null,
  placeFrame: (field: HTMLElement) => HTMLElement,
): Field {
  const field = element('div', `field ${className}`);
  const caption = sectionHeader(label);
  if (labelKeys !== null) {
    const keys = element('span', 'field-keys');
    caption.append(keys);
    labelKeys.anchor(keys, labelKeys.command);
  }
  caption.append(element('span', 'field-hint', hint));
  field.append(caption);
  parent.append(field);
  const box = placeFrame(field);
  box.classList.add('box');
  return { element: field, box };
}

// Appends the box hint `span.box-keys` after the field's input frame, holding
// the keys that move to the previous and the next box.
export function appendBoxKeys(field: Field, anchor: PartAnchor) {
  const previous = element('span');
  const next = element('span');
  field.element.append(boxHint('box-keys', [previous, next]));
  anchor(previous, formsCommand('prevBox'));
  anchor(next, formsCommand('nextBox'));
}

// The choice list's entries in the order of the choices drawn.
export interface ChoiceList {
  entries: HTMLLIElement[];
}

// Appends one choice per entry of `choices` to `list`, each inline markdown
// drawn through `deps.mount` under its shown `number`, with the anchor for
// the command that picks that number; the choice numbered `recommended` is
// tagged, none when null. `pick` gets the clicked choice's number.
export function buildChoiceList(
  list: HTMLElement,
  choices: { text: string; number: number }[],
  recommended: number | null,
  pick: (number: number) => void,
  deps: Pick<CardDeps, 'markdown'> & {
    mount: MarkdownMount;
    anchor: PartAnchor;
  },
): ChoiceList {
  const entries = choices.map(({ text, number }) => {
    const entry = element('li', 'choice');
    const choicePick = button('choice-pick', '', () => pick(number));
    const choiceText = element('span', 'choice-text');
    choicePick.append(
      element('span', 'choice-number', String(number)),
      choiceText,
    );
    deps.mount.draw(choiceText, deps.markdown.inline(text));
    entry.append(choicePick);
    if (number === recommended) {
      entry.classList.add('is-recommended');
      choicePick.append(tag('Recommended', 'accent'));
    }
    appendPickKeys(choicePick, number, deps.anchor);
    list.append(entry);
    return entry;
  });
  return { entries };
}

// Appends `span.choice-keys` to `pick`, the anchor for the bind picking entry
// `number`; nothing past the last number key.
export function appendPickKeys(
  pick: HTMLElement,
  number: number,
  anchor: PartAnchor,
) {
  if (number <= NUMBER_KEY_COUNT) {
    const keys = element('span', 'choice-keys');
    pick.append(keys);
    anchor(keys, formsCommand('choose'), { arg: number });
  }
}
