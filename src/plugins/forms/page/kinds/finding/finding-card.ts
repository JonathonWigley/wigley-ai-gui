import type { CommandId } from '../../../../../contracts/commands';
import {
  appendKeys,
  button,
  element,
  markdownElement,
} from '../../../../../shared/page/dom';
import {
  FINDING_ACTIONS,
  type Finding,
  type FindingAction,
  type FindingCard,
  type FindingOrigin,
} from '../../../contract';
import { actionLabel } from '../../../finding-origins';
import { formsCommand } from '../../../ids';
import type { FindingAnswer } from '../../form-state';
import {
  buildAnswerableCard,
  buildChoiceReason,
  buildItemHead,
  buildSection,
} from '../card-parts';
import type { AnswerableFormat, CardDeps } from '../item-format';
import { type Verdict, verdictOf } from './verdict';

// Each card's kind label and the titles of its two sections.
const CARD_TEXT: Record<
  FindingCard,
  { kind: string; finding: string; proof: string }
> = {
  defect: { kind: 'Defect', finding: 'Finding', proof: 'Proof' },
  decision: { kind: 'Decision', finding: 'Decision', proof: 'Context' },
  nit: { kind: 'Nit', finding: 'Finding', proof: "Why it's safe" },
};

// The command that picks each action.
const ACTION_COMMANDS: Record<FindingAction, CommandId> = {
  fix_now: formsCommand('actFixNow'),
  follow_up: formsCommand('actFollowUp'),
  leave_it: formsCommand('actLeaveIt'),
};

export const findingFormat: AnswerableFormat = {
  railPrefix: 'F',
  title: (round, index) => round.findings[index - 1].title,
  choiceTexts: (round, index) =>
    round.findings[index - 1].choices.map((choice) => choice.text),
  recommend: (round, index) => round.findings[index - 1].recommend,
  buildCard(parent, round, index, position, deps) {
    const finding = round.round.findings[index - 1];
    const item = { kind: 'finding', index } as const;
    const verdict = verdictOf(finding);
    const text = CARD_TEXT[verdict.card];
    const article = element('article', 'item finding');
    parent.append(article);
    const statusChip = buildItemHead(article, text.kind);
    buildSection(article, text.finding, finding.finding, deps.markdown);
    const proof = element('div', 'finding-proof');
    article.append(proof);
    buildSection(proof, text.proof, finding.proof, deps.markdown);
    article.append(buildVerdict(finding, verdict, position, deps));
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
    const actions = buildActionRow(
      finding.origin,
      finding.recommend_action,
      position,
      deps,
    );
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

// The verdict under the finding and proof: its origin and severity chips, the
// impact, and the Accept button, which focuses the finding at rail `position`
// and picks the recommended action and choice the choice list and action row
// badge.
function buildVerdict(
  finding: Finding,
  verdict: Verdict,
  position: number,
  deps: CardDeps,
): HTMLElement {
  const block = element('section', 'verdict');
  const chips = element('div', 'verdict-chips');
  const origin = element('span', 'badge badge-origin', verdict.origin);
  origin.dataset.origin = finding.origin;
  chips.append(origin);
  if (verdict.severity !== null && 'severity' in finding) {
    const severity = element('span', 'badge badge-severity', verdict.severity);
    severity.dataset.severity = finding.severity;
    chips.append(severity);
  }
  const accept = button('verdict-button verdict-accept', 'Accept', () => {
    deps.dispatch({ type: 'focusItem', item: position });
    deps.dispatch({ type: 'acceptRecommendation' });
  });
  appendKeys(accept, deps.keysFor(formsCommand('acceptRecommendation')));
  const buttons = element('div', 'verdict-buttons');
  buttons.append(accept);
  block.append(
    chips,
    markdownElement(
      'div',
      'verdict-impact md',
      deps.markdown.block(verdict.impact),
    ),
    buttons,
  );
  return block;
}

// The labelled Action row: one button per action the origin offers, in the
// card's word, the recommended one badged; a click focuses the finding at rail
// `position` and picks that action, and shows the keys that pick it. `update`
// shows the picked action and locks the row while not applicable.
function buildActionRow(
  origin: FindingOrigin,
  recommend: FindingAction,
  position: number,
  deps: CardDeps,
): { element: HTMLElement; update(answer: FindingAnswer): void } {
  const row = element('div', 'finding-actions');
  const buttons = element('div', 'action-picks');
  row.append(element('div', 'answer-label', 'Action'), buttons);
  const picks = FINDING_ACTIONS.flatMap((action) => {
    const label = actionLabel(origin, action);
    if (label === null) {
      return [];
    }
    const pick = button('action-pick', label, () => {
      deps.dispatch({ type: 'focusItem', item: position });
      deps.dispatch({ type: 'chooseAction', action });
    });
    if (action === recommend) {
      pick.classList.add('is-recommended');
      pick.append(element('span', 'badge badge-recommend', 'Recommended'));
    }
    appendKeys(pick, deps.keysFor(ACTION_COMMANDS[action]));
    buttons.append(pick);
    return [{ action, pick }];
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
