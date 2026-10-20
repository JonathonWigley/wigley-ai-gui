import {
  FINDING_ACTIONS,
  type FindingAction,
  type FindingCard,
} from '../../../contract';
import { actionLabel } from '../../../finding-origins';
import { labelFor, roundInfo } from '../card-parts';
import type { AnswerableFormat, CardInputs } from '../item-format';
import { verdictOf } from './verdict';

const RAIL_PREFIX = 'F';

// Each card's kind label and the titles of its two sections.
const CARD_TEXT: Record<
  FindingCard,
  { kind: string; finding: string; proof: string }
> = {
  defect: { kind: 'Defect', finding: 'Finding', proof: 'Proof' },
  decision: { kind: 'Decision', finding: 'Decision', proof: 'Context' },
  nit: { kind: 'Nit', finding: 'Finding', proof: "Why it's safe" },
};

export const findingFormat: AnswerableFormat<CardInputs['finding']> = {
  railPrefix: RAIL_PREFIX,
  title: (round, index) => round.findings[index - 1].title,
  choiceTexts: (round, index) =>
    round.findings[index - 1].choices.map((choice) => choice.text),
  recommend: (round, index) => round.findings[index - 1].recommend,
  cardInput(round, index) {
    const finding = round.findings[index - 1];
    const verdict = verdictOf(finding);
    return {
      label: labelFor(RAIL_PREFIX, index),
      title: finding.title,
      card: verdict.card,
      origin: finding.origin,
      severity: 'severity' in finding ? finding.severity : null,
      words: { ...CARD_TEXT[verdict.card] },
      originChip: verdict.origin,
      severityChip: verdict.severity,
      impact: verdict.impact,
      finding: finding.finding,
      proof: finding.proof,
      choices: finding.choices.map(({ text, reason }) => ({ text, reason })),
      recommend: finding.recommend,
      recommendAction: finding.recommend_action,
      actions: FINDING_ACTIONS.flatMap((action: FindingAction) => {
        const label = actionLabel(finding.origin, action);
        return label === null ? [] : [{ action, label }];
      }),
      round: roundInfo(round),
    };
  },
};
