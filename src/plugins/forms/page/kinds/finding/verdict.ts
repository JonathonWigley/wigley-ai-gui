import type {
  Finding,
  FindingCard,
  FindingOrigin,
  Severity,
} from '../../../contract';
import { FINDING_ORIGIN_RULES } from '../../../finding-origins';

// What a finding's card states up front: the card it draws as, the chip text
// for its origin and severity, and its impact.
export interface Verdict {
  card: FindingCard;
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
  return {
    card: FINDING_ORIGIN_RULES[finding.origin].card,
    origin: ORIGIN_CHIPS[finding.origin],
    severity: 'severity' in finding ? SEVERITY_CHIPS[finding.severity] : null,
    impact: finding.impact,
  };
}
