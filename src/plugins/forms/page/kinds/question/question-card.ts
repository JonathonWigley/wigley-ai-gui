import type {
  AnswerEntry,
  ItemAnswer,
  PageKind,
  Question,
} from '../../../contract';
import { BUILT_IN_KIND_SPECS } from '../../../item-kinds';
import { labelFor, roundInfo } from '../card-parts';
import {
  ANSWER_BOXES,
  answerEntry,
  answerText,
  entryAt,
  restoreAnswer,
  UNTOUCHED_ANSWER,
  withAnswerText,
} from '../item-answer';
import type { CardInputs } from '../item-format';

const RAIL_PREFIX = '';

// A question's pick is its choice; the same choice again clears it.
export const questionPageKind: PageKind<
  Question,
  ItemAnswer,
  CardInputs['question']
> = {
  spec: BUILT_IN_KIND_SPECS.question,
  restore: {
    decode: (questions, entries) =>
      questions.map((question, i) =>
        restoreAnswer(
          entryAt<AnswerEntry>(entries, i + 1),
          question.choices.length,
        ),
      ),
    encode: (answers) => answers.map(answerEntry),
  },
  reduce: {
    untouched: () => UNTOUCHED_ANSWER,
    text: answerText,
    withText: withAnswerText,
    pick: {
      choose(question, answer, number) {
        const isChoiceInRange =
          number >= 1 && number <= question.choices.length;
        if (!isChoiceInRange) {
          return answer;
        }
        return { ...answer, choice: answer.choice === number ? 0 : number };
      },
      clear: (_question, answer) =>
        answer.choice === 0 ? answer : { ...answer, choice: 0 },
      recommended: (question, answer) =>
        answer.choice === question.recommend
          ? answer
          : { ...answer, choice: question.recommend },
      isComplete: (_question, answer) => answer.choice >= 1,
      number: (_question, answer) => answer.choice,
      choice: (_question, answer) => answer.choice,
      choiceText: (question, choice) => question.choices[choice - 1],
      recommend: (question) => question.recommend,
      isRecommended: (question, answer) => answer.choice === question.recommend,
    },
  },
  boxes: ANSWER_BOXES,
  cardInput: {
    railPrefix: RAIL_PREFIX,
    title: (question) => question.title,
    layout: (question) => question.layout,
    input(question, index, round) {
      return {
        label: labelFor(RAIL_PREFIX, index),
        title: question.title,
        summary: question.summary,
        context: question.context,
        choices: [...question.choices],
        recommend: question.recommend,
        rationale: question.rationale,
        round: roundInfo(round),
      };
    },
  },
  railOrder: 20,
};
