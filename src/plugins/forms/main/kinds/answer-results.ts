import type { AnswerEntry, AnswerResult, AnswerStatus } from '../../contract';
import { isAnswered } from '../../item-response';
import { textOrEmpty } from './fields';
import type { AnswerSubject } from './item-format';

// The answer rules the question and finding kinds share: reading a saved
// answer entry, the recommended entry, a finished copy's entry, and the
// result's status, notes and Don't ask press.

// A file written before the Notes box held its text in 'what' and 'why'.
function oldFileNotes(saved: Readonly<Record<string, unknown>>): string {
  return [textOrEmpty(saved.what), textOrEmpty(saved.why)]
    .filter((text) => text !== '')
    .join('\n\n');
}

// A field of the wrong type reads as its empty value.
export function readAnswerEntry(
  index: number,
  saved: Readonly<Record<string, unknown>>,
): AnswerEntry {
  return {
    index,
    choice: Number.isInteger(saved.choice) ? (saved.choice as number) : 0,
    not_applicable: saved.not_applicable === true,
    notes: Object.hasOwn(saved, 'notes')
      ? textOrEmpty(saved.notes)
      : oldFileNotes(saved),
    dont_ask: saved.dont_ask === true,
    dont_ask_reason: textOrEmpty(saved.dont_ask_reason),
  };
}

// `choice` picked, every note and press empty.
export function recommendedAnswerEntry(
  index: number,
  choice: number,
): AnswerEntry {
  return {
    index,
    choice,
    not_applicable: false,
    notes: '',
    dont_ask: false,
    dont_ask_reason: '',
  };
}

// A press belongs to the round it was made in, so a finished round's copy
// drops it.
export function withoutDontAsk<Entry extends AnswerEntry>(entry: Entry): Entry {
  return { ...entry, dont_ask: false, dont_ask_reason: '' };
}

export function answerStatus(
  entry: AnswerEntry,
  answered: boolean,
): AnswerStatus {
  if (entry.not_applicable) {
    return 'not_applicable';
  }
  return answered ? 'answered' : 'untouched';
}

export function answerResult(
  subject: AnswerSubject,
  entry: AnswerEntry,
): AnswerResult {
  const choiceIsInRange =
    entry.choice >= 1 && entry.choice <= subject.choiceTexts.length;
  const answered = isAnswered({
    notApplicable: entry.not_applicable,
    pickIsComplete: choiceIsInRange,
  });
  const result: AnswerResult = {
    index: entry.index,
    title: subject.title,
    status: answerStatus(entry, answered),
    choice: answered ? entry.choice : 0,
    choice_text: answered ? subject.choiceTexts[entry.choice - 1] : '',
    took_recommendation: answered && entry.choice === subject.recommend,
  };
  addNotesAndDontAsk(result, entry);
  return result;
}

// Notes appear only when the user wrote some; `dont_ask` only on a pressed
// answer, with its reason when the box held text.
export function addNotesAndDontAsk(
  result: AnswerResult,
  entry: AnswerEntry,
): void {
  if (entry.notes) {
    result.notes = entry.notes;
  }
  if (entry.dont_ask) {
    result.dont_ask = true;
    if (entry.dont_ask_reason) {
      result.dont_ask_reason = entry.dont_ask_reason;
    }
  }
}
