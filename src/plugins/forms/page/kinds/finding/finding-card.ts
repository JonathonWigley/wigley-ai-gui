import { button, element } from '../../../../../shared/page/dom';
import { FINDING_ACTIONS, type FindingAction } from '../../../contract';
import type { FindingAnswer } from '../../form-state';
import {
  buildAnswerableCard,
  buildChoiceReason,
  buildItemHead,
  buildSection,
} from '../card-parts';
import type { AnswerableFormat, CardDeps } from '../item-format';
import { FINDING_ACTION_LABELS } from './action-labels';

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
    const statusChip = buildItemHead(article, 'Finding');
    buildSection(article, 'Finding', finding.finding, deps.markdown);
    buildSection(article, 'Proof', finding.proof, deps.markdown);
    const { card, choices, choiceList } = buildAnswerableCard(
      article,
      statusChip,
      findingFormat,
      round,
      item,
      position,
      deps,
    );
    finding.choices.forEach((choice, i) =>
      choices[i].append(buildChoiceReason('Why', choice.reason, deps.markdown)),
    );
    const actions = buildActionRow(finding.recommend_action, position, deps);
    choiceList.after(actions.element);
    return {
      element: card.element,
      update(current) {
        card.update(current);
        const answer = current.findingAnswers[index - 1];
        actions.update(answer);
        choiceList.classList.toggle('is-dimmed', answer.action === 'leave_it');
      },
    };
  },
};

// The labelled Action row: one button per action, the recommended one badged;
// a click focuses the finding at rail `position` and picks that action.
// `update` shows the picked action and locks the row while not applicable.
function buildActionRow(
  recommend: FindingAction,
  position: number,
  deps: CardDeps,
): { element: HTMLElement; update(answer: FindingAnswer): void } {
  const row = element('div', 'finding-actions');
  const buttons = element('div', 'action-picks');
  row.append(element('div', 'answer-label', 'Action'), buttons);
  const picks = FINDING_ACTIONS.map((action) => {
    const pick = button('action-pick', FINDING_ACTION_LABELS[action], () => {
      deps.dispatch({ type: 'focusItem', item: position });
      deps.dispatch({ type: 'chooseAction', action });
    });
    if (action === recommend) {
      pick.classList.add('is-recommended');
      pick.append(element('span', 'badge badge-recommend', 'Recommended'));
    }
    buttons.append(pick);
    return { action, pick };
  });
  return {
    element: row,
    update(answer) {
      for (const { action, pick } of picks) {
        const isPicked = answer.action === action;
        pick.classList.toggle('is-selected', isPicked);
        pick.setAttribute('aria-pressed', String(isPicked));
      }
      buttons.classList.toggle('is-locked', answer.notApplicable);
    },
  };
}
