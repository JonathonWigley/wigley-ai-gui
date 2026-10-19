import type {
  Finding,
  FindingCard,
  FindingOrigin,
  Severity,
} from '../../../contract';
import { actionLabel, FINDING_ORIGIN_RULES } from '../../../finding-origins';

// What a finding's card states up front: the agent's recommended pick in the
// card's words, and the chip text for its origin and severity.
export interface Verdict {
  card: FindingCard;
  // The card's word for the recommended action.
  action: string;
  // The recommended choice's text; null when the recommendation is leave_it.
  choice: string | null;
  // Chip text.
  origin: string;
  // Chip text; null on a finding with no severity.
  severity: string | null;
  impact: string;
}

const ORIGIN_CHIPS: Record<FindingOrigin, string> = {
  caused: 'Caused by this change',
  pre_existing: 'Pre-existing',
  design: 'Design decision',
  nit: 'Nit',
};

const SEVERITY_CHIPS: Record<Severity, string> = {
  critical: 'Critical',
  important: 'Important',
  minor: 'Minor',
};

export function verdictOf(finding: Finding): Verdict {
  const action = actionLabel(finding.origin, finding.recommend_action);
  if (action === null) {
    throw new Error(
      `A ${finding.origin} finding cannot recommend ${finding.recommend_action}: "${finding.title}"`,
    );
  }
  return {
    card: FINDING_ORIGIN_RULES[finding.origin].card,
    action,
    choice:
      finding.recommend_action === 'leave_it'
        ? null
        : finding.choices[finding.recommend - 1].text,
    origin: ORIGIN_CHIPS[finding.origin],
    severity: 'severity' in finding ? SEVERITY_CHIPS[finding.severity] : null,
    impact: finding.impact,
  };
}
