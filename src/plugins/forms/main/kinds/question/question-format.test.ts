import { describe, expect, it } from 'vitest';
import { roundErrorText } from '../../mcp-wording';
import { RoundError, type RoundItemPath } from '../../round-error';
import { questionFormat } from './question-format';

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
    questionFormat.parse(raw, QUESTION_1);
  } catch (error) {
    if (error instanceof RoundError) {
      return roundErrorText(error);
    }
    throw error;
  }
  throw new Error('the question format accepted the question');
}

describe('questionFormat.parse', () => {
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
      expect(questionFormat.parse(withFields(fields), QUESTION_1).summary).toBe(
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
      questionFormat.parse(question({ layout: 'compact' }), QUESTION_1).layout,
    ).toBe('compact');
    expect(questionFormat.parse(question(), QUESTION_1).layout).toBeNull();
  });

  it('refuses a fractional recommend', () => {
    const message = parseError(question({ recommend: 1.5 }));

    expect(message).toContain('float');
  });
});

describe('questionFormat.answerSubject', () => {
  it('gives the result builder its title, choices and recommend', () => {
    const parsed = questionFormat.parse(
      question({ choices: ['a', 'b'], recommend: 2 }),
      QUESTION_1,
    );

    expect(questionFormat.answerSubject(parsed)).toEqual({
      title: 'Naming',
      choiceTexts: ['a', 'b'],
      recommend: 2,
    });
  });
});
