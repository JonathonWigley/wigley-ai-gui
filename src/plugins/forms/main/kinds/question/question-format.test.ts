import { describe, expect, it } from 'vitest';
import { RoundError } from '../../round-error';
import { questionFormat } from './question-format';

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

// The message of the RoundError the question format throws for this item.
function parseError(raw: unknown): string {
  try {
    questionFormat.parse(raw, 'Question 1: ');
  } catch (error) {
    if (error instanceof RoundError) {
      return error.message;
    }
    throw error;
  }
  throw new Error('the question format accepted the question');
}

describe('questionFormat.parse', () => {
  it('names every missing question field and the six required names', () => {
    const partial: Record<string, unknown> = question();
    delete partial.context;
    delete partial.rationale;

    const message = parseError(partial);

    expect(message).toContain('Question 1: missing context, rationale');
    expect(message).toContain(
      'title, context, question, choices, recommend, rationale',
    );
  });

  it('refuses an extra question field, saying the form draws its own controls', () => {
    const message = parseError(question({ not_applicable: 'yes please' }));

    expect(message).toContain('unknown field(s) not_applicable');
    expect(message).toContain('not-applicable control');
    expect(message).toContain('the Notes box');
  });

  it('refuses one choice as not a question', () => {
    const message = parseError(question({ choices: ['only one'] }));

    expect(message).toContain('is not a question');
  });

  it('refuses eleven choices and says to split the question', () => {
    const choices = Array.from({ length: 11 }, (_, n) => `choice ${n + 1}`);

    const message = parseError(question({ choices }));

    expect(message).toContain('Split it into two questions.');
  });

  it('refuses a blank choice, naming its number', () => {
    const message = parseError(question({ choices: ['a', '  '] }));

    expect(message).toContain(
      'Question 1: choices[2] must be a non-empty string.',
    );
  });

  it('names the title, the choice count and the legal range for an out-of-range recommend', () => {
    const message = parseError(question({ choices: ['a', 'b'], recommend: 3 }));

    expect(message).toContain("'Naming'");
    expect(message).toContain('has 2 choices');
    expect(message).toContain('from 1 to 2');
  });

  it('refuses a boolean recommend', () => {
    const message = parseError(question({ recommend: true }));

    expect(message).toContain('not bool');
  });

  it('refuses a fractional recommend', () => {
    const message = parseError(question({ recommend: 1.5 }));

    expect(message).toContain('not float');
  });
});

describe('questionFormat.answerSubject', () => {
  it('gives the result builder its title, choices and recommend', () => {
    const parsed = questionFormat.parse(
      question({ choices: ['a', 'b'], recommend: 2 }),
      'Question 1: ',
    );

    expect(questionFormat.answerSubject(parsed)).toEqual({
      title: 'Naming',
      choiceTexts: ['a', 'b'],
      recommend: 2,
    });
  });
});
