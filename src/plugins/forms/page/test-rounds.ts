import type {
  DecisionFinding,
  DefectFinding,
  Finding,
  FindingChoice,
  NitFinding,
  Notice,
  PresentedRound,
  Question,
} from '../contract';

export function question(
  title: string,
  overrides: Partial<Question> = {},
): Question {
  return {
    title,
    context: `${title} context`,
    question: `${title}?`,
    choices: ['first', 'second', 'third'],
    recommend: 2,
    rationale: `${title} rationale`,
    ...overrides,
  };
}

export function notice(title: string): Notice {
  return { title, context: `${title} context`, badge: 'Applied' };
}

function choices(texts: string[]): FindingChoice[] {
  return texts.map((text) => ({ text, reason: `${text} reason` }));
}

export function finding(
  title: string,
  overrides: Partial<DefectFinding> = {},
): DefectFinding {
  return {
    title,
    origin: 'caused',
    severity: 'important',
    impact: `${title} impact`,
    finding: `${title} finding`,
    proof: `${title} proof`,
    choices: choices(['first', 'second', 'third']),
    recommend: 2,
    recommend_action: 'fix_now',
    ...overrides,
  };
}

export function decision(
  title: string,
  overrides: Partial<DecisionFinding> = {},
): DecisionFinding {
  return {
    title,
    origin: 'design',
    impact: `${title} impact`,
    finding: `${title} finding`,
    proof: `${title} proof`,
    choices: choices(['first', 'second']),
    recommend: 1,
    recommend_action: 'follow_up',
    ...overrides,
  };
}

export function nit(
  title: string,
  overrides: Partial<NitFinding> = {},
): NitFinding {
  return {
    title,
    origin: 'nit',
    impact: `${title} impact`,
    finding: `${title} finding`,
    proof: `${title} proof`,
    choices: choices(['first']),
    recommend: 1,
    recommend_action: 'fix_now',
    ...overrides,
  };
}

export function presentedRound(
  roundId: string,
  parts: {
    questions?: Question[];
    notices?: Notice[];
    findings?: Finding[];
  } = {},
): PresentedRound {
  return {
    roundId,
    sessionId: `${roundId}-session`,
    label: `project · ${roundId}`,
    round: {
      heading: `${roundId} heading`,
      overview: '',
      questions: parts.questions ?? [question('Alpha'), question('Beta')],
      notices: parts.notices ?? [],
      findings: parts.findings ?? [],
    },
    draft: null,
  };
}
