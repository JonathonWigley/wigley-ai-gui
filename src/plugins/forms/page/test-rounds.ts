import type { Finding, Notice, PresentedRound, Question } from '../contract';

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

export function finding(
  title: string,
  overrides: Partial<Finding> = {},
): Finding {
  return {
    title,
    finding: `${title} finding`,
    proof: `${title} proof`,
    choices: ['first', 'second', 'third'].map((text) => ({
      text,
      reason: `${text} reason`,
    })),
    recommend: 2,
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
