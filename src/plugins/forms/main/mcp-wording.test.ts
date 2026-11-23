import { describe, expect, it } from 'vitest';
import type {
  AgentFormSession,
  AgentFormToolResult,
} from '../../../contracts/agent-forms';
import { createAgentFormToolSession } from '../../../shared/agent-forms/tool-session';
import {
  MAX_ENTRIES,
  type AnswersPayload,
  type FormBody,
  RoundError,
} from '../contract';
import { BUILT_IN_KINDS } from './kinds/formats';
import { pollKind } from './kinds/poll-kind.test-support';
import { roundErrorText } from './mcp-wording';
import {
  parseRound,
  readFormBody,
  recommendedBody,
  requireKnownLayouts,
} from './round';
import { autoAnsweredPayload, createRoundType } from './round-type';
import { formsTools } from './tool-definitions';
import { useBuiltInFindingOrigins } from '../finding-origins.test-support';

useBuiltInFindingOrigins();

const roundType = createRoundType(() => BUILT_IN_KINDS);

// The text an agent reads from ask_round and collect_last_round, pinned
// byte for byte: the expected values were captured from the tree before the
// round logic returned records, and never change with the wording's home.

function question(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Naming',
    summary: 'Which name should win?',
    context: 'Two modules do the same thing under different names.',
    choices: ['module_a', 'module_b'],
    recommend: 1,
    rationale: 'module_a is older and already referenced elsewhere.',
    ...overrides,
  };
}

function notice(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Renamed the stale helper',
    context: '`_load_cfg` is now `_load_config`. No behaviour changed.',
    ...overrides,
  };
}

function finding(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Stale cache',
    origin: 'caused',
    severity: 'important',
    impact: 'Users see stale data after a reload.',
    finding: 'The cache keeps entries after a reload.',
    proof: '- `cache.ts:40` never clears',
    choices: [
      { text: 'Fix it now', reason: 'It is one line.' },
      { text: 'Keep the cache', reason: 'Reloads are rare.' },
    ],
    recommend: 1,
    recommend_action: 'fix_now',
    ...overrides,
  };
}

// `item` without the field `field`.
function without(
  item: Record<string, unknown>,
  field: string,
): Record<string, unknown> {
  const { [field]: _dropped, ...rest } = item;
  return rest;
}

// A nit finding: one fix, recommending leave_it, so no severity and no
// recommend.
function nitFinding(overrides: Record<string, unknown> = {}) {
  return without(
    without(
      finding({
        origin: 'nit',
        choices: [{ text: 'Rename it', reason: 'The name reads better.' }],
        recommend_action: 'leave_it',
        ...overrides,
      }),
      'severity',
    ),
    'recommend',
  );
}

function withQuestion(item: unknown) {
  return { heading: 'H', questions: [item] };
}

function withNotice(item: unknown) {
  return { heading: 'H', notices: [item] };
}

function withFinding(item: unknown) {
  return { heading: 'H', findings: [item] };
}

const LAYOUT_NAMES = ['default', 'compact'];

function context(): { toolUseId: string | null; signal: AbortSignal } {
  return { toolUseId: null, signal: new AbortController().signal };
}

// The round's tool session over a session whose open runs `open`.
function callOpen(
  open: (args: unknown) => Promise<AnswersPayload>,
): Promise<AgentFormToolResult> {
  const session: AgentFormSession<AnswersPayload> = {
    open: (args) => open(args),
    collect: () => Promise.reject(new Error('collect is not called here')),
    end: () => {},
  };
  return createAgentFormToolSession(session, roundType).call(
    'ask_round',
    {},
    context(),
  );
}

interface ErrorRow {
  name: string;
  args: unknown;
  expected: string;
}

// One row per RoundError throw site, then one more per shared helper giving
// it the prefix its site row does not.
const ERROR_ROWS: ErrorRow[] = [
  // round.ts
  {
    name: 'a list field that is not a list',
    args: { heading: 'H', notices: 'one item' },
    expected: "ask_round's notices must be a list of objects.",
  },
  {
    name: 'a call that is not an object',
    args: 'not a dict',
    expected:
      "ask_round takes an object with 'heading', 'overview', 'layout', " +
      "'notices', 'findings', and 'questions'. Each list is optional, but " +
      'the round needs at least one item.',
  },
  {
    name: 'an unknown round field',
    args: { heading: 'H', questions: [question()], extra: 1 },
    expected:
      'ask_round got unknown field(s): extra. It takes ' +
      "'heading', 'overview', 'layout', 'notices', 'findings', and " +
      "'questions'.",
  },
  {
    name: 'an overview that is not a string',
    args: { heading: 'H', overview: 3, questions: [question()] },
    expected: "ask_round's overview must be a string.",
  },
  {
    name: 'a round with no items',
    args: { heading: 'H' },
    expected: 'ask_round needs at least one notice, finding or question.',
  },
  {
    name: 'an unknown round layout',
    args: { heading: 'H', layout: 'dense', questions: [question()] },
    expected:
      "ask_round's layout 'dense' is not in the layouts folder, which holds " +
      "'default' and 'compact'. Write dense/layout.js there first, or leave " +
      'layout out.',
  },
  // kinds/fields.ts
  {
    name: 'a blank heading',
    args: { heading: '', questions: [question()] },
    expected:
      'heading must be a non-empty string. Give it the text you would have ' +
      'written in the reply.',
  },
  {
    name: 'a blank round layout',
    args: { heading: 'H', layout: '  ', questions: [question()] },
    expected: "ask_round's layout must be a layout name: a non-empty string.",
  },
  {
    name: 'a recommend that is not an integer',
    args: withQuestion(question({ recommend: 'x' })),
    expected:
      'Question 1: recommend must be the 1-based number of the recommended ' +
      'choice, not str.',
  },
  {
    name: 'a recommend out of range',
    args: withQuestion(question({ recommend: 5 })),
    expected:
      "Question 1: 'Naming' has 2 choices; recommend was 5. Use a number " +
      'from 1 to 2.',
  },
  // kinds/notice/notice-format.ts
  {
    name: 'a notice that is not an object',
    args: withNotice('x'),
    expected: 'Notice 1: each notice must be an object.',
  },
  {
    name: 'a notice missing a field',
    args: withNotice({ title: 'T' }),
    expected:
      'Notice 1: missing context. Both fields are required: title, context.',
  },
  {
    name: 'a notice with an unknown field',
    args: withNotice(notice({ choices: [] })),
    expected:
      'Notice 1: unknown field(s) choices. A notice takes only title, ' +
      'context, and the optional badge and layout; the form draws its own ' +
      'comment box, and a notice has no choices to describe.',
  },
  {
    name: 'an unknown notice badge',
    args: withNotice(notice({ badge: 'Done' })),
    expected:
      "Notice 1: badge must be one of Applied, Dispatched, Decided, not 'Done'. " +
      "Use 'Applied' for a fix already landed, 'Dispatched' for one still in " +
      "flight, and 'Decided' for a decision you took alone.",
  },
  // kinds/question/question-format.ts
  {
    name: 'question choices that are not a list',
    args: withQuestion(question({ choices: 'a' })),
    expected: 'Question 1: choices must be a list of strings.',
  },
  {
    name: 'a question with too few choices',
    args: withQuestion(question({ choices: ['a'] })),
    expected:
      'Question 1: has 1 choice(s). A question with fewer than 2 is not a ' +
      'question — give at least 2.',
  },
  {
    name: 'a question with too many choices',
    args: withQuestion(
      question({
        choices: Array.from({ length: MAX_ENTRIES + 1 }, (_, i) => `c${i}`),
      }),
    ),
    expected:
      'Question 1: has 10 choices; the maximum is 9, one per number key. ' +
      'Split it into two questions.',
  },
  {
    name: 'a question that is not an object',
    args: withQuestion('x'),
    expected: 'Question 1: each question must be an object.',
  },
  {
    name: 'a question with both summary and question',
    args: withQuestion(question({ question: 'Old?' })),
    expected:
      'Question 1: has both summary and question. Send summary alone: ' +
      'question is its old name.',
  },
  {
    name: 'a question missing fields',
    args: withQuestion({ title: 'T' }),
    expected:
      'Question 1: missing choices, context, rationale, recommend, summary. ' +
      'All six fields are required: title, summary, context, choices, ' +
      'recommend, rationale.',
  },
  {
    name: 'a question with an unknown field',
    args: withQuestion(question({ notes: 'x' })),
    expected:
      'Question 1: unknown field(s) notes. The form draws the ' +
      'not-applicable control and the Notes box itself; do not describe them.',
  },
  // kinds/finding/finding-format.ts
  {
    name: 'a choice action outside the three',
    args: withFinding(
      finding({ choices: [{ text: 'A', reason: 'R', action: 'later' }] }),
    ),
    expected:
      "Finding 1: choices[1].action must be one of 'fix_now', 'follow_up', " +
      "and 'leave_it'.",
  },
  {
    name: 'a choice action the origin does not offer',
    args: withFinding(
      nitFinding({
        choices: [{ text: 'Rename it', reason: 'R', action: 'follow_up' }],
      }),
    ),
    expected:
      'Finding 1: choices[1].action is follow_up, which a nit finding does ' +
      'not offer; it offers fix_now or leave_it.',
  },
  {
    name: 'a finding choice that is not an object',
    args: withFinding(finding({ choices: ['x'] })),
    expected:
      'Finding 1: choices[1] must be an object with text, reason and an ' +
      'optional action.',
  },
  {
    name: 'a finding choice missing a field',
    args: withFinding(finding({ choices: [{ text: 'A' }] })),
    expected:
      'Finding 1: choices[1] missing reason. Each choice takes text and ' +
      'reason, and an optional action.',
  },
  {
    name: 'a finding choice with an unknown field',
    args: withFinding(
      finding({ choices: [{ text: 'A', reason: 'R', why: 'x' }] }),
    ),
    expected:
      'Finding 1: choices[1] unknown field(s) why. Each choice takes text ' +
      'and reason, and an optional action.',
  },
  {
    name: 'a choice opening with an action label',
    args: withFinding(
      finding({ choices: [{ text: 'Fix now: patch it', reason: 'R' }] }),
    ),
    expected:
      'Finding 1: choices[1].text opens with "Fix now", an action. A choice ' +
      'names a solution; its action field sets the action it sits under.',
  },
  {
    name: 'finding choices that are not a list',
    args: withFinding(finding({ choices: 'x' })),
    expected:
      'Finding 1: choices must be a list of objects, each with text and ' +
      'reason.',
  },
  {
    name: 'a finding with a choice count its origin refuses',
    args: withFinding(finding({ choices: [] })),
    expected: 'Finding 1: a caused finding takes 1 to 9 choices.',
  },
  {
    name: 'a finding with no fix_now choice',
    args: withFinding(
      finding({ choices: [{ text: 'A', reason: 'R', action: 'follow_up' }] }),
    ),
    expected:
      'Finding 1: no choice has action fix_now. A finding needs at least one ' +
      'fix_now choice; a choice with no action is fix_now.',
  },
  {
    name: 'a finding with more entries than number keys',
    args: withFinding(
      finding({
        choices: Array.from({ length: MAX_ENTRIES }, (_, i) => ({
          text: `Option ${i + 1}`,
          reason: 'R',
        })),
      }),
    ),
    expected:
      'Finding 1: the card would number 11 entries — its choices plus a ' +
      'header for each action with no choices — and the page has 9 number ' +
      'keys. Give fewer choices, or move a fix_now choice under an action ' +
      'drawn as a header, which the choice replaces.',
  },
  {
    name: 'an unknown origin',
    args: withFinding(finding({ origin: 'bug' })),
    expected:
      "Finding 1: origin must be one of 'caused', 'pre_existing', 'design', " +
      "and 'nit'.",
  },
  {
    name: 'a severity on an origin without one',
    args: withFinding(finding({ origin: 'design' })),
    expected:
      'Finding 1: severity is only for a caused or pre_existing finding.',
  },
  {
    name: 'a caused finding with no severity',
    args: withFinding(without(finding(), 'severity')),
    expected: 'Finding 1: a caused finding needs severity.',
  },
  {
    name: 'an unknown severity',
    args: withFinding(finding({ severity: 'huge' })),
    expected:
      "Finding 1: severity must be one of 'critical', 'important', and " +
      "'minor'.",
  },
  {
    name: 'a recommend_action outside the three',
    args: withFinding(finding({ recommend_action: 'later' })),
    expected:
      "Finding 1: recommend_action must be one of 'fix_now', 'follow_up', " +
      "and 'leave_it'.",
  },
  {
    name: 'a recommend_action the origin does not offer',
    args: withFinding(nitFinding({ recommend_action: 'follow_up' })),
    expected: 'Finding 1: a nit finding offers fix_now or leave_it.',
  },
  {
    name: 'action_reasons that are not an object',
    args: withFinding(finding({ action_reasons: 'x' })),
    expected:
      'Finding 1: action_reasons must be an object with follow_up, leave_it ' +
      'or both.',
  },
  {
    name: 'an unknown action_reasons key',
    args: withFinding(finding({ action_reasons: { fix_now: 'x' } })),
    expected:
      'Finding 1: action_reasons unknown key(s) fix_now. It takes follow_up ' +
      'and leave_it, the deferral actions.',
  },
  {
    name: 'an action reason for an action the origin does not offer',
    args: withFinding(nitFinding({ action_reasons: { follow_up: 'x' } })),
    expected:
      'Finding 1: action_reasons.follow_up is for an action a nit finding ' +
      'does not offer; it offers fix_now or leave_it.',
  },
  {
    name: 'a missing recommend when the action has choices',
    args: withFinding(without(finding(), 'recommend')),
    expected:
      'Finding 1: missing recommend. recommend_action is fix_now, which has ' +
      'choices, so recommend names one of them; leave recommend out only ' +
      'when recommend_action has no choices.',
  },
  {
    name: 'a recommend when the action has no choices',
    args: withFinding(finding({ recommend_action: 'leave_it' })),
    expected:
      'Finding 1: recommend names a choice, but no choice has action ' +
      'leave_it, the recommend_action. Leave recommend out when the ' +
      'recommended action has no choices.',
  },
  {
    name: "a recommend on another action's choice",
    args: withFinding(
      finding({
        choices: [
          { text: 'Fix it now', reason: 'It is one line.' },
          {
            text: 'Keep the cache',
            reason: 'Reloads are rare.',
            action: 'follow_up',
          },
        ],
        recommend: 2,
      }),
    ),
    expected:
      'Finding 1: recommend is 2, a follow_up choice, but recommend_action ' +
      'is fix_now. recommend names a choice of the recommended action.',
  },
  {
    name: 'a finding that is not an object',
    args: withFinding('x'),
    expected: 'Finding 1: each finding must be an object.',
  },
  {
    name: 'a finding missing fields',
    args: withFinding({ title: 'T' }),
    expected:
      'Finding 1: missing choices, finding, impact, origin, ' +
      'recommend_action. Every finding needs title, origin, impact, finding, ' +
      'choices, recommend_action; a caused or pre_existing finding also ' +
      'needs severity, and a nit finding also needs proof.',
  },
  {
    name: 'a nit finding with no proof',
    args: withFinding(without(nitFinding(), 'proof')),
    expected: 'Finding 1: a nit finding needs proof.',
  },
  {
    name: 'a proof that is not a string',
    args: withFinding(finding({ proof: 3 })),
    expected: 'Finding 1: proof must be a string.',
  },
  {
    name: 'a finding with an unknown field',
    args: withFinding(finding({ notes: 'x' })),
    expected:
      'Finding 1: unknown field(s) notes. The form draws the not-applicable ' +
      'control and the Notes box itself; do not describe them.',
  },
  // The shared helpers' other prefix.
  {
    name: 'a blank item field',
    args: withQuestion(question({ title: '' })),
    expected:
      'Question 1: title must be a non-empty string. Give it the text you ' +
      'would have written in the reply.',
  },
  {
    name: 'a blank item layout',
    args: withQuestion(question({ layout: '  ' })),
    expected: 'Question 1: layout must be a layout name: a non-empty string.',
  },
  {
    name: 'an unknown item layout',
    args: withQuestion(question({ layout: 'dense' })),
    expected:
      "Question 1: layout 'dense' is not in the layouts folder, which holds " +
      "'default' and 'compact'. Write dense/layout.js there first, or leave " +
      'layout out.',
  },
];

// Parsed in each test, once the built-in origins are registered.
function sampleRound() {
  return parseRound(BUILT_IN_KINDS, {
    heading: 'Cache review',
    overview: 'Reviewing the cache.',
    notices: [notice()],
    findings: [finding()],
    questions: [question(), question({ title: 'Second' })],
  });
}

const ANSWERED: FormBody = {
  note: 'All good',
  answers: [
    {
      index: 1,
      choice: 1,
      not_applicable: false,
      notes: '',
      dont_ask: false,
      dont_ask_reason: '',
    },
    {
      index: 2,
      choice: 0,
      not_applicable: true,
      notes: 'later',
      dont_ask: false,
      dont_ask_reason: '',
    },
  ],
  finding_answers: [
    {
      index: 1,
      choice: 1,
      action: 'fix_now',
      not_applicable: false,
      notes: '',
      dont_ask: true,
      dont_ask_reason: 'obvious',
      action_label: 'Fix now',
      recommend_action_label: 'Fix now',
    },
  ],
  notice_comments: [{ index: 1, comment: 'looks right' }],
};

const NOTICES_ROUND = parseRound(BUILT_IN_KINDS, {
  heading: 'Notes',
  notices: [notice()],
});

const NOTICE_RESULT = {
  index: 1,
  title: 'Renamed the stale helper',
  badge: 'Applied',
};

const UNTOUCHED_QUESTIONS = [
  {
    index: 1,
    title: 'Naming',
    status: 'untouched',
    choice: 0,
    choice_text: '',
    took_recommendation: false,
  },
  {
    index: 2,
    title: 'Second',
    status: 'untouched',
    choice: 0,
    choice_text: '',
    took_recommendation: false,
  },
];

const UNTOUCHED_FINDINGS = [
  {
    index: 1,
    title: 'Stale cache',
    status: 'untouched',
    choice: 0,
    choice_text: '',
    took_recommendation: false,
    action: '',
    took_action_recommendation: false,
  },
];

// The answered body's lists and note, as every finished round returns them.
const ANSWERED_LISTS = {
  answers: [
    {
      index: 1,
      title: 'Naming',
      status: 'answered',
      choice: 1,
      choice_text: 'module_a',
      took_recommendation: true,
    },
    {
      index: 2,
      title: 'Second',
      status: 'not_applicable',
      choice: 0,
      choice_text: '',
      took_recommendation: false,
      notes: 'later',
    },
  ],
  findings: [
    {
      index: 1,
      title: 'Stale cache',
      status: 'answered',
      choice: 1,
      choice_text: 'Fix it now',
      took_recommendation: true,
      action: 'fix_now',
      took_action_recommendation: true,
      dont_ask: true,
      dont_ask_reason: 'obvious',
    },
  ],
  notices: [{ ...NOTICE_RESULT, comment: 'looks right' }],
  note: 'All good',
};

const ANSWERED_SUMMARY =
  '1 finding, 2 questions: 2 answered, 1 not applicable, 0 untouched.';

const DRAFT_LISTS = {
  answers: UNTOUCHED_QUESTIONS,
  findings: UNTOUCHED_FINDINGS,
  notices: [NOTICE_RESULT],
};

const DRAFT_SUMMARY =
  '1 finding, 2 questions: 0 answered, 0 not applicable, 3 untouched. The ' +
  'form is still open.';

function notShownNext(other: string): string {
  return (
    `The user has not finished ${other} in the app, so this round was not ` +
    'opened and has no answers. Send this round again with ask_round, and ' +
    `again after every draft like this one. Once the user finishes ${other}, ` +
    "a send may return that round's answers instead, marked with " +
    `earlier_heading: act on them, then send this round again. If ${other} ` +
    'is no longer needed, ask the user to cancel it in the app. Do not call ' +
    "collect_last_round for this round: that returns the other round's " +
    'answers.'
  );
}

interface PayloadRow {
  name: string;
  payload: () => AnswersPayload;
  // Stringified here exactly as the tool session does, so key order and
  // spacing are pinned along with the values.
  expected: object;
}

const PAYLOAD_ROWS: PayloadRow[] = [
  {
    name: 'a submitted round',
    payload: () =>
      roundType.payload(sampleRound(), 'submitted', ANSWERED, false),
    expected: {
      outcome: 'submitted',
      summary: ANSWERED_SUMMARY,
      next: '',
      ...ANSWERED_LISTS,
    },
  },
  {
    name: 'a cancelled round',
    payload: () =>
      roundType.payload(sampleRound(), 'cancelled', ANSWERED, false),
    expected: {
      outcome: 'cancelled',
      summary: ANSWERED_SUMMARY,
      next: '',
      ...ANSWERED_LISTS,
    },
  },
  {
    name: 'a draft',
    payload: () =>
      roundType.payload(
        sampleRound(),
        'draft',
        readFormBody(BUILT_IN_KINDS, sampleRound(), {}),
        false,
      ),
    expected: {
      outcome: 'draft',
      summary: DRAFT_SUMMARY,
      next:
        'The user has not submitted yet. Call collect_last_round to keep ' +
        'waiting. Do not re-ask these questions and do not open a second ' +
        'round.',
      ...DRAFT_LISTS,
    },
  },
  {
    name: "an earlier round's answers",
    payload: () =>
      roundType.handedBackPayload(sampleRound(), 'submitted', ANSWERED, false),
    expected: {
      outcome: 'submitted',
      summary: ANSWERED_SUMMARY,
      next:
        "These answers are for an earlier round, 'Cache review', that you " +
        "never received. Read them as that round's answers. The round you " +
        'just sent was not opened: send it again with ask_round.',
      ...ANSWERED_LISTS,
      earlier_heading: 'Cache review',
    },
  },
  {
    name: 'no round',
    payload: () => roundType.noFormPayload(),
    expected: {
      outcome: 'no_round',
      summary: 'No round is open.',
      next:
        'No round is open for this session, and no finished answers are ' +
        'waiting for it. If you sent a round whose answers you never ' +
        'received, send the same round again with ask_round: the ' +
        "user's saved answers fill in. Do not move the questions into the " +
        'reply.',
      answers: [],
      findings: [],
      notices: [],
    },
  },
  {
    name: 'a round not shown behind a named round',
    payload: () => roundType.notShownPayload(sampleRound(), 'Other round'),
    expected: {
      outcome: 'draft',
      summary:
        "This round, 'Cache review', was not shown: the round 'Other round' " +
        'is still open in the app.',
      next: notShownNext("the round 'Other round'"),
      ...DRAFT_LISTS,
    },
  },
  {
    name: 'a round not shown behind an unnamed round',
    payload: () => roundType.notShownPayload(sampleRound(), null),
    expected: {
      outcome: 'draft',
      summary:
        "This round, 'Cache review', was not shown: another round is still " +
        'open in the app.',
      next: notShownNext('another round'),
      ...DRAFT_LISTS,
    },
  },
  {
    name: 'an auto-answered round',
    payload: () =>
      autoAnsweredPayload(
        BUILT_IN_KINDS,
        sampleRound(),
        recommendedBody(BUILT_IN_KINDS, sampleRound()),
      ),
    expected: {
      outcome: 'auto_answered',
      summary:
        '1 finding, 2 questions: 3 answered, 0 not applicable, 0 untouched.',
      next:
        'This session is headless until a tool result says the session is ' +
        'no longer headless: the app showed no form and answered every item ' +
        'with its recommendation. Build no more rounds, and list every pick ' +
        'as a Decided notice in your reply. An auto-answered pick never ' +
        "approves an action that needs the user's own yes (an install, a " +
        "step that deletes the user's data, a push, or any action the " +
        "user's rules gate): name what it needs in the reply and end the " +
        'turn.',
      answers: [
        {
          index: 1,
          title: 'Naming',
          status: 'answered',
          choice: 1,
          choice_text: 'module_a',
          took_recommendation: true,
        },
        {
          index: 2,
          title: 'Second',
          status: 'answered',
          choice: 1,
          choice_text: 'module_a',
          took_recommendation: true,
        },
      ],
      findings: [
        {
          index: 1,
          title: 'Stale cache',
          status: 'answered',
          choice: 1,
          choice_text: 'Fix it now',
          took_recommendation: true,
          action: 'fix_now',
          took_action_recommendation: true,
        },
      ],
      notices: [NOTICE_RESULT],
    },
  },
  {
    name: 'a submitted notices-only round',
    payload: () =>
      roundType.payload(
        NOTICES_ROUND,
        'submitted',
        readFormBody(BUILT_IN_KINDS, NOTICES_ROUND, {}),
        false,
      ),
    expected: {
      outcome: 'submitted',
      summary: '0 questions: 0 answered, 0 not applicable, 0 untouched.',
      next: '',
      answers: [],
      findings: [],
      notices: [NOTICE_RESULT],
    },
  },
];

describe('round wire text', () => {
  it.each(ERROR_ROWS)('words $name as today', async ({ args, expected }) => {
    const result = await callOpen(async () => {
      requireKnownLayouts(
        BUILT_IN_KINDS,
        parseRound(BUILT_IN_KINDS, args),
        LAYOUT_NAMES,
      );
      throw new Error('the round parsed');
    });

    expect(result.content[0].text).toBe(expected);
    expect(result.isError).toBe(true);
  });

  it.each(PAYLOAD_ROWS)(
    'returns $name as today',
    async ({ payload, expected }) => {
      const result = await callOpen(async () => payload());

      expect(result.content[0].text).toBe(JSON.stringify(expected, null, 2));
    },
  );

  it('publishes the round tools as today', async () => {
    await expect(
      JSON.stringify(formsTools(BUILT_IN_KINDS), null, 2),
    ).toMatchFileSnapshot('./forms-tools.golden.txt');
  });

  it('words an item of a kind no registered kind has by its id', () => {
    const error = new RoundError({
      path: { at: 'item', kind: 'gone', number: 1 },
      problem: 'is malformed.',
    });

    expect(roundErrorText(BUILT_IN_KINDS, error)).toBe('gone 1: is malformed.');
  });

  // Breaks if a registered kind's RoundError rejected the call instead of
  // reaching the agent as its repair text.
  it("returns a registered kind's malformed item as an error result", async () => {
    const kinds = [...BUILT_IN_KINDS, pollKind];
    const session: AgentFormSession<AnswersPayload> = {
      open: async (args) => {
        parseRound(kinds, args);
        throw new Error('the round parsed');
      },
      collect: () => Promise.reject(new Error('collect is not called here')),
      end: () => {},
    };

    const result = await createAgentFormToolSession(
      session,
      createRoundType(() => kinds),
    ).call('ask_round', { heading: 'H', polls: [{}] }, context());

    expect(result).toEqual({
      content: [{ type: 'text', text: 'Poll 1: each poll needs a title.' }],
      isError: true,
    });
  });
});
