import type { CommandId } from '../../../../../contracts/commands';
import {
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
import { changeShows, type FindingAnswer } from '../../form-state';
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
    const verdictBlock = buildVerdict(finding, verdict, position, deps);
    article.append(verdictBlock.element);
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
    const change = foldIntoChange(choiceList, actions.element);
    return {
      element: card.element,
      update(current) {
        card.update(current);
        const answer = current.findingAnswers[index - 1];
        const shows = changeShows(current, index);
        actions.update(answer);
        choiceList.classList.toggle('is-dimmed', answer.action === 'leave_it');
        change.hidden = !shows;
        verdictBlock.update(shows);
      },
    };
  },
};

// The verdict under the finding and proof: its origin and severity chips, the
// recommended action and choice, the impact, and the Accept and Change…
// buttons, each focusing the finding at rail `position` first and showing the
// keys that run its command. `update` marks Change… open while the Change…
// region shows.
function buildVerdict(
  finding: Finding,
  verdict: Verdict,
  position: number,
  deps: CardDeps,
): { element: HTMLElement; update(changeShows: boolean): void } {
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
  const line = element('div', 'verdict-line');
  line.append(element('span', 'verdict-action', verdict.action));
  if (verdict.choice !== null) {
    line.append(
      ' — ',
      markdownElement(
        'span',
        'verdict-choice',
        deps.markdown.inline(verdict.choice),
      ),
    );
  }
  const focusThis = () => deps.dispatch({ type: 'focusItem', item: position });
  const accept = button('verdict-button verdict-accept', 'Accept', () => {
    focusThis();
    deps.dispatch({ type: 'acceptRecommendation' });
  });
  appendKeys(accept, formsCommand('acceptRecommendation'), deps);
  const changeButton = button('verdict-button', 'Change…', () => {
    focusThis();
    deps.dispatch({ type: 'toggleChange' });
  });
  appendKeys(changeButton, formsCommand('toggleChange'), deps);
  const buttons = element('div', 'verdict-buttons');
  buttons.append(accept, changeButton);
  block.append(
    chips,
    line,
    markdownElement(
      'div',
      'verdict-impact md',
      deps.markdown.block(verdict.impact),
    ),
    buttons,
  );
  return {
    element: block,
    update(changeShows) {
      changeButton.setAttribute('aria-expanded', String(changeShows));
    },
  };
}

// Shows the keys that run `command` after `control`'s label; nothing when no
// key is bound.
function appendKeys(control: HTMLElement, command: CommandId, deps: CardDeps) {
  const keys = deps.keysFor(command);
  if (keys !== null) {
    control.append(element('kbd', '', keys));
  }
}

// Moves the "Your answer" label and choice list buildAnswerableCard built into
// a Change… region in their place, with the action row after them; returns
// the region.
function foldIntoChange(
  choiceList: HTMLElement,
  actionRow: HTMLElement,
): HTMLElement {
  const answerLabel = choiceList.previousElementSibling;
  if (answerLabel === null) {
    throw new Error(
      'The finding card found no answer label before its choices',
    );
  }
  const change = element('div', 'finding-change');
  answerLabel.before(change);
  change.append(answerLabel, choiceList, actionRow);
  return change;
}

// The labelled Action row: one button per action the origin offers, in the
// card's word, the recommended one badged; a click focuses the finding at rail
// `position` and picks that action. `update` shows the picked action and
// locks the row while not applicable.
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
