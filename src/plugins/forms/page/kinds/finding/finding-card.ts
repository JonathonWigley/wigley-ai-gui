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

export const findingFormat: AnswerableFormat = {
  railPrefix: 'F',
  title: (round, index) => round.findings[index - 1].title,
  choiceTexts: (round, index) =>
    round.findings[index - 1].choices.map((choice) => choice.text),
  recommend: (round, index) => round.findings[index - 1].recommend,
  buildCard(parent, round, index, position, deps) {
    const finding = round.round.findings[index - 1];
    const item = { kind: 'finding', index } as const;
    const article = element('article', 'item finding');
    parent.append(article);
    const statusChip = buildItemHead(
      article,
      `${findingFormat.railPrefix}${index}`,
      finding.title,
    );
    buildSection(article, 'Finding', finding.finding, deps.markdown);
    buildSection(article, 'Proof', finding.proof, deps.markdown);
    const choiceList = element('ol', 'choices');
    article.append(choiceList);
    const choices = buildChoiceList(
      choiceList,
      finding.choices.map((choice) => choice.text),
      finding.recommend,
      (choice) => {
        deps.dispatch({ type: 'focusItem', item: position });
        deps.dispatch({ type: 'choose', choice });
      },
      deps.markdown,
    );
    finding.choices.forEach((choice, i) =>
      choices[i].append(
        markdownElement(
          'div',
          'choice-reason md',
          deps.markdown.block(choice.reason),
        ),
      ),
    );
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
