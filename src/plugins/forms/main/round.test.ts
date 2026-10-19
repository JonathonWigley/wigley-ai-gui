import { describe, expect, it } from 'vitest';
import type { AnswerEntry, FormBody } from '../contract';
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

function answer(entry: Partial<AnswerEntry>): AnswerEntry {
  return {
    index: 1,
    choice: 0,
    not_applicable: false,
    what: '',
    why: '',
    dont_ask: false,
    dont_ask_reason: '',
    ...entry,
  };
}

function body(answers: AnswerEntry[], extra: Partial<FormBody> = {}): FormBody {
  return { note: '', answers, notice_comments: [], ...extra };
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

  it('names every missing question field and the six required names', () => {
    const partial: Record<string, unknown> = question();
    delete partial.context;
    delete partial.rationale;

    const message = roundError({ heading: 'H', questions: [partial] });

    expect(message).toContain('Question 1: missing context, rationale');
    expect(message).toContain(
      'title, context, question, choices, recommend, rationale',
    );
  });

  it('refuses an extra question field, saying the form draws its own controls', () => {
    const message = roundError({
      heading: 'H',
      questions: [question({ not_applicable: 'yes please' })],
    });

    expect(message).toContain('unknown field(s) not_applicable');
    expect(message).toContain('not-applicable control');
    expect(message).toContain("'what' and 'why' boxes");
  });

  it('refuses one choice as not a question', () => {
    const message = roundError({
      heading: 'H',
      questions: [question({ choices: ['only one'] })],
    });

    expect(message).toContain('is not a question');
  });

  it('refuses eleven choices and says to split the question', () => {
    const choices = Array.from({ length: 11 }, (_, n) => `choice ${n + 1}`);

    const message = roundError({
      heading: 'H',
      questions: [question({ choices })],
    });

    expect(message).toContain('Split it into two questions.');
  });

  it('refuses a blank choice, naming its number', () => {
    const message = roundError({
      heading: 'H',
      questions: [question({ choices: ['a', '  '] })],
    });

    expect(message).toContain(
      'Question 1: choices[2] must be a non-empty string.',
    );
  });

  it('names the title, the choice count and the legal range for an out-of-range recommend', () => {
    const message = roundError({
      heading: 'H',
      questions: [question({ choices: ['a', 'b'], recommend: 3 })],
    });

    expect(message).toContain("'Naming'");
    expect(message).toContain('has 2 choices');
    expect(message).toContain('from 1 to 2');
  });

  it('refuses a boolean recommend', () => {
    const message = roundError({
      heading: 'H',
      questions: [question({ recommend: true })],
    });

    expect(message).toContain('not bool');
  });

  it('refuses a fractional recommend', () => {
    const message = roundError({
      heading: 'H',
      questions: [question({ recommend: 1.5 })],
    });

    expect(message).toContain('not float');
  });

  it.each([['not a dict'], [['a list']], [null]])(
    'names all four top-level fields when args are not an object (%j)',
    (args) => {
      const message = roundError(args);

      expect(message).toContain(
        "'heading', 'overview', 'questions', and 'notices'",
      );
      expect(message).toContain(
        "'questions' is optional when 'notices' is given",
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

  it('refuses an empty questions list with no notices', () => {
    expect(roundError({ heading: 'H', questions: [] })).toBe(
      'ask_round needs at least one question or notice.',
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

  it.each([[{ heading: 'H', questions: [], notices: [] }], [{ heading: 'H' }]])(
    'refuses a round with neither questions nor notices (%j)',
    (args) => {
      expect(roundError(args)).toContain(
        'needs at least one question or notice',
      );
    },
  );

  it('names a missing notice field and the two required names', () => {
    const partial: Record<string, unknown> = notice();
    delete partial.context;

    const message = roundError({ heading: 'H', notices: [partial] });

    expect(message).toContain('Notice 1: missing context');
    expect(message).toContain('title, context');
  });

  it('refuses choices on a notice as an unknown field', () => {
    const message = roundError({
      heading: 'H',
      notices: [notice({ choices: ['a', 'b'] })],
    });

    expect(message).toContain('unknown field(s) choices');
    expect(message).toContain('no choices to describe');
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

  it('refuses a notice that is not an object', () => {
    expect(roundError({ heading: 'H', notices: ['not an object'] })).toBe(
      'Notice 1: each notice must be an object.',
    );
  });

  it('gives a notice the Applied badge by default', () => {
    expect(
      parseRound({ heading: 'H', notices: [notice()] }).notices[0].badge,
    ).toBe('Applied');
  });

  it.each(['Dispatched', 'Decided'])('accepts the %s badge', (badge) => {
    const round = parseRound({ heading: 'H', notices: [notice({ badge })] });

    expect(round.notices[0].badge).toBe(badge);
  });

  it('refuses a badge outside the closed set, naming the set and the value', () => {
    const message = roundError({
      heading: 'H',
      notices: [notice({ badge: 'In progress' })],
    });

    expect(message).toContain('badge must be one of');
    for (const badge of ['Applied', 'Dispatched', 'Decided']) {
      expect(message).toContain(badge);
    }
    expect(message).toContain("'In progress'");
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

describe('readFormBody', () => {
  it('reads one entry per question by index, with defaults where none was saved', () => {
    const round = roundOf(2);

    const read = readFormBody(round, {
      note: 'n',
      answers: [{ index: 2, choice: 1, what: 'w' }],
    });

    expect(read).toEqual(
      body([answer({ index: 1 }), answer({ index: 2, choice: 1, what: 'w' })], {
        note: 'n',
      }),
    );
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
        answer({
          index: 1,
          choice: 1,
          what: 'Went with a',
          why: 'It fits best',
        }),
        answer({
          index: 2,
          not_applicable: true,
          why: "Validation doesn't apply here",
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
          what: 'Went with a',
          why: 'It fits best',
        },
        {
          index: 2,
          title: 'Beta',
          status: 'not_applicable',
          choice: 0,
          choice_text: '',
          took_recommendation: false,
          why: "Validation doesn't apply here",
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

  it('leaves out empty what and why', () => {
    const entry = entryFor({ choice: 1 });

    expect(entry).not.toHaveProperty('what');
    expect(entry).not.toHaveProperty('why');
  });

  it('carries written what and why', () => {
    expect(
      entryFor({ choice: 1, what: 'my own', why: 'because' }),
    ).toMatchObject({
      what: 'my own',
      why: 'because',
    });
  });

  it('carries only the box that was written', () => {
    const entry = entryFor({ not_applicable: true, why: 'does not apply' });

    expect(entry).not.toHaveProperty('what');
    expect(entry.why).toBe('does not apply');
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
