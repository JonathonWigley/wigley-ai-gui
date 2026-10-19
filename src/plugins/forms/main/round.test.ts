import { describe, expect, it } from 'vitest';
import type { AnswerEntry, FindingAnswerEntry, FormBody } from '../contract';
import {
  answersPayload,
  fingerprint,
  handedBackPayload,
  noRoundPayload,
  parseRound,
  readFormBody,
} from './round';
import { RoundError } from './round-error';

function question(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Naming',
    context: 'Two modules do the same thing under different names.',
    question: 'Which name should win?',
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
    finding: 'The cache keeps entries after a reload.',
    proof: '- `cache.ts:40` never clears',
    choices: [
      { text: 'Fix it now', reason: 'It is one line.' },
      { text: 'Leave it', reason: 'Reloads are rare.' },
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

function findingAnswer(entry: Partial<FindingAnswerEntry>): FindingAnswerEntry {
  return { ...answer(entry), action: '', ...entry };
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
  return parseRound({
    heading: 'H',
    questions: Array.from({ length: count }, () => question(overrides)),
  });
}

// The message of the RoundError parseRound throws for these args.
function roundError(args: unknown): string {
  try {
    parseRound(args);
  } catch (error) {
    if (error instanceof RoundError) {
      return error.message;
    }
    throw error;
  }
  throw new Error('parseRound accepted the round');
}

describe('parseRound', () => {
  it('keeps a valid two-question round in order', () => {
    const round = parseRound({
      heading: 'Naming decisions',
      questions: [
        question({ title: 'First', question: 'Pick the first name.' }),
        question({ title: 'Second', question: 'Pick the second name.' }),
      ],
    });

    expect(round.heading).toBe('Naming decisions');
    expect(round.questions.map((each) => each.title)).toEqual([
      'First',
      'Second',
    ]);
    expect(round.questions[1].question).toBe('Pick the second name.');
  });

  it.each([['not a dict'], [['a list']], [null]])(
    'names every top-level field when args are not an object (%j)',
    (args) => {
      const message = roundError(args);

      expect(message).toContain(
        "'heading', 'overview', 'notices', 'findings', and 'questions'",
      );
      expect(message).toContain(
        'Each list is optional, but the round needs at least one item.',
      );
    },
  );

  it('refuses an unknown top-level field', () => {
    const message = roundError({
      heading: 'H',
      questions: [question()],
      extra: 1,
    });

    expect(message).toContain('ask_round got unknown field(s): extra.');
  });

  it('refuses an empty heading', () => {
    const message = roundError({ heading: '', questions: [question()] });

    expect(message).toBe(
      'heading must be a non-empty string. Give it the text you would have written in the reply.',
    );
  });

  it('keeps the overview stripped', () => {
    const round = parseRound({
      heading: 'H',
      overview: '  Refactoring X. This round: names.  ',
      questions: [question()],
    });

    expect(round.overview).toBe('Refactoring X. This round: names.');
  });

  it('parses a round with no overview, so older saved rounds rebuild', () => {
    expect(parseRound({ heading: 'H', questions: [question()] }).overview).toBe(
      '',
    );
  });

  it('refuses a non-string overview', () => {
    const message = roundError({
      heading: 'H',
      overview: ['a'],
      questions: [question()],
    });

    expect(message).toContain('overview must be a string');
  });

  it.each(['notices', 'findings', 'questions'])(
    'refuses %s that are not a list',
    (key) => {
      expect(roundError({ heading: 'H', [key]: 'one item' })).toBe(
        `ask_round's ${key} must be a list of objects.`,
      );
    },
  );

  it('refuses an empty questions list with no notices', () => {
    expect(roundError({ heading: 'H', questions: [] })).toBe(
      'ask_round needs at least one notice, finding or question.',
    );
  });
});

describe('parseRound with notices', () => {
  it('parses notices alone, with no questions', () => {
    const round = parseRound({ heading: 'H', notices: [notice()] });

    expect(round.questions).toEqual([]);
    expect(round.notices.map((each) => each.title)).toEqual([
      'Renamed the stale helper',
    ]);
  });

  it('parses notices and questions together', () => {
    const round = parseRound({
      heading: 'H',
      questions: [question()],
      notices: [notice(), notice({ title: 'Second fix' })],
    });

    expect(round.questions).toHaveLength(1);
    expect(round.notices[1].title).toBe('Second fix');
  });

  it('reads omitted or null notices and questions as none', () => {
    expect(
      parseRound({ heading: 'H', questions: [question()] }).notices,
    ).toEqual([]);
    expect(
      parseRound({ heading: 'H', questions: null, notices: [notice()] })
        .questions,
    ).toEqual([]);
  });

  it.each([
    [{ heading: 'H', questions: [], notices: [] }],
    [{ heading: 'H' }],
    [{ heading: 'H', questions: [], findings: [], notices: [] }],
  ])('refuses a round with no item of any kind (%j)', (args) => {
    expect(roundError(args)).toContain(
      'needs at least one notice, finding or question',
    );
  });

  it('accepts fifty notices and refuses fifty-one', () => {
    const notices = (count: number) =>
      Array.from({ length: count }, (_, n) => notice({ title: `Fix ${n}` }));

    expect(
      parseRound({ heading: 'H', notices: notices(50) }).notices,
    ).toHaveLength(50);
    expect(roundError({ heading: 'H', notices: notices(51) })).toContain(
      'Split the round.',
    );
  });

  it.each(['Dispatched', 'Decided'])('accepts the %s badge', (badge) => {
    const round = parseRound({ heading: 'H', notices: [notice({ badge })] });

    expect(round.notices[0].badge).toBe(badge);
  });

  it('accepts twenty questions and refuses twenty-one', () => {
    const questions = (count: number) =>
      Array.from({ length: count }, (_, n) => question({ title: `Q ${n}` }));

    expect(
      parseRound({ heading: 'H', questions: questions(20) }).questions,
    ).toHaveLength(20);
    expect(roundError({ heading: 'H', questions: questions(21) })).toContain(
      'Split the round.',
    );
  });
});

describe('parseRound with findings', () => {
  it('parses findings beside questions and notices, in their own array', () => {
    const round = parseRound({
      heading: 'H',
      questions: [question()],
      findings: [finding()],
      notices: [notice()],
    });

    expect(round.findings[0].title).toBe('Stale cache');
    expect(round.findings[0].choices[1]).toEqual({
      text: 'Leave it',
      reason: 'Reloads are rare.',
    });
    expect(round.questions).toHaveLength(1);
    expect(round.notices).toHaveLength(1);
  });

  it('parses findings alone', () => {
    const round = parseRound({ heading: 'H', findings: [finding()] });

    expect(round.findings).toHaveLength(1);
    expect(round.questions).toEqual([]);
    expect(round.notices).toEqual([]);
  });

  it('reads omitted or null findings as none', () => {
    expect(
      parseRound({ heading: 'H', questions: [question()] }).findings,
    ).toEqual([]);
    expect(
      parseRound({ heading: 'H', questions: [question()], findings: null })
        .findings,
    ).toEqual([]);
  });

  it('accepts twenty findings and refuses twenty-one', () => {
    const findings = (count: number) =>
      Array.from({ length: count }, (_, n) => finding({ title: `F ${n}` }));

    expect(
      parseRound({ heading: 'H', findings: findings(20) }).findings,
    ).toHaveLength(20);
    expect(roundError({ heading: 'H', findings: findings(21) })).toContain(
      'ask_round got 21 findings; the maximum is 20. Split the round.',
    );
  });

  it("numbers a finding's errors from 1", () => {
    const partial: Record<string, unknown> = finding();
    delete partial.proof;

    expect(
      roundError({ heading: 'H', findings: [finding(), partial] }),
    ).toContain('Finding 2: missing proof');
  });
});

describe('readFormBody', () => {
  it('reads one entry per question by index, with defaults where none was saved', () => {
    const round = roundOf(2);

    const read = readFormBody(round, {
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
    const read = readFormBody(roundOf(1), {
      answers: [{ index: 1, what: 'mine', why: 'because' }],
    });

    expect(read.answers).toEqual([answer({ notes: 'mine\n\nbecause' })]);
  });

  it("reads an old file's lone what or lone why as notes", () => {
    const lone = (entry: Record<string, unknown>) =>
      readFormBody(roundOf(1), { answers: [{ index: 1, ...entry }] }).answers[0]
        .notes;

    expect(lone({ what: 'mine', why: '' })).toBe('mine');
    expect(lone({ why: 'because' })).toBe('because');
  });

  it('prefers a notes key over what and why, even when empty', () => {
    const read = readFormBody(roundOf(1), {
      answers: [{ index: 1, notes: '', what: 'old' }],
    });

    expect(read.answers).toEqual([answer({ notes: '' })]);
  });

  it('reads one finding answer per finding by index', () => {
    const round = parseRound({
      heading: 'H',
      findings: [finding(), finding({ title: 'Dead branch' })],
    });

    const read = readFormBody(round, {
      finding_answers: [{ index: 2, choice: 1, notes: 'n' }],
    });

    expect(read.finding_answers).toEqual([
      findingAnswer({ index: 1 }),
      findingAnswer({ index: 2, choice: 1, notes: 'n' }),
    ]);
  });

  it('reads a body with no finding_answers as untouched findings', () => {
    const round = parseRound({ heading: 'H', findings: [finding()] });

    expect(readFormBody(round, {}).finding_answers).toEqual([
      findingAnswer({ index: 1 }),
    ]);
  });

  it("keeps a finding's saved action", () => {
    const round = parseRound({ heading: 'H', findings: [finding()] });

    const read = readFormBody(round, {
      finding_answers: [{ index: 1, choice: 2, action: 'follow_up' }],
    });

    expect(read.finding_answers[0].action).toBe('follow_up');
  });

  it('reads a finding entry with no action, or an unknown one, as none', () => {
    const round = parseRound({
      heading: 'H',
      findings: [finding(), finding({ title: 'Dead branch' })],
    });

    const read = readFormBody(round, {
      finding_answers: [
        { index: 1, choice: 2 },
        { index: 2, choice: 1, action: 'Fix now' },
      ],
    });

    expect(read.finding_answers.map((entry) => entry.action)).toEqual(['', '']);
  });

  it('keeps a pressed answer with its reason', () => {
    const read = readFormBody(roundOf(1), {
      answers: [
        { index: 1, choice: 2, dont_ask: true, dont_ask_reason: 'settle it' },
      ],
    });

    expect(read.answers).toEqual([
      answer({ choice: 2, dont_ask: true, dont_ask_reason: 'settle it' }),
    ]);
  });

  it('reads a non-boolean press and a non-string reason as unpressed', () => {
    const read = readFormBody(roundOf(1), {
      answers: [{ index: 1, choice: 1, dont_ask: 'true', dont_ask_reason: 7 }],
    });

    expect(read.answers).toEqual([answer({ choice: 1 })]);
  });

  it('keeps the choice number of a not-applicable answer', () => {
    const read = readFormBody(roundOf(1), {
      answers: [{ index: 1, choice: 2, not_applicable: true }],
    });

    expect(read.answers).toEqual([answer({ choice: 2, not_applicable: true })]);
  });

  it.each([[true], ['2'], [1.5]])(
    'reads a choice of %j as no choice',
    (choice) => {
      const read = readFormBody(roundOf(1), {
        answers: [{ index: 1, choice }],
      });

      expect(read.answers[0].choice).toBe(0);
    },
  );

  it('reads notice comments by index and gives an absent one an empty comment', () => {
    const round = parseRound({
      heading: 'H',
      notices: [notice(), notice({ title: 'Second' })],
    });

    const read = readFormBody(round, {
      notice_comments: [{ index: 2, comment: 'check this' }],
    });

    expect(read.notice_comments).toEqual([
      { index: 1, comment: '' },
      { index: 2, comment: 'check this' },
    ]);
  });

  it('reads a body that is not an object as untouched', () => {
    expect(readFormBody(roundOf(1), 'junk')).toEqual(body([answer({})]));
  });
});

describe('answersPayload', () => {
  it('builds the whole payload for a submitted round', () => {
    const round = parseRound({
      heading: 'Interview architecture',
      questions: [
        question({ title: 'Alpha', choices: ['a', 'b', 'c'], recommend: 1 }),
        question({ title: 'Beta', choices: ['x', 'y'], recommend: 2 }),
        question({ title: 'Gamma', choices: ['p', 'q'], recommend: 1 }),
      ],
    });

    const payload = answersPayload(
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
    const payload = answersPayload(
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
    const payload = answersPayload(
      roundOf(1),
      'submitted',
      body([answer({ not_applicable: true })]),
    );

    expect(payload.answers[0].status).toBe('not_applicable');
  });

  it('reports no choice for a not-applicable answer that kept its choice number', () => {
    const round = roundOf(1, { choices: ['alpha', 'beta'], recommend: 2 });

    const payload = answersPayload(
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

    const payload = answersPayload(
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

    const payload = answersPayload(
      round,
      'submitted',
      body([answer({ choice: 1 }), answer({ index: 2, choice: 2 })]),
    );

    expect(payload.answers.map((each) => each.took_recommendation)).toEqual([
      true,
      false,
    ]);
  });

  it('tells a draft caller to keep waiting and says the form is still open', () => {
    const payload = answersPayload(roundOf(1), 'draft', body([]));

    expect(payload.next).toContain('Call collect_last_round to keep waiting.');
    expect(payload.summary).toContain('The form is still open.');
  });

  it('counts an out-of-range choice as untouched in both the answer and the summary', () => {
    const round = roundOf(2, { choices: ['alpha', 'beta'] });

    const payload = answersPayload(
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

  it('carries no earlier_heading on an ordinary payload', () => {
    expect(
      answersPayload(roundOf(1), 'submitted', body([])),
    ).not.toHaveProperty('earlier_heading');
  });
});

describe('answersPayload findings', () => {
  it('returns finding answers in their own array, index-parallel with the findings', () => {
    const round = parseRound({
      heading: 'H',
      questions: [question()],
      findings: [finding(), finding({ title: 'Dead branch' })],
    });

    const payload = answersPayload(
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
        choice_text: 'Leave it',
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
    const round = parseRound({ heading: 'H', findings: [finding()] });

    const payload = answersPayload(
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

  it('counts findings alone in the summary', () => {
    const round = parseRound({
      heading: 'H',
      findings: [finding(), finding({ title: 'Dead branch' })],
    });

    const payload = answersPayload(
      round,
      'submitted',
      body([], {
        finding_answers: [findingAnswer({ choice: 1, action: 'fix_now' })],
      }),
    );

    expect(payload.summary).toBe(
      '2 findings: 1 answered, 0 not applicable, 1 untouched.',
    );
  });

  it('counts findings first, then questions, summed', () => {
    const round = parseRound({
      heading: 'H',
      questions: [question()],
      findings: [finding(), finding({ title: 'Dead branch' })],
    });

    const payload = answersPayload(
      round,
      'submitted',
      body([answer({ choice: 1 })], {
        finding_answers: [findingAnswer({ choice: 1, action: 'fix_now' })],
      }),
    );

    expect(payload.summary).toBe(
      '2 findings, 1 question: 2 answered, 0 not applicable, 1 untouched.',
    );
  });

  it('uses the singular for one finding', () => {
    const round = parseRound({ heading: 'H', findings: [finding()] });

    expect(answersPayload(round, 'submitted', body([])).summary).toBe(
      '1 finding: 0 answered, 0 not applicable, 1 untouched.',
    );
  });

  it('says 0 questions for a notices-alone round', () => {
    const round = parseRound({ heading: 'H', notices: [notice()] });

    expect(answersPayload(round, 'submitted', body([])).summary).toBe(
      '0 questions: 0 answered, 0 not applicable, 0 untouched.',
    );
  });

  it('says a findings draft is still open', () => {
    const round = parseRound({ heading: 'H', findings: [finding()] });

    expect(answersPayload(round, 'draft', body([])).summary).toBe(
      '1 finding: 0 answered, 0 not applicable, 1 untouched. The form is still open.',
    );
  });
});

describe('answersPayload finding actions', () => {
  const oneSolution = finding({
    choices: [{ text: 'Clear on reload', reason: 'It is one line.' }],
  });

  function findingResult(
    entry: Partial<FindingAnswerEntry>,
    raw: Record<string, unknown> = finding(),
  ) {
    const round = parseRound({ heading: 'H', findings: [raw] });
    const payload = answersPayload(
      round,
      'submitted',
      body([], { finding_answers: [findingAnswer(entry)] }),
    );
    return payload.findings[0];
  }

  it('leaves a two-solution finding untouched until a solution is picked', () => {
    expect(findingResult({ action: 'fix_now', choice: 0 })).toMatchObject({
      status: 'untouched',
      action: '',
      choice: 0,
      choice_text: '',
      took_action_recommendation: false,
    });
  });

  it('answers a one-solution finding with its action alone, reporting that solution', () => {
    expect(
      findingResult({ action: 'follow_up', choice: 0 }, oneSolution),
    ).toMatchObject({
      status: 'answered',
      choice: 1,
      choice_text: 'Clear on reload',
      action: 'follow_up',
    });
  });

  it('reports no solution on leave_it, whatever solution was kept', () => {
    expect(findingResult({ action: 'leave_it', choice: 2 })).toMatchObject({
      status: 'answered',
      choice: 0,
      choice_text: '',
      took_recommendation: false,
      action: 'leave_it',
    });
  });

  it('judges the solution and the action against their own recommendations', () => {
    expect(findingResult({ action: 'follow_up', choice: 1 })).toMatchObject({
      took_recommendation: true,
      took_action_recommendation: false,
    });
    expect(findingResult({ action: 'fix_now', choice: 2 })).toMatchObject({
      took_recommendation: false,
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

describe('answersPayload notices', () => {
  function roundWithNotices(noticeCount: number) {
    return parseRound({
      heading: 'H',
      questions: [question()],
      notices: Array.from({ length: noticeCount }, (_, n) =>
        notice({ title: `Fix ${n}` }),
      ),
    });
  }

  it('gives an uncommented notice no comment key', () => {
    const payload = answersPayload(roundWithNotices(2), 'submitted', body([]));

    expect(payload.notices).toEqual([
      { index: 1, title: 'Fix 0', badge: 'Applied' },
      { index: 2, title: 'Fix 1', badge: 'Applied' },
    ]);
  });

  it('carries each comment on its own notice', () => {
    const payload = answersPayload(
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
    const round = parseRound({
      heading: 'H',
      notices: [notice({ title: 'Kept it in config', badge: 'Decided' })],
    });

    expect(answersPayload(round, 'submitted', body([])).notices).toEqual([
      { index: 1, title: 'Kept it in config', badge: 'Decided' },
    ]);
  });

  it('leaves notices without a saved comment without a comment key', () => {
    const payload = answersPayload(
      roundWithNotices(3),
      'submitted',
      body([], { notice_comments: [{ index: 1, comment: 'only the first' }] }),
    );

    expect(payload.notices[0].comment).toBe('only the first');
    expect(payload.notices[1]).not.toHaveProperty('comment');
    expect(payload.notices[2]).not.toHaveProperty('comment');
  });

  it('never counts a notice in the answers or the summary', () => {
    const payload = answersPayload(
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
    const round = parseRound({ heading: 'H', notices: [notice()] });

    const payload = answersPayload(round, 'submitted', body([]));

    expect(payload.outcome).toBe('submitted');
    expect(payload.answers).toEqual([]);
    expect(payload.notices[0]).not.toHaveProperty('comment');
  });
});

describe('answersPayload free text', () => {
  function entryFor(entry: Partial<AnswerEntry>) {
    return answersPayload(roundOf(1), 'submitted', body([answer(entry)]))
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

    expect(answersPayload(round, 'submitted', body([]))).not.toHaveProperty(
      'note',
    );
    expect(
      answersPayload(round, 'submitted', body([], { note: 'hello' })).note,
    ).toBe('hello');
  });

  it('keeps every structural key when the text is empty', () => {
    expect(Object.keys(entryFor({}))).toEqual(
      expect.arrayContaining([
        'index',
        'title',
        'status',
        'choice',
        'choice_text',
        'took_recommendation',
      ]),
    );
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
    const base = fingerprint(parseRound(args()));

    expect(fingerprint(parseRound(args({ heading: 'Other' })))).toBe(base);
    expect(fingerprint(parseRound(args({ overview: 'Other' })))).toBe(base);
  });

  it('changes with the question text', () => {
    const reworded = args({
      questions: [
        question({ ...BASE_QUESTION, question: 'Which name loses?' }),
      ],
    });

    expect(fingerprint(parseRound(reworded))).not.toBe(
      fingerprint(parseRound(args())),
    );
  });

  it('hashes a round with no findings as it did before findings existed', () => {
    expect(fingerprint(parseRound(args({ notices: [] })))).toBe(
      'af0111ce283d984c9577ca585f844661d2845e3473c03a5a84e49100c0bfb0c0',
    );
  });

  it('ignores an empty findings list', () => {
    expect(fingerprint(parseRound(args({ findings: [] })))).toBe(
      fingerprint(parseRound(args())),
    );
  });

  it('counts the findings', () => {
    expect(fingerprint(parseRound(args({ findings: [finding()] })))).not.toBe(
      fingerprint(parseRound(args())),
    );
  });

  it("changes with a finding's choice reason", () => {
    const withReason = (reason: string) =>
      args({
        findings: [
          finding({
            choices: [
              { text: 'Fix it now', reason: 'It is one line.' },
              { text: 'Leave it', reason },
            ],
          }),
        ],
      });

    expect(fingerprint(parseRound(withReason('Reloads are rare.')))).not.toBe(
      fingerprint(parseRound(withReason('Nobody reloads.'))),
    );
  });

  it('counts the notices', () => {
    expect(fingerprint(parseRound(args({ notices: [] })))).not.toBe(
      fingerprint(parseRound(args())),
    );
  });

  it("equals the Python server's fingerprint for the same round", () => {
    const round = parseRound({
      heading: 'Ignored heading',
      overview: 'Ignored overview',
      questions: [
        {
          title: 'Naming été \u{1F680}',
          context:
            'Line one\nline "two"\twith a tab, a backslash \\ and a bell \u0007 and \u2028',
          question: 'Which name should win?',
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

    expect(fingerprint(round)).toBe(
      '44bca4f5c40f6609e3e30934258689470c680de1b681feff4734ebcb2d5764f7',
    );
  });
});

describe('noRoundPayload', () => {
  it('is a normal payload that says to send the round again', () => {
    const payload = noRoundPayload();

    expect(payload.outcome).toBe('no_round');
    expect(payload.answers).toEqual([]);
    expect(payload.findings).toEqual([]);
    expect(payload.notices).toEqual([]);
    expect(payload.next).toContain('ask_round');
  });
});

describe('handedBackPayload', () => {
  it('names the earlier round and says to send the new one again', () => {
    const round = parseRound({
      heading: 'Earlier round',
      questions: [question()],
    });
    const saved = body([answer({ choice: 2 })]);

    const payload = handedBackPayload(round, 'submitted', saved);

    expect(payload.earlier_heading).toBe('Earlier round');
    expect(payload.answers).toEqual(
      answersPayload(round, 'submitted', saved).answers,
    );
    expect(payload.next).toContain('send it again');
  });
});
