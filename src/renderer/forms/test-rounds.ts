import type { Notice, PresentedRound, Question } from '../../contracts/forms';

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

export function presentedRound(
  roundId: string,
  parts: { questions?: Question[]; notices?: Notice[] } = {},
): PresentedRound {
  return {
    roundId,
    label: `project · ${roundId}`,
    round: {
      heading: `${roundId} heading`,
      overview: '',
      questions: parts.questions ?? [question('Alpha'), question('Beta')],
      notices: parts.notices ?? [],
    },
    draft: null,
  };
}
