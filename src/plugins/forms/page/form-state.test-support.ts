import { activeForm } from '../../../shared/page/session-forms';
import type {
  AnswerEntry,
  FindingAnswerEntry,
  FormBody,
  Notice,
  PresentedRound,
  Question,
} from '../contract';
import type { FormsAction, FormsState } from './form-state';
import { poll } from './kinds/plugin-page-kind.test-support';
import type { RoundState } from './round-model';
import {
  apply,
  finding,
  initialState,
  roundOf,
  type RoundParts,
} from './test-rounds';

export function question(title: string, choiceCount = 3): Question {
  return {
    title,
    summary: `${title}?`,
    context: `${title} context`,
    choices: Array.from(
      { length: choiceCount },
      (_, i) => `${title} choice ${i + 1}`,
    ),
    recommend: 1,
    rationale: `${title} rationale`,
    approves: [],
    layout: null,
  };
}

export function notice(title: string): Notice {
  return {
    title,
    context: `${title} context`,
    badge: 'Applied',
    layout: null,
  };
}

export function presented(
  roundId: string,
  parts: RoundParts = {},
  draft: FormBody | null = null,
): PresentedRound {
  return {
    roundId,
    sessionId: `${roundId}-session`,
    label: `project · ${roundId}`,
    round: {
      ...roundOf(roundId, {
        questions: [question('Q1'), question('Q2')],
        ...parts,
      }),
      heading: roundId,
    },
    draft,
  };
}

export function entry(
  index: number,
  fields: Partial<AnswerEntry>,
): AnswerEntry {
  return {
    index,
    choice: 0,
    not_applicable: false,
    notes: '',
    dont_ask: false,
    dont_ask_reason: '',
    ...fields,
  };
}

// A finding entry as the page writes it: without the action labels, which
// main adds when it reads the body.
export function findingEntry(
  index: number,
  fields: Partial<FindingAnswerEntry>,
): FindingAnswerEntry {
  return {
    ...entry(index, fields),
    action: '',
    ...fields,
  } as FindingAnswerEntry;
}

export function draft(fields: Partial<FormBody>): FormBody {
  return {
    note: '',
    answers: [],
    finding_answers: [],
    notice_comments: [],
    ...fields,
  };
}

export function run(state: FormsState, ...actions: FormsAction[]): FormsState {
  return actions.reduce(apply, state);
}

export function active(state: FormsState): RoundState {
  const round = activeForm(state);
  if (round === null) {
    throw new Error('expected an active round');
  }
  return round;
}

// Rail positions: 0 = question Q1, 1 = question Q2, 2 = the notices stop.
export function mixedRound(body: FormBody | null = null): FormsState {
  return initialState(
    [presented('r1', { notices: [notice('N1')] }, body)],
    'r1-session',
  );
}

// Rail positions: 0 = finding F1, 1 = question Q1, 2 = question Q2, 3 = the
// notices stop.
export function findingRound(body: FormBody | null = null): FormsState {
  return initialState(
    [
      presented(
        'r1',
        { notices: [notice('N1')], findings: [finding('F1')] },
        body,
      ),
    ],
    'r1-session',
  );
}

export const POLL_PARTS: RoundParts = {
  findings: [finding('F1')],
  questions: [question('Q1')],
  items: { poll: [poll('P1')] },
  bodyKeys: { poll: 'poll_answers' },
};
