import { describe, expect, it } from 'vitest';
import { RoundError } from '../../round-error';
import { findingFormat } from './finding-format';

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
    ...overrides,
  };
}

// The message of the RoundError the finding format throws for this item.
function parseError(raw: unknown): string {
  try {
    findingFormat.parse(raw, 'Finding 1: ');
  } catch (error) {
    if (error instanceof RoundError) {
      return error.message;
    }
    throw error;
  }
  throw new Error('the finding format accepted the finding');
}

describe('findingFormat.parse', () => {
  it('keeps checking its own field lists when a caller grows the published schema', () => {
    const items = findingFormat.arraySchema.items as {
      required: string[];
      properties: { choices: { items: { required: string[] } } };
    };
    const choiceItems = items.properties.choices.items;
    items.required.push('owner');
    choiceItems.required.push('cost');
    try {
      expect(findingFormat.parse(finding(), 'Finding 1: ')).toEqual(finding());
    } finally {
      items.required.pop();
      choiceItems.required.pop();
    }
  });

  it("parses a finding with its five fields and each choice's reason", () => {
    expect(findingFormat.parse(finding(), 'Finding 1: ')).toEqual(finding());
  });

  it('names every missing finding field and the five required names', () => {
    const partial: Record<string, unknown> = finding();
    delete partial.proof;
    delete partial.recommend;

    const message = parseError(partial);

    expect(message).toContain('Finding 1: missing proof, recommend');
    expect(message).toContain('title, finding, proof, choices, recommend');
  });

  it('refuses an extra finding field, saying the form draws its own controls', () => {
    const message = parseError(finding({ context: 'x' }));

    expect(message).toContain('unknown field(s) context');
    expect(message).toContain('the Notes box');
  });

  it('refuses a choice given as a plain string', () => {
    const message = parseError(finding({ choices: ['a', 'b'] }));

    expect(message).toContain(
      'Finding 1: choices[1] must be an object with text and reason.',
    );
  });

  it("names a choice's missing reason", () => {
    const message = parseError(
      finding({ choices: [{ text: 'a', reason: 'r' }, { text: 'b' }] }),
    );

    expect(message).toContain('Finding 1: choices[2] missing reason.');
  });

  it('refuses an unknown choice field', () => {
    const message = parseError(
      finding({
        choices: [
          { text: 'Fix it now', reason: 'It is one line.', recommended: true },
          { text: 'Leave it', reason: 'Reloads are rare.' },
        ],
      }),
    );

    expect(message).toContain('choices[1] unknown field(s) recommended.');
  });

  it('refuses a blank reason, naming its choice', () => {
    const message = parseError(
      finding({
        choices: [
          { text: 'Fix it now', reason: 'It is one line.' },
          { text: 'Leave it', reason: '  ' },
        ],
      }),
    );

    expect(message).toContain(
      'Finding 1: choices[2].reason must be a non-empty string.',
    );
  });

  it('refuses one choice and eleven choices', () => {
    const choice = { text: 'a', reason: 'r' };

    expect(parseError(finding({ choices: [choice] }))).toContain(
      'has 1 choice(s)',
    );
    expect(
      parseError(
        finding({ choices: Array.from({ length: 11 }, () => choice) }),
      ),
    ).toContain(
      'has 11 choices; the maximum is 10. Split it into two findings.',
    );
  });

  it('names the title and the legal range for an out-of-range recommend', () => {
    const message = parseError(finding({ recommend: 3 }));

    expect(message).toContain("'Stale cache'");
    expect(message).toContain('from 1 to 2');
  });
});

describe('findingFormat.answerSubject', () => {
  it('gives the result builder its title, choice texts and recommend', () => {
    const parsed = findingFormat.parse(finding(), 'Finding 1: ');

    expect(findingFormat.answerSubject(parsed)).toEqual({
      title: 'Stale cache',
      choiceTexts: ['Fix it now', 'Leave it'],
      recommend: 1,
    });
  });
});
