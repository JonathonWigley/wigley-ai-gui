import { describe, expect, it } from 'vitest';
import { roundErrorText } from '../../mcp-wording';
import { RoundError, type RoundItemPath } from '../../../contract';
import { BUILT_IN_KINDS } from '../formats';
import { questionAnswerSubject, questionKind } from './question-format';

const QUESTION_1: RoundItemPath = { at: 'item', kind: 'question', number: 1 };

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

// A question with these fields set, and each one given as undefined deleted.
function withFields(fields: Record<string, unknown>) {
  const item: Record<string, unknown> = question(fields);
  for (const [field, value] of Object.entries(fields)) {
    if (value === undefined) {
      delete item[field];
    }
  }
  return item;
}

// The tool error text of the RoundError the question format throws for this
// item.
function parseError(raw: unknown): string {
  try {
    questionKind.parse(raw, QUESTION_1);
  } catch (error) {
    if (error instanceof RoundError) {
      return roundErrorText(BUILT_IN_KINDS, error);
    }
    throw error;
  }
  throw new Error('the question format accepted the question');
}

describe('questionKind.parse', () => {
  it.each([
    { deleted: ['context', 'rationale'], names: 'context, rationale' },
    { deleted: ['summary'], names: 'summary.' },
  ])(
    'names every missing question field and the six required names: $deleted',
    ({ deleted, names }) => {
      const partial: Record<string, unknown> = question();
      for (const field of deleted) {
        delete partial[field];
      }

      const message = parseError(partial);

      expect(message.startsWith(`Question 1: missing ${names}`)).toBe(true);
      expect(message).toContain(
        'title, summary, context, choices, recommend, rationale',
      );
    },
  );

  it.each([
    { fields: { summary: 'S' }, summary: 'S' },
    { fields: { summary: undefined, question: 'Q' }, summary: 'Q' },
  ])(
    "reads the summary from summary, or from a saved round's question: $summary",
    ({ fields, summary }) => {
      expect(questionKind.parse(withFields(fields), QUESTION_1).summary).toBe(
        summary,
      );
    },
  );

  it.each([
    { fields: { summary: '  ' } },
    { fields: { summary: undefined, question: '  ' } },
  ])(
    'refuses a blank summary or a blank legacy question, naming summary: $fields',
    ({ fields }) => {
      expect(parseError(withFields(fields))).toMatch(
        /^Question 1: summary must be a non-empty string/,
      );
    },
  );

  it('refuses a question with both summary and question, naming both', () => {
    const message = parseError(
      question({ question: 'Which name should win?' }),
    );

    expect(message).toMatch(/^Question 1: .*summary.*question/);
  });

  it('refuses an extra question field, naming it', () => {
    const message = parseError(question({ not_applicable: 'yes please' }));

    expect(message).toContain('not_applicable');
  });

  it('refuses one choice as not a question', () => {
    const message = parseError(question({ choices: ['only one'] }));

    expect(message).toMatch(/^Question 1: /);
  });

  it('refuses ten choices, one past the number keys, naming the count and the cap', () => {
    const choices = Array.from({ length: 10 }, (_, n) => `choice ${n + 1}`);

    const message = parseError(question({ choices }));

    expect(message).toMatch(/^Question 1: has 10 choices.*\b9\b/);
  });

  it('refuses a blank choice, naming its number', () => {
    const message = parseError(question({ choices: ['a', '  '] }));

    expect(message).toMatch(/^Question 1: .*choices\[2\]/);
  });

  it('names the title, the choice count and the legal range for an out-of-range recommend', () => {
    const message = parseError(question({ choices: ['a', 'b'], recommend: 3 }));

    expect(message).toContain("'Naming'");
    expect(message).toMatch(/\b2\b.*\b1\b.*\b2\b/);
  });

  it('refuses a boolean recommend', () => {
    const message = parseError(question({ recommend: true }));

    expect(message).toContain('bool');
  });

  it('accepts an optional layout', () => {
    expect(
      questionKind.parse(question({ layout: 'compact' }), QUESTION_1).layout,
    ).toBe('compact');
    expect(questionKind.parse(question(), QUESTION_1).layout).toBeNull();
  });

  it('refuses a fractional recommend', () => {
    const message = parseError(question({ recommend: 1.5 }));

    expect(message).toContain('float');
  });

  it('reads approves in the order sent, and [] when left out', () => {
    const approves = [
      { choice: 2, action: 'push main past PR protection' },
      { choice: 1, action: 'release the pool hold' },
    ];

    expect(
      questionKind.parse(question({ approves }), QUESTION_1).approves,
    ).toEqual(approves);
    expect(questionKind.parse(question(), QUESTION_1).approves).toEqual([]);
  });

  it.each([
    {
      case: 'a choice past the last',
      approves: [{ choice: 3, action: 'x' }],
      names: 'approves[1].choice',
    },
    {
      case: 'choice 0',
      approves: [{ choice: 0, action: 'x' }],
      names: 'approves[1].choice',
    },
    {
      case: 'a fractional choice',
      approves: [{ choice: 1.5, action: 'x' }],
      names: 'approves[1].choice',
    },
    {
      case: 'a blank action',
      approves: [{ choice: 1, action: ' ' }],
      names: 'approves[1].action',
    },
    {
      case: 'a missing action',
      approves: [{ choice: 1 }],
      names: 'approves[1]',
    },
    {
      case: 'an extra field',
      approves: [{ choice: 1, action: 'x', note: 'n' }],
      names: 'approves[1]',
    },
    { case: 'a string entry', approves: ['push'], names: 'approves[1]' },
    {
      case: 'an object, not a list',
      approves: { choice: 1, action: 'x' },
      names: 'approves',
    },
    {
      case: 'a bad second entry',
      approves: [
        { choice: 1, action: 'x' },
        { choice: 9, action: 'y' },
      ],
      names: 'approves[2].choice',
    },
  ])('refuses approves with $case, naming the entry', ({ approves, names }) => {
    expect(parseError(question({ approves }))).toContain(names);
  });
});

describe('questionKind.approvedActions', () => {
  const approves = [
    { choice: 2, action: 'push main past PR protection' },
    { choice: 2, action: 'delete the remote branch' },
    { choice: 3, action: 'release the pool hold' },
  ];
  const parsed = questionKind.parse(
    question({ choices: ['a', 'b', 'c'], approves }),
    QUESTION_1,
  );
  const entry = (choice: number, notApplicable = false) => ({
    index: 1,
    choice,
    not_applicable: notApplicable,
    notes: '',
    dont_ask: false,
    dont_ask_reason: '',
  });

  it.each([
    {
      case: 'a choice tagged twice',
      entry: entry(2),
      actions: ['push main past PR protection', 'delete the remote branch'],
    },
    {
      case: 'a choice tagged once',
      entry: entry(3),
      actions: ['release the pool hold'],
    },
    { case: 'an untagged choice', entry: entry(1), actions: [] },
    {
      case: 'a tagged choice marked not applicable',
      entry: entry(2, true),
      actions: [],
    },
    { case: 'no pick', entry: entry(0), actions: [] },
  ])('gives the actions of $case', ({ entry: picked, actions }) => {
    expect(questionKind.approvedActions?.(parsed, picked)).toEqual(actions);
  });
});

describe('questionKind.answerSubject', () => {
  it('gives the result builder its title, choices and recommend', () => {
    const parsed = questionKind.parse(
      question({ choices: ['a', 'b'], recommend: 2 }),
      QUESTION_1,
    );

    expect(questionAnswerSubject(parsed)).toEqual({
      title: 'Naming',
      choiceTexts: ['a', 'b'],
      recommend: 2,
    });
  });
});
