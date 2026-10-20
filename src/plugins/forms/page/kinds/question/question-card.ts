import { labelFor, roundInfo } from '../card-parts';
import type { AnswerableFormat, CardInputs } from '../item-format';

const RAIL_PREFIX = '';

export const questionFormat: AnswerableFormat<CardInputs['question']> = {
  railPrefix: RAIL_PREFIX,
  title: (round, index) => round.questions[index - 1].title,
  choiceTexts: (round, index) => round.questions[index - 1].choices,
  recommend: (round, index) => round.questions[index - 1].recommend,
  cardInput(round, index) {
    const question = round.questions[index - 1];
    return {
      label: labelFor(RAIL_PREFIX, index),
      title: question.title,
      question: question.question,
      context: question.context,
      choices: [...question.choices],
      recommend: question.recommend,
      rationale: question.rationale,
      round: roundInfo(round),
    };
  },
};
