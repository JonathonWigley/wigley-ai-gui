import type { AnswerEntry, ItemAnswer, PageKind } from '../../contract';
import {
  ANSWER_BOXES,
  answerEntry,
  answerText,
  entryAt,
  restoreAnswer,
  UNTOUCHED_ANSWER,
  withAnswerText,
} from './item-answer';

// A plugin kind for tests: a poll whose items the user votes on by option
// when the kind is answerable, and only writes notes on when it is not.

export interface Poll {
  title: string;
  options: string[];
  // 1-based.
  recommend: number;
  layout: string | null;
}

export interface PollInput {
  title: string;
  options: string[];
  index: number;
}

export function poll(title: string, overrides: Partial<Poll> = {}): Poll {
  return {
    title,
    options: [`${title} yes`, `${title} no`],
    recommend: 1,
    layout: null,
    ...overrides,
  };
}

const NOTES_ONLY = {
  fields: ANSWER_BOXES.fields.filter((box) => box.field === 'notes'),
  shown: (): readonly string[] => ['notes'],
};

// The poll kind under `id` at `railOrder`; `answerable` gives it a pick, and
// `bodyKey` defaults to `<id>_answers`.
export function pollPageKind(
  id: string,
  options: { railOrder?: number; answerable?: boolean; bodyKey?: string } = {},
): PageKind<Poll, ItemAnswer, PollInput> {
  const answerable = options.answerable ?? true;
  return {
    spec: {
      id,
      argsKey: `${id}s`,
      bodyKey: options.bodyKey ?? `${id}_answers`,
      resultKey: `${id}s`,
      fingerprintJoinsWhenEmpty: false,
      answerable,
    },
    restore: {
      decode: (polls, entries) =>
        polls.map((item, i) =>
          restoreAnswer(
            entryAt<AnswerEntry>(entries, i + 1),
            item.options.length,
          ),
        ),
      encode: (answers) => answers.map(answerEntry),
    },
    reduce: {
      untouched: () => UNTOUCHED_ANSWER,
      text: answerText,
      withText: withAnswerText,
      pick: answerable
        ? {
            choose: (item, answer, number) =>
              number >= 1 && number <= item.options.length
                ? { ...answer, choice: answer.choice === number ? 0 : number }
                : answer,
            clear: (_item, answer) =>
              answer.choice === 0 ? answer : { ...answer, choice: 0 },
            recommended: (item, answer) =>
              answer.choice === item.recommend
                ? answer
                : { ...answer, choice: item.recommend },
            isComplete: (_item, answer) => answer.choice >= 1,
            number: (_item, answer) => answer.choice,
            choice: (_item, answer) => answer.choice,
            choiceText: (item, choice) => item.options[choice - 1],
            recommend: (item) => item.recommend,
            isRecommended: (item, answer) => answer.choice === item.recommend,
          }
        : undefined,
    },
    boxes: answerable ? ANSWER_BOXES : NOTES_ONLY,
    cardInput: {
      railPrefix: 'P',
      title: (item) => item.title,
      layout: (item) => item.layout,
      input: (item, index) => ({
        title: item.title,
        options: [...item.options],
        index,
      }),
    },
    railOrder: options.railOrder ?? 15,
  };
}
