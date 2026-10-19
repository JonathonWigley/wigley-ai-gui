import { element } from '../../../../../shared/page/dom';
import {
  buildAnswerableCard,
  buildChoiceReason,
  buildItemHead,
  buildSection,
} from '../card-parts';
import type { AnswerableFormat } from '../item-format';

export const questionFormat: AnswerableFormat = {
  railPrefix: '',
  title: (round, index) => round.questions[index - 1].title,
  choiceTexts: (round, index) => round.questions[index - 1].choices,
  recommend: (round, index) => round.questions[index - 1].recommend,
  buildCard(parent, round, index, position, deps) {
    const question = round.round.questions[index - 1];
    const item = { kind: 'question', index } as const;
    const article = element('article', 'item question');
    parent.append(article);
    const statusChip = buildItemHead(article, 'Question');
    buildSection(article, 'Question', question.question, deps.markdown);
    buildSection(article, 'Context', question.context, deps.markdown);
    const { card, choices } = buildAnswerableCard(
      article,
      statusChip,
      questionFormat,
      round,
      item,
      position,
      deps,
    );
    if (question.rationale.trim() !== '') {
      choices[question.recommend - 1].append(
        buildChoiceReason('Why recommended', question.rationale, deps.markdown),
      );
    }
    return card;
  },
};
