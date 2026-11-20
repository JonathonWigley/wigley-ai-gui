import { describe, expect, it } from 'vitest';
import {
  type AnswerEntry,
  type AnswersPayload,
  type Finding,
  type FindingAnswerEntry,
  type FormBody,
  type MainItemKind,
  type Notice,
  type Question,
  RoundError,
} from '../contract';
import { findingOrigins } from '../finding-origins';
import {
  SECURITY_ORIGIN,
  useBuiltInFindingOrigins,
} from '../finding-origins.test-support';
import { BUILT_IN_KINDS } from './kinds/formats';
import { POLL, pollKind } from './kinds/poll-kind.test-support';
import { createKindRegistry } from './kinds/registry';
import { roundErrorText, roundPayload } from './mcp-wording';
import {
  answersResult,
  fingerprint,
  handedBackResult,
  noRoundResult,
  notShownResult,
  parseRound,
  readFormBody,
  recommendedBody,
  requireKnownLayouts,
} from './round';
import { autoAnsweredPayload, createRoundType } from './round-type';

const roundType = createRoundType(() => BUILT_IN_KINDS);

useBuiltInFindingOrigins();

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

function answer(entry: Partial<AnswerEntry>): AnswerEntry {
  return {
    index: 1,
    choice: 0,
    not_applicable: false,
    notes: '',
    dont_ask: false,
    dont_ask_reason: '',
    ...entry,
  };
}

// A design finding, recommending fix_now on its first choice.
function decisionFinding(overrides: Record<string, unknown> = {}) {
  const { severity: _severity, ...rest } = finding({
    origin: 'design',
    ...overrides,
  });
  return rest;
}

// The labels default to a caused finding recommending fix_now, unpicked.
function findingAnswer(entry: Partial<FindingAnswerEntry>): FindingAnswerEntry {
  return {
    ...answer(entry),
    action: '',
    action_label: '',
    recommend_action_label: 'Fix now',
    ...entry,
  };
}

function body(answers: AnswerEntry[], extra: Partial<FormBody> = {}): FormBody {
  return {
    note: '',
    answers,
    finding_answers: [],
    notice_comments: [],
    ...extra,
  };
}

function roundOf(count: number, overrides: Record<string, unknown> = {}) {
  return parseRound(BUILT_IN_KINDS, {
    heading: 'H',
    questions: Array.from({ length: count }, () => question(overrides)),
  });
}

// A round of every built-in kind with every field explicit, so no default
// joins its fingerprint.
const ALL_KINDS_ARGS = {
  heading: 'Ignored',
  overview: 'Ignored',
  notices: [{ title: 'Renamed', context: 'done', badge: 'Applied' }],
  findings: [
    {
      title: 'Leak',
      origin: 'caused',
      severity: 'important',
      impact: 'Memory grows.',
      finding: 'The cache never empties.',
      proof: '- cache.ts:10',
      choices: [{ text: 'Clear the cache on close', reason: 'Frees memory.' }],
      recommend: 1,
      recommend_action: 'fix_now',
    },
  ],
  questions: [
    {
      title: 'Naming',
      summary: 'Which name?',
      context: 'ctx',
      choices: ['a', 'b'],
      recommend: 1,
      rationale: 'r',
    },
  ],
};

// The tool error text of the RoundError parseRound throws for these args.
function roundError(args: unknown): string {
  try {
    parseRound(BUILT_IN_KINDS, args);
  } catch (error) {
    if (error instanceof RoundError) {
      return roundErrorText(BUILT_IN_KINDS, error);
    }
    throw error;
  }
  throw new Error('parseRound accepted the round');
}

// A round of the built-in kinds parsed, with each kind's items as its own list.
function parseBuiltIn(args: unknown) {
  const round = parseRound(BUILT_IN_KINDS, args);
  return {
    ...round,
    questions: (round.items.question ?? []) as Question[],
    notices: (round.items.notice ?? []) as Notice[],
    findings: (round.items.finding ?? []) as Finding[],
  };
}

describe('parseRound', () => {
  it("fills each registered kind's items and bodyKey by its id", () => {
    const kinds = [...BUILT_IN_KINDS, pollKind];
    const round = parseRound(kinds, {
      heading: 'H',
      polls: [],
      questions: [question()],
    });

    expect(Object.keys(round.items)).toEqual(kinds.map((kind) => kind.spec.id));
    expect(round.items.notice).toEqual([]);
    expect(round.bodyKeys).toEqual(
      Object.fromEntries(
        kinds.map((kind) => [kind.spec.id, kind.spec.bodyKey]),
      ),
    );
  });

  it('keeps a valid two-question round in order', () => {
    const round = parseBuiltIn({
      heading: 'Naming decisions',
      questions: [
        question({ title: 'First', summary: 'Pick the first name.' }),
        question({ title: 'Second', summary: 'Pick the second name.' }),
      ],
    });

    expect(round.heading).toBe('Naming decisions');
    expect(round.questions.map((each) => each.title)).toEqual([
      'First',
      'Second',
    ]);
    expect(round.questions[1].summary).toBe('Pick the second name.');
    expect(round.layout).toBeNull();
    expect(round.questions.map((each) => each.layout)).toEqual([null, null]);
  });

  it('reads an absent or null layout as null on the round', () => {
    expect(parseBuiltIn({ heading: 'H', questions: [question()] }).layout).toBe(
      null,
    );
    expect(
      parseBuiltIn({
        heading: 'H',
        layout: null,
        questions: [question()],
      }).layout,
    ).toBe(null);
  });

  it('keeps a round layout as sent', () => {
    expect(
      parseBuiltIn({
        heading: 'H',
        layout: ' compact',
        questions: [question()],
      }).layout,
    ).toBe(' compact');
  });

  it('refuses a blank round layout', () => {
    expect(
      roundError({ heading: 'H', layout: '  ', questions: [question()] }),
    ).toContain('layout');
  });

  it.each([['not a dict'], [['a list']], [null]])(
    'names every top-level field when args are not an object (%j)',
    (args) => {
      const message = roundError(args);

      expect(message).toContain(
        "'heading', 'overview', 'layout', 'notices', 'findings', and 'questions'",
      );
    },
  );

  it('refuses an unknown top-level field', () => {
    const message = roundError({
      heading: 'H',
      questions: [question()],
      extra: 1,
    });

    expect(message).toContain('extra');
  });

  it('refuses an empty heading', () => {
    const message = roundError({ heading: '', questions: [question()] });

    expect(message).toMatch(/^heading\b/);
  });

  it('keeps the overview stripped', () => {
    const round = parseBuiltIn({
      heading: 'H',
      overview: '  Refactoring X. This round: names.  ',
      questions: [question()],
    });

    expect(round.overview).toBe('Refactoring X. This round: names.');
  });

  it('parses a round with no overview, so older saved rounds rebuild', () => {
    expect(
      parseBuiltIn({ heading: 'H', questions: [question()] }).overview,
    ).toBe('');
  });

  it('refuses a non-string overview', () => {
    const message = roundError({
      heading: 'H',
      overview: ['a'],
      questions: [question()],
    });

    expect(message).toContain('overview');
  });

  it.each(['notices', 'findings', 'questions'])(
    'refuses %s that are not a list',
    (key) => {
      expect(roundError({ heading: 'H', [key]: 'one item' })).toContain(key);
    },
  );
});

describe('parseRound with notices', () => {
  it('parses notices alone, with no questions', () => {
    const round = parseBuiltIn({
      heading: 'H',
      notices: [notice()],
    });

    expect(round.questions).toEqual([]);
    expect(round.notices.map((each) => each.title)).toEqual([
      'Renamed the stale helper',
    ]);
  });

  it('parses notices and questions together', () => {
    const round = parseBuiltIn({
      heading: 'H',
      questions: [question()],
      notices: [notice(), notice({ title: 'Second fix' })],
    });

    expect(round.questions).toHaveLength(1);
    expect(round.notices[1].title).toBe('Second fix');
  });

  it('reads omitted or null notices and questions as none', () => {
    expect(
      parseBuiltIn({ heading: 'H', questions: [question()] }).notices,
    ).toEqual([]);
    expect(
      parseBuiltIn({
        heading: 'H',
        questions: null,
        notices: [notice()],
      }).questions,
    ).toEqual([]);
  });

  it.each([
    [{ heading: 'H', questions: [], notices: [] }],
    [{ heading: 'H' }],
    [{ heading: 'H', questions: [], findings: [], notices: [] }],
  ])('refuses a round with no item of any kind (%j)', (args) => {
    expect(roundError(args)).toMatch(/notice.*finding.*question/);
  });

  it.each(['Dispatched', 'Decided'])('accepts the %s badge', (badge) => {
    const round = parseBuiltIn({
      heading: 'H',
      notices: [notice({ badge })],
    });

    expect(round.notices[0].badge).toBe(badge);
  });
});

describe('parseRound with findings', () => {
  it('parses findings beside questions and notices, in their own array', () => {
    const round = parseBuiltIn({
      heading: 'H',
      questions: [question()],
      findings: [finding()],
      notices: [notice()],
    });

    expect(round.findings[0].title).toBe('Stale cache');
    expect(round.findings[0].choices[1]).toEqual({
      text: 'Keep the cache',
      reason: 'Reloads are rare.',
      action: 'fix_now',
    });
    expect(round.findings[0].actionReasons).toEqual({});
    expect(round.findings[0].layout).toBeNull();
    expect(round.notices[0].layout).toBeNull();
    expect(round.questions).toHaveLength(1);
    expect(round.notices).toHaveLength(1);
  });

  it('parses findings alone', () => {
    const round = parseBuiltIn({
      heading: 'H',
      findings: [finding()],
    });

    expect(round.findings).toHaveLength(1);
    expect(round.questions).toEqual([]);
    expect(round.notices).toEqual([]);
  });

  it('reads omitted or null findings as none', () => {
    expect(
      parseBuiltIn({ heading: 'H', questions: [question()] }).findings,
    ).toEqual([]);
    expect(
      parseBuiltIn({
        heading: 'H',
        questions: [question()],
        findings: null,
      }).findings,
    ).toEqual([]);
  });

  it("numbers a finding's errors from 1", () => {
    const partial: Record<string, unknown> = finding();
    delete partial.impact;

    expect(
      roundError({ heading: 'H', findings: [finding(), partial] }),
    ).toMatch(/^Finding 2: .*impact/);
  });
});

describe('requireKnownLayouts', () => {
  const LAYOUTS = ['default', 'compact'];

  // The tool error text of the RoundError requireKnownLayouts throws for
  // these args.
  function layoutError(args: unknown): string {
    try {
      requireKnownLayouts(
        BUILT_IN_KINDS,
        parseRound(BUILT_IN_KINDS, args),
        LAYOUTS,
      );
    } catch (error) {
      if (error instanceof RoundError) {
        return roundErrorText(BUILT_IN_KINDS, error);
      }
      throw error;
    }
    throw new Error('requireKnownLayouts accepted the round');
  }

  it('passes a round whose every layout the folder holds', () => {
    const round = parseRound(BUILT_IN_KINDS, {
      heading: 'H',
      layout: 'compact',
      questions: [question({ layout: 'default' })],
      findings: [finding({ layout: 'compact' })],
      notices: [notice()],
    });

    expect(() =>
      requireKnownLayouts(BUILT_IN_KINDS, round, LAYOUTS),
    ).not.toThrow();
  });

  it("refuses an unknown round layout, listing the folder's layouts", () => {
    expect(
      layoutError({ heading: 'H', layout: 'dense', questions: [question()] }),
    ).toMatch(/^ask_round.*'dense'.*'default'.*'compact'/);
  });

  it('refuses an unknown item layout, naming the item', () => {
    expect(
      layoutError({
        heading: 'H',
        findings: [finding(), finding({ layout: 'dense' })],
      }),
    ).toMatch(/^Finding 2: .*'dense'.*'default'.*'compact'/);
  });

  it('names the round before its items', () => {
    const message = layoutError({
      heading: 'H',
      layout: 'wide',
      notices: [notice({ layout: 'dense' })],
    });

    expect(message).toMatch(/^ask_round.*'wide'/);
  });
});

describe('readFormBody', () => {
  it('reads one entry per question by index, with defaults where none was saved', () => {
    const round = roundOf(2);

    const read = readFormBody(BUILT_IN_KINDS, round, {
      note: 'n',
      answers: [{ index: 2, choice: 1, notes: 'w' }],
    });

    expect(read).toEqual(
      body(
        [answer({ index: 1 }), answer({ index: 2, choice: 1, notes: 'w' })],
        {
          note: 'n',
        },
      ),
    );
  });

  it("joins an old file's what and why as notes, with a blank line", () => {
    const read = readFormBody(BUILT_IN_KINDS, roundOf(1), {
      answers: [{ index: 1, what: 'mine', why: 'because' }],
    });

    expect(read.answers).toEqual([answer({ notes: 'mine\n\nbecause' })]);
  });

  it("reads an old file's lone what or lone why as notes", () => {
    const lone = (entry: Record<string, unknown>) =>
      readFormBody(BUILT_IN_KINDS, roundOf(1), {
        answers: [{ index: 1, ...entry }],
      }).answers[0].notes;

    expect(lone({ what: 'mine', why: '' })).toBe('mine');
    expect(lone({ why: 'because' })).toBe('because');
  });

  it('prefers a notes key over what and why, even when empty', () => {
    const read = readFormBody(BUILT_IN_KINDS, roundOf(1), {
      answers: [{ index: 1, notes: '', what: 'old' }],
    });

    expect(read.answers).toEqual([answer({ notes: '' })]);
  });

  it('reads one finding answer per finding by index', () => {
    const round = parseRound(BUILT_IN_KINDS, {
      heading: 'H',
      findings: [finding(), finding({ title: 'Dead branch' })],
    });

    const read = readFormBody(BUILT_IN_KINDS, round, {
      finding_answers: [{ index: 2, choice: 1, notes: 'n' }],
    });

    expect(read.finding_answers).toEqual([
      findingAnswer({ index: 1 }),
      findingAnswer({ index: 2, choice: 1, notes: 'n' }),
    ]);
  });

  it('reads a body with no finding_answers as untouched findings', () => {
    const round = parseRound(BUILT_IN_KINDS, {
      heading: 'H',
      findings: [finding()],
    });

    expect(readFormBody(BUILT_IN_KINDS, round, {}).finding_answers).toEqual([
      findingAnswer({ index: 1 }),
    ]);
  });

  it("keeps a finding's saved action", () => {
    const round = parseRound(BUILT_IN_KINDS, {
      heading: 'H',
      findings: [finding()],
    });

    const read = readFormBody(BUILT_IN_KINDS, round, {
      finding_answers: [{ index: 1, choice: 2, action: 'follow_up' }],
    });

    expect(read.finding_answers[0].action).toBe('follow_up');
  });

  it('reads a finding entry with no action, or an unknown one, as none', () => {
    const round = parseRound(BUILT_IN_KINDS, {
      heading: 'H',
      findings: [finding(), finding({ title: 'Dead branch' })],
    });

    const read = readFormBody(BUILT_IN_KINDS, round, {
      finding_answers: [
        { index: 1, choice: 2 },
        { index: 2, choice: 1, action: 'Fix now' },
      ],
    });

    expect(read.finding_answers.map((entry) => entry.action)).toEqual(['', '']);
  });

  it('keeps a pressed answer with its reason', () => {
    const read = readFormBody(BUILT_IN_KINDS, roundOf(1), {
      answers: [
        { index: 1, choice: 2, dont_ask: true, dont_ask_reason: 'settle it' },
      ],
    });

    expect(read.answers).toEqual([
      answer({ choice: 2, dont_ask: true, dont_ask_reason: 'settle it' }),
    ]);
  });

  it('reads a non-boolean press and a non-string reason as unpressed', () => {
    const read = readFormBody(BUILT_IN_KINDS, roundOf(1), {
      answers: [{ index: 1, choice: 1, dont_ask: 'true', dont_ask_reason: 7 }],
    });

    expect(read.answers).toEqual([answer({ choice: 1 })]);
  });

  it('keeps the choice number of a not-applicable answer', () => {
    const read = readFormBody(BUILT_IN_KINDS, roundOf(1), {
      answers: [{ index: 1, choice: 2, not_applicable: true }],
    });

    expect(read.answers).toEqual([answer({ choice: 2, not_applicable: true })]);
  });

  it.each([[true], ['2'], [1.5]])(
    'reads a choice of %j as no choice',
    (choice) => {
      const read = readFormBody(BUILT_IN_KINDS, roundOf(1), {
        answers: [{ index: 1, choice }],
      });

      expect(read.answers[0].choice).toBe(0);
    },
  );

  it('reads notice comments by index and gives an absent one an empty comment', () => {
    const round = parseRound(BUILT_IN_KINDS, {
      heading: 'H',
      notices: [notice(), notice({ title: 'Second' })],
    });

    const read = readFormBody(BUILT_IN_KINDS, round, {
      notice_comments: [{ index: 2, comment: 'check this' }],
    });

    expect(read.notice_comments).toEqual([
      { index: 1, comment: '' },
      { index: 2, comment: 'check this' },
    ]);
  });

  it.each([
    {
      name: 'a follow_up choice as Plan it',
      saved: { choice: 2, action: 'follow_up' },
      label: 'Plan it',
    },
    { name: 'no pick as none', saved: {}, label: '' },
    {
      name: 'an incomplete pick as none',
      saved: { choice: 2, action: 'fix_now' },
      label: '',
    },
    {
      name: 'a saved label it ignores',
      saved: { action_label: 'x', recommend_action_label: 'y' },
      label: '',
    },
  ])(
    "writes each finding entry's action_label from its pick: $name",
    ({ saved, label }) => {
      const round = parseRound(BUILT_IN_KINDS, {
        heading: 'H',
        findings: [
          decisionFinding({
            choices: [
              { text: 'Cache per user', reason: 'Users differ.' },
              {
                text: 'Cache per machine',
                reason: 'Machines differ.',
                action: 'follow_up',
              },
            ],
          }),
        ],
      });

      const [entry] = readFormBody(BUILT_IN_KINDS, round, {
        finding_answers: [{ index: 1, ...saved }],
      }).finding_answers;

      expect(entry.action_label).toBe(label);
      expect(entry.recommend_action_label).toBe('Decide now');
    },
  );

  it('reads a body and payload of a round whose origin was disposed as before', () => {
    const registration = findingOrigins.register(SECURITY_ORIGIN);
    const round = parseRound(BUILT_IN_KINDS, {
      heading: 'H',
      findings: [
        finding({
          origin: 'security',
          choices: [
            { text: 'Escape the input', reason: 'Closes the hole.' },
            { text: 'Log it', reason: 'Later.', action: 'leave_it' },
          ],
        }),
      ],
    });
    const saved = {
      finding_answers: [{ index: 1, choice: 2, action: 'leave_it' }],
    };
    const before = {
      body: readFormBody(BUILT_IN_KINDS, round, saved),
      payload: roundType.payload(
        round,
        'submitted',
        readFormBody(BUILT_IN_KINDS, round, saved),
      ),
    };

    registration.dispose();

    expect(readFormBody(BUILT_IN_KINDS, round, saved)).toEqual(before.body);
    expect(before.body.finding_answers[0].action_label).toBe('Accept');
    expect(
      roundType.payload(
        round,
        'submitted',
        readFormBody(BUILT_IN_KINDS, round, saved),
      ),
    ).toEqual(before.payload);
  });

  it('reads a body that is not an object as untouched', () => {
    expect(readFormBody(BUILT_IN_KINDS, roundOf(1), 'junk')).toEqual(
      body([answer({})]),
    );
  });

  // Breaks if the key order or an entry's fields drift, so a saved file read
  // back and saved again would change.
  it('writes a saved body back byte for byte', () => {
    const round = parseRound(BUILT_IN_KINDS, ALL_KINDS_ARGS);
    const text =
      '{"note":"n","answers":[{"index":1,"choice":2,"not_applicable":false,' +
      '"notes":"","dont_ask":false,"dont_ask_reason":""}],' +
      '"finding_answers":[{"index":1,"choice":1,"not_applicable":false,' +
      '"notes":"","dont_ask":false,"dont_ask_reason":"","action":"fix_now",' +
      '"action_label":"Fix now","recommend_action_label":"Fix now"}],' +
      '"notice_comments":[{"index":1,"comment":"ok"}]}';

    expect(
      JSON.stringify(readFormBody(BUILT_IN_KINDS, round, JSON.parse(text))),
    ).toBe(text);
  });
});

describe('roundType.payload', () => {
  it('builds the whole payload for a submitted round', () => {
    const round = parseRound(BUILT_IN_KINDS, {
      heading: 'Interview architecture',
      questions: [
        question({ title: 'Alpha', choices: ['a', 'b', 'c'], recommend: 1 }),
        question({ title: 'Beta', choices: ['x', 'y'], recommend: 2 }),
        question({ title: 'Gamma', choices: ['p', 'q'], recommend: 1 }),
      ],
    });

    const payload = roundType.payload(
      round,
      'submitted',
      body([
        answer({ index: 1, choice: 1, notes: 'Went with a' }),
        answer({
          index: 2,
          not_applicable: true,
          notes: "Validation doesn't apply here",
        }),
        answer({ index: 3 }),
      ]),
    );

    expect(payload).toEqual({
      outcome: 'submitted',
      summary: '3 questions: 1 answered, 1 not applicable, 1 untouched.',
      next: '',
      answers: [
        {
          index: 1,
          title: 'Alpha',
          status: 'answered',
          choice: 1,
          choice_text: 'a',
          took_recommendation: true,
          notes: 'Went with a',
        },
        {
          index: 2,
          title: 'Beta',
          status: 'not_applicable',
          choice: 0,
          choice_text: '',
          took_recommendation: false,
          notes: "Validation doesn't apply here",
        },
        {
          index: 3,
          title: 'Gamma',
          status: 'untouched',
          choice: 0,
          choice_text: '',
          took_recommendation: false,
        },
      ],
      findings: [],
      notices: [],
    });
  });

  it('stays index-parallel with the questions when the body holds fewer answers', () => {
    const payload = roundType.payload(
      roundOf(3),
      'submitted',
      body([answer({ choice: 1 })]),
    );

    expect(
      payload.answers.map((each) => [each.index, each.status, each.choice]),
    ).toEqual([
      [1, 'answered', 1],
      [2, 'untouched', 0],
      [3, 'untouched', 0],
    ]);
  });

  it('reports a not-applicable answer as not_applicable, never untouched', () => {
    const payload = roundType.payload(
      roundOf(1),
      'submitted',
      body([answer({ not_applicable: true })]),
    );

    expect(payload.answers[0].status).toBe('not_applicable');
  });

  it('reports no choice for a not-applicable answer that kept its choice number', () => {
    const round = roundOf(1, { choices: ['alpha', 'beta'], recommend: 2 });

    const payload = roundType.payload(
      round,
      'submitted',
      body([answer({ choice: 2, not_applicable: true })]),
    );

    expect(payload.answers[0]).toMatchObject({
      status: 'not_applicable',
      choice: 0,
      choice_text: '',
      took_recommendation: false,
    });
  });

  it("fills choice_text from the round's own choices, and leaves it empty when unanswered", () => {
    const round = roundOf(2, { choices: ['alpha', 'beta'] });

    const payload = roundType.payload(
      round,
      'submitted',
      body([answer({ choice: 2 }), answer({ index: 2 })]),
    );

    expect(payload.answers.map((each) => each.choice_text)).toEqual([
      'beta',
      '',
    ]);
  });

  it('marks took_recommendation only when the choice is the recommended one', () => {
    const round = roundOf(2, { choices: ['alpha', 'beta'], recommend: 1 });

    const payload = roundType.payload(
      round,
      'submitted',
      body([answer({ choice: 1 }), answer({ index: 2, choice: 2 })]),
    );

    expect(payload.answers.map((each) => each.took_recommendation)).toEqual([
      true,
      false,
    ]);
  });

  it('tells a draft caller to keep waiting', () => {
    const payload = roundType.payload(roundOf(1), 'draft', body([]));

    expect(payload.next).toContain('collect_last_round');
  });

  it('counts an out-of-range choice as untouched in both the answer and the summary', () => {
    const round = roundOf(2, { choices: ['alpha', 'beta'] });

    const payload = roundType.payload(
      round,
      'submitted',
      body([answer({ choice: 99 }), answer({ index: 2, choice: 1 })]),
    );

    expect(payload.answers[0]).toMatchObject({
      status: 'untouched',
      choice: 0,
    });
    expect(payload.answers[1].status).toBe('answered');
    expect(payload.summary).toBe(
      '2 questions: 1 answered, 0 not applicable, 1 untouched.',
    );
  });

  it('sends notes with no pick as untouched, carrying the notes', () => {
    const round = parseRound(BUILT_IN_KINDS, {
      heading: 'H',
      findings: [finding()],
    });

    const payload = roundType.payload(
      round,
      'submitted',
      body([], {
        finding_answers: [findingAnswer({ notes: 'my own fix' })],
      }),
    );

    expect(payload.findings[0]).toMatchObject({
      status: 'untouched',
      choice: 0,
      notes: 'my own fix',
    });
    expect(payload.summary).toBe(
      '1 finding: 0 answered, 0 not applicable, 1 untouched.',
    );
  });

  it('sends a question with notes and no choice as untouched, carrying the notes', () => {
    const payload = roundType.payload(
      roundOf(1),
      'submitted',
      body([answer({ notes: 'neither name' })]),
    );

    expect(payload.answers[0]).toMatchObject({
      status: 'untouched',
      choice: 0,
      notes: 'neither name',
    });
  });

  it('carries no earlier_heading on an ordinary payload', () => {
    expect(
      roundType.payload(roundOf(1), 'submitted', body([])),
    ).not.toHaveProperty('earlier_heading');
  });
});

describe('roundType.payload findings', () => {
  it('returns finding answers in their own array, index-parallel with the findings', () => {
    const round = parseRound(BUILT_IN_KINDS, {
      heading: 'H',
      questions: [question()],
      findings: [
        finding({
          choices: [
            { text: 'Fix it now', reason: 'It is one line.' },
            {
              text: 'Keep the cache',
              reason: 'Reloads are rare.',
              action: 'follow_up',
            },
          ],
        }),
        finding({ title: 'Dead branch' }),
      ],
    });

    const payload = roundType.payload(
      round,
      'submitted',
      body([answer({ choice: 1 })], {
        finding_answers: [
          findingAnswer({
            index: 1,
            choice: 2,
            action: 'follow_up',
            notes: 'later',
          }),
          findingAnswer({ index: 2, not_applicable: true }),
        ],
      }),
    );

    expect(payload.findings).toEqual([
      {
        index: 1,
        title: 'Stale cache',
        status: 'answered',
        choice: 2,
        choice_text: 'Keep the cache',
        took_recommendation: false,
        action: 'follow_up',
        took_action_recommendation: false,
        notes: 'later',
      },
      {
        index: 2,
        title: 'Dead branch',
        status: 'not_applicable',
        choice: 0,
        choice_text: '',
        took_recommendation: false,
        action: '',
        took_action_recommendation: false,
      },
    ]);
    expect(payload.answers).toHaveLength(1);
    expect(payload.answers[0].title).toBe('Naming');
  });

  it("carries a Don't ask press on a finding answer", () => {
    const round = parseRound(BUILT_IN_KINDS, {
      heading: 'H',
      findings: [finding()],
    });

    const payload = roundType.payload(
      round,
      'submitted',
      body([], {
        finding_answers: [
          findingAnswer({
            choice: 1,
            action: 'fix_now',
            dont_ask: true,
            dont_ask_reason: 'obvious',
          }),
        ],
      }),
    );

    expect(payload.findings[0]).toMatchObject({
      dont_ask: true,
      dont_ask_reason: 'obvious',
      choice: 1,
    });
  });

  it.each([
    {
      shape: 'findings alone',
      args: {
        heading: 'H',
        findings: [finding(), finding({ title: 'Dead branch' })],
      },
      outcome: 'submitted',
      answers: [],
      findingAnswers: [findingAnswer({ choice: 1, action: 'fix_now' })],
      summary: '2 findings: 1 answered, 0 not applicable, 1 untouched.',
    },
    {
      shape: 'findings first, then questions, summed',
      args: {
        heading: 'H',
        questions: [question()],
        findings: [finding(), finding({ title: 'Dead branch' })],
      },
      outcome: 'submitted',
      answers: [answer({ choice: 1 })],
      findingAnswers: [findingAnswer({ choice: 1, action: 'fix_now' })],
      summary:
        '2 findings, 1 question: 2 answered, 0 not applicable, 1 untouched.',
    },
    {
      shape: 'one finding, singular',
      args: { heading: 'H', findings: [finding()] },
      outcome: 'submitted',
      answers: [],
      findingAnswers: [],
      summary: '1 finding: 0 answered, 0 not applicable, 1 untouched.',
    },
    {
      shape: 'notices alone, 0 questions',
      args: { heading: 'H', notices: [notice()] },
      outcome: 'submitted',
      answers: [],
      findingAnswers: [],
      summary: '0 questions: 0 answered, 0 not applicable, 0 untouched.',
    },
    {
      shape: 'a findings draft, still open',
      args: { heading: 'H', findings: [finding()] },
      outcome: 'draft',
      answers: [],
      findingAnswers: [],
      summary:
        '1 finding: 0 answered, 0 not applicable, 1 untouched. The form is still open.',
    },
  ] as const)(
    'summarises $shape',
    ({ args, outcome, answers, findingAnswers, summary }) => {
      const payload = roundType.payload(
        parseRound(BUILT_IN_KINDS, args),
        outcome,
        body([...answers], { finding_answers: [...findingAnswers] }),
      );

      expect(payload.summary).toBe(summary);
    },
  );
});

describe('roundType.payload finding actions', () => {
  // Choice 1 sits under fix_now, choice 2 under follow_up; leave_it has none.
  const TWO_ACTIONS = finding({
    choices: [
      { text: 'Clear on reload', reason: 'It is one line.' },
      {
        text: 'Track it in the cache plan',
        reason: 'The plan reworks the cache.',
        action: 'follow_up',
      },
    ],
  });

  function findingResult(
    entry: Partial<FindingAnswerEntry>,
    raw: Record<string, unknown> = TWO_ACTIONS,
  ) {
    const round = parseRound(BUILT_IN_KINDS, { heading: 'H', findings: [raw] });
    const payload = roundType.payload(
      round,
      'submitted',
      body([], { finding_answers: [findingAnswer(entry)] }),
    );
    return payload.findings[0];
  }

  it('reports a picked choice with its number, text and action', () => {
    expect(findingResult({ choice: 2, action: 'follow_up' })).toMatchObject({
      status: 'answered',
      choice: 2,
      choice_text: 'Track it in the cache plan',
      action: 'follow_up',
      took_recommendation: false,
      took_action_recommendation: false,
    });
  });

  it('answers a header pick with choice 0 and its action', () => {
    expect(findingResult({ choice: 0, action: 'leave_it' })).toMatchObject({
      status: 'answered',
      choice: 0,
      choice_text: '',
      action: 'leave_it',
    });
  });

  it('leaves a finding untouched whose action has choices but none picked', () => {
    expect(findingResult({ choice: 0, action: 'fix_now' })).toMatchObject({
      status: 'untouched',
      action: '',
    });
  });

  it('reports a leave_it choice with its choice and text', () => {
    const leaveItChoice = finding({
      choices: [
        { text: 'Clear on reload', reason: 'It is one line.' },
        {
          text: 'Reloads are rare',
          reason: 'Nobody reloads mid-task.',
          action: 'leave_it',
        },
      ],
    });

    expect(
      findingResult({ choice: 2, action: 'leave_it' }, leaveItChoice),
    ).toMatchObject({
      status: 'answered',
      choice: 2,
      choice_text: 'Reloads are rare',
      action: 'leave_it',
    });
  });

  it('leaves a choice picked with another action untouched', () => {
    expect(findingResult({ choice: 1, action: 'follow_up' })).toMatchObject({
      status: 'untouched',
    });
  });

  it('leaves an action the origin lacks untouched', () => {
    const {
      severity: _severity,
      recommend: _recommend,
      ...nit
    } = finding({
      origin: 'nit',
      choices: [{ text: 'Rename it', reason: 'The name reads better.' }],
      recommend_action: 'leave_it',
    });

    expect(
      findingResult({ choice: 0, action: 'follow_up' }, nit),
    ).toMatchObject({ status: 'untouched' });
  });

  it('marks both recommendations on the recommended choice', () => {
    expect(findingResult({ choice: 1, action: 'fix_now' })).toMatchObject({
      took_recommendation: true,
      took_action_recommendation: true,
    });
  });

  it('marks both recommendations on a recommended header', () => {
    const { recommend: _recommend, ...headerRecommended } = {
      ...TWO_ACTIONS,
      recommend_action: 'leave_it',
    };

    expect(
      findingResult({ choice: 0, action: 'leave_it' }, headerRecommended),
    ).toMatchObject({
      took_recommendation: true,
      took_action_recommendation: true,
    });
  });

  it('reports no action on a not-applicable finding that holds one', () => {
    expect(
      findingResult({ action: 'fix_now', choice: 1, not_applicable: true }),
    ).toMatchObject({
      status: 'not_applicable',
      action: '',
      choice: 0,
      took_action_recommendation: false,
    });
  });

  it('leaves a finding with notes alone untouched on the wire', () => {
    expect(findingResult({ notes: 'my own fix' })).toMatchObject({
      status: 'untouched',
      notes: 'my own fix',
    });
  });
});

describe('roundType.payload notices', () => {
  function roundWithNotices(noticeCount: number) {
    return parseRound(BUILT_IN_KINDS, {
      heading: 'H',
      questions: [question()],
      notices: Array.from({ length: noticeCount }, (_, n) =>
        notice({ title: `Fix ${n}` }),
      ),
    });
  }

  it('gives an uncommented notice no comment key', () => {
    const payload = roundType.payload(
      roundWithNotices(2),
      'submitted',
      body([]),
    );

    expect(payload.notices).toEqual([
      { index: 1, title: 'Fix 0', badge: 'Applied' },
      { index: 2, title: 'Fix 1', badge: 'Applied' },
    ]);
  });

  it('carries each comment on its own notice', () => {
    const payload = roundType.payload(
      roundWithNotices(2),
      'submitted',
      body([], {
        notice_comments: [
          { index: 1, comment: 'looks fine' },
          { index: 2, comment: 'please double check this one' },
        ],
      }),
    );

    expect(payload.notices.map((each) => each.comment)).toEqual([
      'looks fine',
      'please double check this one',
    ]);
  });

  it('echoes a Decided badge', () => {
    const round = parseRound(BUILT_IN_KINDS, {
      heading: 'H',
      notices: [notice({ title: 'Kept it in config', badge: 'Decided' })],
    });

    expect(roundType.payload(round, 'submitted', body([])).notices).toEqual([
      { index: 1, title: 'Kept it in config', badge: 'Decided' },
    ]);
  });

  it('never counts a notice in the answers or the summary', () => {
    const payload = roundType.payload(
      roundWithNotices(3),
      'submitted',
      body([answer({ choice: 1 })], {
        notice_comments: [{ index: 1, comment: 'a comment' }],
      }),
    );

    expect(payload.answers).toHaveLength(1);
    expect(payload.summary).toBe(
      '1 question: 1 answered, 0 not applicable, 0 untouched.',
    );
  });

  it('submits a notices-alone round with an empty answers list', () => {
    const round = parseRound(BUILT_IN_KINDS, {
      heading: 'H',
      notices: [notice()],
    });

    const payload = roundType.payload(round, 'submitted', body([]));

    expect(payload.outcome).toBe('submitted');
    expect(payload.answers).toEqual([]);
    expect(payload.notices[0]).not.toHaveProperty('comment');
  });
});

describe('roundType.payload free text', () => {
  function entryFor(entry: Partial<AnswerEntry>) {
    return roundType.payload(roundOf(1), 'submitted', body([answer(entry)]))
      .answers[0];
  }

  it('leaves out empty notes', () => {
    expect(entryFor({ choice: 1 })).not.toHaveProperty('notes');
  });

  it('carries written notes', () => {
    expect(entryFor({ choice: 1, notes: 'my own' })).toMatchObject({
      notes: 'my own',
    });
  });

  it('leaves out an empty note and carries a written one', () => {
    const round = roundOf(1);

    expect(roundType.payload(round, 'submitted', body([]))).not.toHaveProperty(
      'note',
    );
    expect(
      roundType.payload(round, 'submitted', body([], { note: 'hello' })).note,
    ).toBe('hello');
  });

  it('carries a press with its reason, and the choice still counts', () => {
    expect(
      entryFor({ choice: 1, dont_ask: true, dont_ask_reason: 'settle it' }),
    ).toMatchObject({
      dont_ask: true,
      dont_ask_reason: 'settle it',
      choice: 1,
    });
  });

  it('carries a press with no reason as dont_ask alone', () => {
    const entry = entryFor({ choice: 1, dont_ask: true });

    expect(entry.dont_ask).toBe(true);
    expect(entry).not.toHaveProperty('dont_ask_reason');
  });

  it('carries neither key for an unpressed answer, even with reason text', () => {
    const entry = entryFor({
      choice: 1,
      dont_ask_reason: 'typed, then unpressed',
    });

    expect(entry).not.toHaveProperty('dont_ask');
    expect(entry).not.toHaveProperty('dont_ask_reason');
  });
});

describe('fingerprint', () => {
  const BASE_QUESTION = { context: 'ctx', choices: ['a', 'b'], rationale: 'r' };

  function args(overrides: Record<string, unknown> = {}) {
    return {
      heading: 'H',
      overview: 'O',
      questions: [question(BASE_QUESTION)],
      notices: [{ title: 'Renamed', context: 'done' }],
      ...overrides,
    };
  }

  it('ignores the heading and the overview', () => {
    const base = fingerprint(
      BUILT_IN_KINDS,
      parseRound(BUILT_IN_KINDS, args()),
    );

    expect(
      fingerprint(
        BUILT_IN_KINDS,
        parseRound(BUILT_IN_KINDS, args({ heading: 'Other' })),
      ),
    ).toBe(base);
    expect(
      fingerprint(
        BUILT_IN_KINDS,
        parseRound(BUILT_IN_KINDS, args({ overview: 'Other' })),
      ),
    ).toBe(base);
  });

  it('changes with the summary', () => {
    const reworded = args({
      questions: [question({ ...BASE_QUESTION, summary: 'Which name loses?' })],
    });

    expect(
      fingerprint(BUILT_IN_KINDS, parseRound(BUILT_IN_KINDS, reworded)),
    ).not.toBe(fingerprint(BUILT_IN_KINDS, parseRound(BUILT_IN_KINDS, args())));
  });

  it('changes with the actions a question approves', () => {
    const tagged = (action: string) =>
      args({
        questions: [
          question({ ...BASE_QUESTION, approves: [{ choice: 1, action }] }),
        ],
      });
    const hash = (raw: unknown) =>
      fingerprint(BUILT_IN_KINDS, parseRound(BUILT_IN_KINDS, raw));

    expect(hash(tagged('push main'))).not.toBe(hash(args()));
    expect(hash(tagged('push main'))).not.toBe(hash(tagged('push develop')));
  });

  it("hashes a legacy question's `question` as its summary twin", () => {
    const { summary, ...rest } = question(BASE_QUESTION);
    const legacy = args({ questions: [{ ...rest, question: summary }] });

    expect(
      fingerprint(BUILT_IN_KINDS, parseRound(BUILT_IN_KINDS, legacy)),
    ).toBe(fingerprint(BUILT_IN_KINDS, parseRound(BUILT_IN_KINDS, args())));
  });

  it('hashes a round with no findings with no findings key', () => {
    expect(
      fingerprint(
        BUILT_IN_KINDS,
        parseRound(BUILT_IN_KINDS, args({ notices: [] })),
      ),
    ).toBe('56624f6db3c22a5e6fb81207c85d247e1ec9e920364a03263f46d2d6afc00ffb');
  });

  it('hashes a finding with no choice actions or action_reasons as it did before they existed', () => {
    expect(
      fingerprint(
        BUILT_IN_KINDS,
        parseRound(BUILT_IN_KINDS, { heading: 'H', findings: [finding()] }),
      ),
    ).toBe('fc3a3a26e21f0c6e85e8ad1f4d000380e032b3b52e3bc6b2ffae5226034e77b1');
  });

  it('hashes a finding with no proof apart from one with proof', () => {
    const { proof: _proof, ...unproved } = finding();
    const hash = (item: Record<string, unknown>) =>
      fingerprint(
        BUILT_IN_KINDS,
        parseRound(BUILT_IN_KINDS, { heading: 'H', findings: [item] }),
      );

    expect(hash(unproved)).not.toBe(hash(finding()));
  });

  it('ignores an empty findings list', () => {
    expect(
      fingerprint(
        BUILT_IN_KINDS,
        parseRound(BUILT_IN_KINDS, args({ findings: [] })),
      ),
    ).toBe(fingerprint(BUILT_IN_KINDS, parseRound(BUILT_IN_KINDS, args())));
  });

  it('counts the findings', () => {
    expect(
      fingerprint(
        BUILT_IN_KINDS,
        parseRound(BUILT_IN_KINDS, args({ findings: [finding()] })),
      ),
    ).not.toBe(fingerprint(BUILT_IN_KINDS, parseRound(BUILT_IN_KINDS, args())));
  });

  it('ignores the round layout and item layouts', () => {
    const withFinding = args({ findings: [finding()] });
    const laidOut = args({
      layout: 'compact',
      questions: [question({ ...BASE_QUESTION, layout: 'compact' })],
      notices: [{ title: 'Renamed', context: 'done', layout: 'compact' }],
      findings: [finding({ layout: 'compact' })],
    });

    expect(
      fingerprint(BUILT_IN_KINDS, parseRound(BUILT_IN_KINDS, laidOut)),
    ).toBe(
      fingerprint(BUILT_IN_KINDS, parseRound(BUILT_IN_KINDS, withFinding)),
    );
  });

  it("changes with a finding choice's action", () => {
    const withAction = (action: string) =>
      args({
        findings: [
          finding({
            choices: [
              { text: 'Fix it now', reason: 'It is one line.' },
              { text: 'Keep the cache', reason: 'Reloads are rare.', action },
            ],
          }),
        ],
      });

    expect(
      fingerprint(
        BUILT_IN_KINDS,
        parseRound(BUILT_IN_KINDS, withAction('fix_now')),
      ),
    ).not.toBe(
      fingerprint(
        BUILT_IN_KINDS,
        parseRound(BUILT_IN_KINDS, withAction('leave_it')),
      ),
    );
  });

  it("changes with a finding's choice reason", () => {
    const withReason = (reason: string) =>
      args({
        findings: [
          finding({
            choices: [
              { text: 'Fix it now', reason: 'It is one line.' },
              { text: 'Keep the cache', reason },
            ],
          }),
        ],
      });

    expect(
      fingerprint(
        BUILT_IN_KINDS,
        parseRound(BUILT_IN_KINDS, withReason('Reloads are rare.')),
      ),
    ).not.toBe(
      fingerprint(
        BUILT_IN_KINDS,
        parseRound(BUILT_IN_KINDS, withReason('Nobody reloads.')),
      ),
    );
  });

  it('counts the notices', () => {
    expect(
      fingerprint(
        BUILT_IN_KINDS,
        parseRound(BUILT_IN_KINDS, args({ notices: [] })),
      ),
    ).not.toBe(fingerprint(BUILT_IN_KINDS, parseRound(BUILT_IN_KINDS, args())));
  });

  it("equals Python's json.dumps hash for the same round", () => {
    const round = parseRound(BUILT_IN_KINDS, {
      heading: 'Ignored heading',
      overview: 'Ignored overview',
      questions: [
        {
          title: 'Naming été \u{1F680}',
          context:
            'Line one\nline "two"\twith a tab, a backslash \\ and a bell \u0007 and \u2028',
          summary: 'Which name should win?',
          choices: ['module_a', 'module_b — newer'],
          recommend: 2,
          rationale: 'r',
        },
      ],
      notices: [
        { title: 'Renamed', context: 'done' },
        { title: 'Kept it', context: 'one line', badge: 'Decided' },
      ],
    });

    expect(fingerprint(BUILT_IN_KINDS, round)).toBe(
      '58960c3e13b904b5bdbb945f76fd021f79b7c68c104678715b269021f13677a7',
    );
  });

  // Breaks when a kind's fingerprint keys, content or join rule drift, so
  // saved files would stop matching their re-sends.
  it.each([
    {
      case: 'as written',
      overrides: {},
      hash: '9d2a6bcc16872111817bb133ca6884d80cac3374686004c367e408207b52b598',
    },
    {
      case: 'with no findings',
      overrides: { findings: [] },
      hash: '11c9cd9ef9ccd6280164980a1ef91d1e45f8bf2cc27cf035526c83b6bb911412',
    },
  ])(
    'pins a round of all three kinds to the hash saved files hold ($case)',
    ({ overrides, hash }) => {
      const round = parseRound(BUILT_IN_KINDS, {
        ...ALL_KINDS_ARGS,
        ...overrides,
      });

      expect(fingerprint(BUILT_IN_KINDS, round)).toBe(hash);
    },
  );

  // Breaks if the hash came to depend on the order the kinds registered in.
  it('hashes the same whatever order the built-ins register in', () => {
    const reordered = BUILT_IN_KINDS.toReversed();
    const round = parseRound(reordered, ALL_KINDS_ARGS);

    expect(fingerprint(reordered, round)).toBe(
      '9d2a6bcc16872111817bb133ca6884d80cac3374686004c367e408207b52b598',
    );
  });
});

describe('autoAnsweredPayload', () => {
  const { recommend: _recommend, ...headerRecommended } = finding({
    title: 'Header pick',
    recommend_action: 'follow_up',
  });

  it.each([
    {
      name: 'a question recommending 2',
      args: { questions: [question({ recommend: 2 })] },
      item: (payload: AnswersPayload) => payload.answers[0],
      expected: {
        index: 1,
        title: 'Naming',
        status: 'answered',
        choice: 2,
        choice_text: 'module_b',
        took_recommendation: true,
      },
    },
    {
      name: 'a finding recommending choice 1 under fix_now',
      args: { findings: [finding()] },
      item: (payload: AnswersPayload) => payload.findings[0],
      expected: {
        index: 1,
        title: 'Stale cache',
        status: 'answered',
        choice: 1,
        choice_text: 'Fix it now',
        action: 'fix_now',
        took_recommendation: true,
        took_action_recommendation: true,
      },
    },
    {
      name: 'a finding recommending the follow_up header',
      args: { findings: [finding(), headerRecommended] },
      item: (payload: AnswersPayload) => payload.findings[1],
      expected: {
        index: 2,
        title: 'Header pick',
        status: 'answered',
        choice: 0,
        choice_text: '',
        action: 'follow_up',
        took_recommendation: true,
        took_action_recommendation: true,
      },
    },
    {
      name: 'a notice',
      args: {
        notices: [notice(), notice({ title: 'Second', badge: 'Decided' })],
      },
      item: (payload: AnswersPayload) => payload.notices[1],
      expected: { index: 2, title: 'Second', badge: 'Decided' },
    },
  ])(
    "takes every item's recommendation ($name)",
    ({ args, item, expected }) => {
      const round = parseRound(BUILT_IN_KINDS, { heading: 'H', ...args });

      const payload = autoAnsweredPayload(
        BUILT_IN_KINDS,
        round,
        recommendedBody(BUILT_IN_KINDS, round),
      );

      expect(payload.outcome).toBe('auto_answered');
      expect(payload.next).toBe(
        'This session is headless until a tool result says the session is ' +
          'no longer headless: the app showed no form and answered every ' +
          'item with its recommendation. Build no more rounds, and list ' +
          'every pick as a Decided notice in your reply. An auto-answered ' +
          'pick never approves a hard-gated action (third-party code, ' +
          'destroying user state, a push): name what the gate needs in the ' +
          'reply and end the turn.',
      );
      expect(item(payload)).toEqual(expected);
    },
  );
});

describe('recommendedBody', () => {
  it("labels each finding entry with its recommended action's word", () => {
    const round = parseRound(BUILT_IN_KINDS, {
      heading: 'H',
      findings: [
        finding(),
        decisionFinding({
          choices: [
            { text: 'Cache per user', reason: 'Users differ.' },
            {
              text: 'Cache per machine',
              reason: 'Machines differ.',
              action: 'follow_up',
            },
          ],
          recommend: 2,
          recommend_action: 'follow_up',
        }),
      ],
    });

    expect(
      recommendedBody(BUILT_IN_KINDS, round).finding_answers.map((entry) => [
        entry.action_label,
        entry.recommend_action_label,
      ]),
    ).toEqual([
      ['Fix now', 'Fix now'],
      ['Plan it', 'Plan it'],
    ]);
  });
});

describe('roundType.noFormPayload', () => {
  it('is a normal payload that says to send the round again', () => {
    const payload = roundType.noFormPayload();

    expect(payload.outcome).toBe('no_round');
    expect(payload.answers).toEqual([]);
    expect(payload.findings).toEqual([]);
    expect(payload.notices).toEqual([]);
    expect(payload.next).toContain('ask_round');
  });
});

describe('roundType.handedBackPayload', () => {
  it('names the earlier round and says to send the new one again', () => {
    const round = parseRound(BUILT_IN_KINDS, {
      heading: 'Earlier round',
      questions: [question()],
    });
    const saved = body([answer({ choice: 2 })]);

    const payload = roundType.handedBackPayload(round, 'submitted', saved);

    expect(payload.earlier_heading).toBe('Earlier round');
    expect(payload.answers).toEqual(
      roundType.payload(round, 'submitted', saved).answers,
    );
    expect(payload.next).toContain('ask_round');
  });
});

describe('round results', () => {
  const round = parseRound(BUILT_IN_KINDS, {
    heading: 'H',
    questions: [question()],
  });
  const blank = readFormBody(BUILT_IN_KINDS, round, {});

  it.each([
    {
      name: 'draft',
      result: () => answersResult(BUILT_IN_KINDS, round, 'draft', blank),
      reason: { kind: 'stillOpen' },
    },
    {
      name: 'submitted',
      result: () => answersResult(BUILT_IN_KINDS, round, 'submitted', blank),
      reason: { kind: 'finished' },
    },
    {
      name: 'cancelled',
      result: () => answersResult(BUILT_IN_KINDS, round, 'cancelled', blank),
      reason: { kind: 'finished' },
    },
    {
      name: 'auto_answered',
      result: () =>
        answersResult(BUILT_IN_KINDS, round, 'auto_answered', blank),
      reason: { kind: 'autoAnswered' },
    },
    {
      name: 'handed-back',
      result: () => handedBackResult(BUILT_IN_KINDS, round, 'submitted', blank),
      reason: { kind: 'handedBack', heading: 'H' },
    },
    {
      name: 'not-shown',
      result: () => notShownResult(BUILT_IN_KINDS, round, 'Other'),
      reason: { kind: 'notShown', heading: 'H', blockingHeading: 'Other' },
    },
    {
      name: 'no-round',
      result: () => noRoundResult(BUILT_IN_KINDS),
      reason: { kind: 'noRound' },
    },
  ])('gives a $name result the reason $reason.kind', ({ result, reason }) => {
    expect(result().reason).toEqual(reason);
  });
});

describe('a registered kind', () => {
  const kinds = [...BUILT_IN_KINDS, pollKind];
  const args = { heading: 'H', overview: 'O', polls: [POLL] };

  // The tool error text of the RoundError parseRound throws for these args
  // under `known`.
  function errorUnder(known: readonly MainItemKind[], raw: unknown): string {
    try {
      parseRound(known, raw);
    } catch (error) {
      if (error instanceof RoundError) {
        return roundErrorText(known, error);
      }
      throw error;
    }
    throw new Error('parseRound accepted the round');
  }

  it('parses its list from its argsKey', () => {
    expect(parseRound(kinds, args).items.poll).toEqual([POLL]);
  });

  it('lists its argsKey after questions in the unknown-field error', () => {
    expect(errorUnder(kinds, { ...args, extra: 1 })).toBe(
      "ask_round got unknown field(s): extra. It takes 'heading', " +
        "'overview', 'layout', 'notices', 'findings', 'questions', and " +
        "'polls'.",
    );
  });

  it('names its noun last in the empty-round error', () => {
    expect(errorUnder(kinds, { heading: 'H' })).toBe(
      'ask_round needs at least one notice, finding, question or poll.',
    );
  });

  it("words its parse error with its noun and the item's number", () => {
    expect(errorUnder(kinds, { heading: 'H', polls: [{}] })).toBe(
      'Poll 1: each poll needs a title.',
    );
  });

  it('writes its body key first, then the built-ins in saved order', () => {
    const round = parseRound(kinds, args);

    expect(Object.keys(readFormBody(kinds, round, {}))).toEqual([
      'note',
      'poll_answers',
      'answers',
      'finding_answers',
      'notice_comments',
    ]);
  });

  it('writes its result key first after next, then the built-ins', () => {
    const round = parseRound(kinds, args);
    const result = answersResult(
      kinds,
      round,
      'submitted',
      recommendedBody(kinds, round),
    );

    expect(Object.keys(roundPayload(kinds, result))).toEqual([
      'outcome',
      'summary',
      'next',
      'polls',
      'answers',
      'findings',
      'notices',
    ]);
  });

  it('holds its results at its kind id', () => {
    const round = parseRound(kinds, args);
    const result = answersResult(
      kinds,
      round,
      'submitted',
      recommendedBody(kinds, round),
    );

    expect(result.results.poll).toEqual([
      { index: 1, title: 'Lunch', status: 'answered', vote: 1 },
    ]);
  });

  it('counts its items after the questions in the summary', () => {
    const round = parseRound(kinds, { ...args, questions: [question()] });
    const result = answersResult(
      kinds,
      round,
      'submitted',
      recommendedBody(kinds, round),
    );

    expect(roundPayload(kinds, result).summary).toBe(
      '1 question, 1 poll: 2 answered, 0 not applicable, 0 untouched.',
    );
  });

  it('writes an empty list for it in a round with none', () => {
    const round = parseRound(kinds, { heading: 'H', questions: [question()] });
    const result = answersResult(
      kinds,
      round,
      'submitted',
      readFormBody(kinds, round, {}),
    );

    expect(readFormBody(kinds, round, {}).poll_answers).toEqual([]);
    expect(roundPayload(kinds, result).polls).toEqual([]);
  });

  it('holds an empty list for every registered kind in a no-round result', () => {
    expect(noRoundResult(kinds).results).toEqual({
      notice: [],
      finding: [],
      question: [],
      poll: [],
    });
  });

  it('is an unknown field once disposed', () => {
    const registry = createKindRegistry();
    for (const kind of BUILT_IN_KINDS) {
      registry.register(kind);
    }
    registry.register(pollKind).dispose();

    expect(errorUnder(registry.kinds(), args)).toMatch(
      /^ask_round got unknown field\(s\): polls\. It takes /,
    );
  });

  it("leaves a disposed kind's list in a parsed round out of the body and payload", () => {
    const round = parseRound(kinds, { ...args, questions: [question()] });
    const result = answersResult(
      BUILT_IN_KINDS,
      round,
      'submitted',
      readFormBody(BUILT_IN_KINDS, round, {}),
    );

    expect(readFormBody(BUILT_IN_KINDS, round, {})).not.toHaveProperty(
      'poll_answers',
    );
    expect(roundPayload(BUILT_IN_KINDS, result)).not.toHaveProperty('polls');
  });
});
