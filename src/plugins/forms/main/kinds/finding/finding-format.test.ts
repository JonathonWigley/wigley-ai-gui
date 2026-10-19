import { describe, expect, it } from 'vitest';
import { FINDING_ACTIONS } from '../../../contract';
import { RoundError } from '../../round-error';
import { findingFormat } from './finding-format';

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

// A finding with no severity field.
function findingWithoutSeverity(overrides: Record<string, unknown>) {
  const { severity: _severity, ...rest } = finding(overrides);
  return rest;
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

  it('parses a caused finding to a Defect with its severity', () => {
    expect(findingFormat.parse(finding(), 'Finding 1: ')).toEqual({
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
    });
  });

  it('parses a design finding to a Decision with no severity', () => {
    const raw = findingWithoutSeverity({
      origin: 'design',
      recommend_action: 'follow_up',
    });

    expect(findingFormat.parse(raw, 'Finding 1: ')).toEqual({
      title: 'Stale cache',
      origin: 'design',
      impact: 'Users see stale data after a reload.',
      finding: 'The cache keeps entries after a reload.',
      proof: '- `cache.ts:40` never clears',
      choices: [
        { text: 'Fix it now', reason: 'It is one line.' },
        { text: 'Keep the cache', reason: 'Reloads are rare.' },
      ],
      recommend: 1,
      recommend_action: 'follow_up',
    });
  });

  it('parses a nit finding with its one fix', () => {
    const raw = findingWithoutSeverity({
      origin: 'nit',
      choices: [{ text: 'Rename it', reason: 'The name reads better.' }],
      recommend_action: 'leave_it',
    });

    expect(findingFormat.parse(raw, 'Finding 1: ')).toEqual({
      title: 'Stale cache',
      origin: 'nit',
      impact: 'Users see stale data after a reload.',
      finding: 'The cache keeps entries after a reload.',
      proof: '- `cache.ts:40` never clears',
      choices: [{ text: 'Rename it', reason: 'The name reads better.' }],
      recommend: 1,
      recommend_action: 'leave_it',
    });
  });

  it('names a missing origin and impact and what each origin needs', () => {
    const partial: Record<string, unknown> = finding();
    delete partial.origin;
    delete partial.impact;

    expect(parseError(partial)).toBe(
      'Finding 1: missing impact, origin. Every finding needs title, origin, ' +
        'impact, finding, proof, choices, recommend, recommend_action; a ' +
        'caused or pre_existing finding also needs severity.',
    );
  });

  it('refuses an origin outside the four', () => {
    expect(parseError(finding({ origin: 'style' }))).toBe(
      "Finding 1: origin must be one of 'caused', 'pre_existing', 'design', " +
        "and 'nit'.",
    );
  });

  it('refuses a pre_existing finding with no severity, naming its origin', () => {
    const raw = findingWithoutSeverity({ origin: 'pre_existing' });

    expect(parseError(raw)).toBe(
      'Finding 1: a pre_existing finding needs severity.',
    );
  });

  it('refuses severity on a design finding', () => {
    expect(parseError(finding({ origin: 'design' }))).toBe(
      'Finding 1: severity is only for a caused or pre_existing finding.',
    );
  });

  it('refuses a severity outside the three', () => {
    expect(parseError(finding({ severity: 'major' }))).toBe(
      "Finding 1: severity must be one of 'critical', 'important', and " +
        "'minor'.",
    );
  });

  it('refuses a nit finding with two choices', () => {
    const raw = findingWithoutSeverity({ origin: 'nit' });

    expect(parseError(raw)).toBe(
      'Finding 1: a nit finding takes exactly 1 choice: the fix.',
    );
  });

  it('refuses a design finding with one choice', () => {
    const raw = findingWithoutSeverity({
      origin: 'design',
      choices: [{ text: 'a', reason: 'r' }],
    });

    expect(parseError(raw)).toBe(
      'Finding 1: a design finding takes 2 to 10 choices.',
    );
  });

  it('refuses a choice opening with an action word, naming it', () => {
    const raw = finding({
      choices: [{ text: 'Fix now: share the rule', reason: 'r' }],
    });

    expect(parseError(raw)).toBe(
      'Finding 1: choices[1].text opens with "Fix now", an action. A choice ' +
        'names a solution; the card draws its own action control.',
    );
  });

  it('refuses a choice opening with an action word before punctuation', () => {
    const raw = finding({
      choices: [{ text: 'Leave it: keep the guard', reason: 'r' }],
    });

    expect(parseError(raw)).toContain(
      'choices[1].text opens with "Leave it", an action.',
    );
  });

  it('accepts a choice whose first word only starts like an action word', () => {
    const raw = finding({
      choices: [{ text: 'Leave items cached', reason: 'r' }],
    });

    expect(findingFormat.parse(raw, 'Finding 1: ').choices).toEqual([
      { text: 'Leave items cached', reason: 'r' },
    ]);
  });

  it('refuses follow_up on a nit finding', () => {
    const raw = findingWithoutSeverity({
      origin: 'nit',
      choices: [{ text: 'a', reason: 'r' }],
      recommend_action: 'follow_up',
    });

    expect(parseError(raw)).toBe(
      'Finding 1: a nit finding offers fix_now or leave_it.',
    );
  });

  it('refuses a recommend_action outside the three actions', () => {
    expect(parseError(finding({ recommend_action: 'Fix now' }))).toBe(
      "Finding 1: recommend_action must be one of 'fix_now', 'follow_up', " +
        "and 'leave_it'.",
    );
  });

  it('refuses an extra finding field, saying the form draws its own controls', () => {
    const message = parseError(finding({ context: 'x' }));

    expect(message).toContain('unknown field(s) context');
    expect(message).toContain('the action control');
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
          { text: 'Keep the cache', reason: 'Reloads are rare.' },
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
          { text: 'Keep the cache', reason: '  ' },
        ],
      }),
    );

    expect(message).toContain(
      'Finding 1: choices[2].reason must be a non-empty string.',
    );
  });

  it('accepts a single solution on a caused finding', () => {
    const lone = finding({ choices: [{ text: 'a', reason: 'r' }] });

    expect(findingFormat.parse(lone, 'Finding 1: ')).toEqual(lone);
  });

  it('refuses a caused finding with zero choices or eleven', () => {
    const choice = { text: 'a', reason: 'r' };
    const bound = 'Finding 1: a caused finding takes 1 to 10 choices.';

    expect(parseError(finding({ choices: [] }))).toBe(bound);
    expect(
      parseError(
        finding({ choices: Array.from({ length: 11 }, () => choice) }),
      ),
    ).toBe(bound);
  });

  it('names the title and the legal range for an out-of-range recommend', () => {
    const message = parseError(finding({ recommend: 3 }));

    expect(message).toContain("'Stale cache'");
    expect(message).toContain('from 1 to 2');
  });

  it('counts a lone solution in the singular for an out-of-range recommend', () => {
    const lone = finding({
      choices: [{ text: 'a', reason: 'r' }],
      recommend: 2,
    });

    expect(parseError(lone)).toBe(
      "Finding 1: 'Stale cache' has 1 solution; recommend was 2. " +
        'Use a number from 1 to 1.',
    );
  });
});

describe('findingFormat.answerSubject', () => {
  it('gives the result builder its title, choice texts and recommend', () => {
    const parsed = findingFormat.parse(finding(), 'Finding 1: ');

    expect(findingFormat.answerSubject(parsed)).toEqual({
      title: 'Stale cache',
      choiceTexts: ['Fix it now', 'Keep the cache'],
      recommend: 1,
    });
  });
});

describe('findingFormat.arraySchema', () => {
  it('offers the three actions for recommend_action and takes one solution', () => {
    const items = findingFormat.arraySchema.items as {
      properties: {
        recommend_action: { enum: string[] };
        choices: { minItems: number };
      };
    };

    expect(items.properties.recommend_action.enum).toEqual([
      ...FINDING_ACTIONS,
    ]);
    expect(items.properties.choices.minItems).toBe(1);
  });
});

describe('findingFormat.fingerprintContent', () => {
  it('differs when only the origin, impact or severity differs', () => {
    const content = (overrides: Record<string, unknown>) =>
      JSON.stringify(
        findingFormat.fingerprintContent(
          findingFormat.parse(finding(overrides), 'Finding 1: '),
        ),
      );
    const base = content({});

    expect(content({ origin: 'pre_existing' })).not.toBe(base);
    expect(content({ impact: 'Nobody notices.' })).not.toBe(base);
    expect(content({ severity: 'minor' })).not.toBe(base);
  });

  it('differs when only recommend_action differs', () => {
    const content = (recommend_action: string) =>
      JSON.stringify(
        findingFormat.fingerprintContent(
          findingFormat.parse(finding({ recommend_action }), 'Finding 1: '),
        ),
      );

    expect(content('fix_now')).not.toBe(content('leave_it'));
  });
});
