import type { AnswerEntry, ItemAnswer, KindBox } from '../../contract';
import { formsCommand } from '../../ids';

// What the question and finding kinds share: an `ItemAnswer`, its saved
// entry, its two text boxes.

export const UNTOUCHED_ANSWER: ItemAnswer = {
  choice: 0,
  notApplicable: false,
  notes: '',
  dontAsk: false,
  dontAskReason: '',
};

// The notes and Don't ask reason boxes, captions verbatim.
const ANSWER_FIELDS: readonly KindBox[] = [
  {
    field: 'notes',
    className: 'field-notes',
    label: 'Notes',
    hint: 'Optional. Your own answer or your reasoning, sent to the agent.',
    keys: formsCommand('editNotes'),
  },
  {
    field: 'dontAskReason',
    className: 'field-reason',
    label: 'Why not ask this',
    hint: 'Optional. Sent to the agent with your answer.',
    keys: null,
  },
];

// The notes box always; the reason box while Don't ask is on.
export const ANSWER_BOXES = {
  fields: ANSWER_FIELDS,
  shown: (answer: ItemAnswer): readonly string[] =>
    answer.dontAsk ? ['notes', 'dontAskReason'] : ['notes'],
};

type AnswerTextField = 'notes' | 'dontAskReason';

function requireAnswerTextField(field: string): AnswerTextField {
  if (field !== 'notes' && field !== 'dontAskReason') {
    throw new Error(`an answer has no ${field} box`);
  }
  return field;
}

export function answerText(answer: ItemAnswer, field: string): string {
  return answer[requireAnswerTextField(field)];
}

// `answer` itself when the text is unchanged.
export function withAnswerText<Answer extends ItemAnswer>(
  answer: Answer,
  field: string,
  value: string,
): Answer {
  const textField = requireAnswerTextField(field);
  return answer[textField] === value
    ? answer
    : { ...answer, [textField]: value };
}

// The entry of main's normalised `entries` whose 1-based `index` is `index`.
export function entryAt<Entry extends { index: number }>(
  entries: readonly unknown[],
  index: number,
): Entry | undefined {
  return (entries as readonly Entry[]).find((entry) => entry.index === index);
}

export function restoreAnswer(
  entry: AnswerEntry | undefined,
  choiceCount: number,
): ItemAnswer {
  if (entry === undefined) {
    return UNTOUCHED_ANSWER;
  }
  const isChoiceInRange = entry.choice >= 1 && entry.choice <= choiceCount;
  return {
    choice: isChoiceInRange ? entry.choice : 0,
    notApplicable: entry.not_applicable,
    notes: entry.notes,
    dontAsk: entry.dont_ask,
    dontAskReason: entry.dont_ask_reason,
  };
}

// `i` is the answer's 0-based position.
export function answerEntry(answer: ItemAnswer, i: number): AnswerEntry {
  return {
    index: i + 1,
    choice: answer.choice,
    not_applicable: answer.notApplicable,
    notes: answer.notes,
    dont_ask: answer.dontAsk,
    dont_ask_reason: answer.dontAskReason,
  };
}
