import type { Finding, FindingOriginSpec, Severity } from '../../../contract';
import { FINDING_ORIGIN_SPECS, findingOrigins } from '../../../finding-origins';
import { themeVariable } from '../../../../../shared/theme-variables';

// What a finding's card states up front: the card it draws as, the chip text
// for its origin and severity, the origin chip's colour, and its impact.
export interface Verdict {
  card: string;
  // Chip text.
  origin: string;
  // The CSS variable of the origin chip's colour; '' for none.
  originToken: string;
  // Chip text; null on a finding with no severity.
  severity: string | null;
  impact: string;
}

const SEVERITY_CHIPS: Record<Severity, string> = {
  critical: 'Critical',
  important: 'Important',
  minor: 'Minor',
};

// The built-in spec whose card fields an origin the page holds no spec for
// draws with.
const FALLBACK_SPEC = FINDING_ORIGIN_SPECS.find((spec) => spec.id === 'caused');

// The spec the page draws `origin` with: the registered or retired one, else,
// for an origin registered in main alone, the caused card's fields with the
// origin id as its chip and no theme token.
export function drawnOriginSpec(origin: string): FindingOriginSpec {
  const spec = findingOrigins.spec(origin);
  if (spec !== undefined) {
    return spec;
  }
  if (FALLBACK_SPEC === undefined) {
    throw new Error('the built-in finding origins hold no caused origin');
  }
  return { ...FALLBACK_SPEC, id: origin, chip: origin, themeToken: '' };
}

export function verdictOf(finding: Finding): Verdict {
  const spec = drawnOriginSpec(finding.origin);
  return {
    card: spec.card,
    origin: spec.chip,
    originToken: spec.themeToken === '' ? '' : themeVariable(spec.themeToken),
    severity:
      finding.severity !== null ? SEVERITY_CHIPS[finding.severity] : null,
    impact: finding.impact,
  };
}
