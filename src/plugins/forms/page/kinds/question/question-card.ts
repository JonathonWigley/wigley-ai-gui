import { element, markdownElement } from '../../../../../shared/page/dom';
import { itemAnswer } from '../../form-state';
import {
  buildAnswerControls,
  buildChoiceList,
  buildItemHead,
  buildSection,
  showAnswer,
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
    const statusChip = buildItemHead(
      article,
      `${questionFormat.railPrefix}${index}`,
      question.title,
    );
    buildSection(article, 'Context', question.context, deps.markdown);
    article.append(
      markdownElement('div', 'ask md', deps.markdown.block(question.question)),
    );
    const choiceList = element('ol', 'choices');
    article.append(choiceList);
    const choices = buildChoiceList(
      choiceList,
      question.choices,
      question.recommend,
      (choice) => {
        deps.dispatch({ type: 'focusItem', item: position });
        deps.dispatch({ type: 'choose', choice });
      },
      deps.markdown,
    );
    if (question.rationale.trim() !== '') {
      const rationale = element('div', 'rationale');
      rationale.append(
        element('div', 'rationale-label', 'Why recommended'),
        markdownElement('div', 'md', deps.markdown.block(question.rationale)),
      );
      choices[question.recommend - 1].append(rationale);
    }
    const controls = buildAnswerControls(article, round, item, position, deps);
    const parts = { card: article, statusChip, choiceList, choices };
    return {
      element: article,
      update(current) {
        const answer = itemAnswer(current, item);
        showAnswer(parts, answer);
        controls.update(answer);
      },
    };
  },
};
