import { element, markdownElement } from '../../../../../shared/page/dom';
import {
  buildAnswerableCard,
  buildItemHead,
  buildSection,
  labelFor,
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
      labelFor(findingFormat.railPrefix, index),
      finding.title,
    );
    buildSection(article, 'Finding', finding.finding, deps.markdown);
    buildSection(article, 'Proof', finding.proof, deps.markdown);
    const { card, choices } = buildAnswerableCard(
      article,
      statusChip,
      findingFormat,
      round,
      item,
      position,
      deps,
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
    return card;
  },
};
