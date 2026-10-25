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

// A finding with no recommend field.
function findingWithoutRecommend(overrides: Record<string, unknown>) {
  const { recommend: _recommend, ...rest } = finding(overrides);
  return rest;
}

// A nit finding: one fix, recommending leave_it, so no recommend.
function nitFinding(overrides: Record<string, unknown> = {}) {
  const {
    severity: _severity,
    recommend: _recommend,
    ...rest
  } = finding({
    origin: 'nit',
    choices: [{ text: 'Rename it', reason: 'The name reads better.' }],
    recommend_action: 'leave_it',
    ...overrides,
  });
  return rest;
}

// Choice 1 sits under fix_now, choice 2 under follow_up.
const TWO_ACTION_CHOICES = [
  { text: 'Fix it now', reason: 'It is one line.' },
  { text: 'Keep the cache', reason: 'Reloads are rare.', action: 'follow_up' },
];

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
    const parsed = findingFormat.parse(finding(), 'Finding 1: ');
    items.required.push('owner');
    choiceItems.required.push('cost');
    try {
      expect(findingFormat.parse(finding(), 'Finding 1: ')).toEqual(parsed);
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
        { text: 'Fix it now', reason: 'It is one line.', action: 'fix_now' },
        {
          text: 'Keep the cache',
          reason: 'Reloads are rare.',
          action: 'fix_now',
        },
      ],
      recommend: 1,
      recommend_action: 'fix_now',
      actionReasons: {},
      layout: null,
    });
  });

  it('parses a design finding to a Decision with no severity', () => {
    const raw = findingWithoutSeverity({
      origin: 'design',
      choices: TWO_ACTION_CHOICES,
      recommend: 2,
      recommend_action: 'follow_up',
    });

    expect(findingFormat.parse(raw, 'Finding 1: ')).toEqual({
      title: 'Stale cache',
      origin: 'design',
      impact: 'Users see stale data after a reload.',
      finding: 'The cache keeps entries after a reload.',
      proof: '- `cache.ts:40` never clears',
      choices: [
        { text: 'Fix it now', reason: 'It is one line.', action: 'fix_now' },
        {
          text: 'Keep the cache',
          reason: 'Reloads are rare.',
          action: 'follow_up',
        },
      ],
      recommend: 2,
      recommend_action: 'follow_up',
      actionReasons: {},
      layout: null,
    });
  });

  it('parses a nit finding with its one fix', () => {
    expect(findingFormat.parse(nitFinding(), 'Finding 1: ')).toEqual({
      title: 'Stale cache',
      origin: 'nit',
      impact: 'Users see stale data after a reload.',
      finding: 'The cache keeps entries after a reload.',
      proof: '- `cache.ts:40` never clears',
      choices: [
        {
          text: 'Rename it',
          reason: 'The name reads better.',
          action: 'fix_now',
        },
      ],
      recommend: null,
      recommend_action: 'leave_it',
      actionReasons: {},
      layout: null,
    });
  });

  it('parses a choice with no action as fix_now', () => {
    expect(
      findingFormat.parse(finding(), 'Finding 1: ').choices[0].action,
    ).toBe('fix_now');
  });

  it('keeps a choice action the origin offers', () => {
    const raw = finding({ choices: TWO_ACTION_CHOICES });

    expect(findingFormat.parse(raw, 'Finding 1: ').choices[1].action).toBe(
      'follow_up',
    );
  });

  it('refuses a choice action outside the three', () => {
    const raw = finding({
      choices: [
        { text: 'Fix it now', reason: 'It is one line.' },
        {
          text: 'Keep the cache',
          reason: 'Reloads are rare.',
          action: 'later',
        },
      ],
    });

    expect(parseError(raw)).toBe(
      "Finding 1: choices[2].action must be one of 'fix_now', 'follow_up', " +
        "and 'leave_it'.",
    );
  });

  it('refuses a follow_up choice on a nit finding, naming what it offers', () => {
    const raw = nitFinding({
      choices: [
        { text: 'Rename it', reason: 'It reads better.', action: 'follow_up' },
      ],
    });

    expect(parseError(raw)).toBe(
      'Finding 1: choices[1].action is follow_up, which a nit finding does ' +
        'not offer; it offers fix_now or leave_it.',
    );
  });

  it('refuses a finding with no fix_now choice', () => {
    const raw = finding({
      choices: [
        { text: 'Track it', reason: 'Later.', action: 'follow_up' },
        {
          text: 'Rework the cache',
          reason: 'Later still.',
          action: 'follow_up',
        },
      ],
    });

    expect(parseError(raw)).toBe(
      'Finding 1: no choice has action fix_now. A finding needs at least one ' +
        'fix_now choice; a choice with no action is fix_now.',
    );
  });

  it('parses action_reasons for the deferral actions the origin offers', () => {
    const raw = finding({
      action_reasons: { follow_up: 'The plan covers it.', leave_it: 'Rare.' },
    });

    expect(findingFormat.parse(raw, 'Finding 1: ').actionReasons).toEqual({
      follow_up: 'The plan covers it.',
      leave_it: 'Rare.',
    });
  });

  it('reads absent action_reasons as none', () => {
    expect(findingFormat.parse(finding(), 'Finding 1: ').actionReasons).toEqual(
      {},
    );
  });

  it('reads null action_reasons as none', () => {
    const raw = finding({ action_reasons: null });

    expect(findingFormat.parse(raw, 'Finding 1: ').actionReasons).toEqual({});
  });

  it('refuses action_reasons for fix_now or an unknown key', () => {
    const raw = finding({ action_reasons: { fix_now: 'x', later: 'y' } });

    expect(parseError(raw)).toBe(
      'Finding 1: action_reasons unknown key(s) fix_now, later. It takes ' +
        'follow_up and leave_it, the deferral actions.',
    );
  });

  it('refuses action_reasons.follow_up on a nit finding', () => {
    const raw = nitFinding({ action_reasons: { follow_up: 'Later.' } });

    expect(parseError(raw)).toBe(
      'Finding 1: action_reasons.follow_up is for an action a nit finding ' +
        'does not offer; it offers fix_now or leave_it.',
    );
  });

  it('refuses action_reasons that is not an object', () => {
    expect(parseError(finding({ action_reasons: 'Later.' }))).toBe(
      'Finding 1: action_reasons must be an object with follow_up, leave_it ' +
        'or both.',
    );
  });

  it('refuses a blank action_reasons entry', () => {
    expect(parseError(finding({ action_reasons: { leave_it: ' ' } }))).toBe(
      'Finding 1: action_reasons.leave_it must be a non-empty string. Give ' +
        'it the text you would have written in the reply.',
    );
  });

  it('leaves recommend null when recommend_action has no choices', () => {
    const raw = findingWithoutRecommend({ recommend_action: 'leave_it' });

    expect(findingFormat.parse(raw, 'Finding 1: ').recommend).toBeNull();
  });

  it('reads a null recommend as absent when recommend_action has no choices', () => {
    const raw = finding({ recommend: null, recommend_action: 'leave_it' });

    expect(findingFormat.parse(raw, 'Finding 1: ').recommend).toBeNull();
  });

  it('refuses a missing recommend when recommend_action has choices', () => {
    const raw = findingWithoutRecommend({ recommend_action: 'fix_now' });

    expect(parseError(raw)).toBe(
      'Finding 1: missing recommend. recommend_action is fix_now, which has ' +
        'choices, so recommend names one of them; leave recommend out only ' +
        'when recommend_action has no choices.',
    );
  });

  it('refuses recommend when recommend_action has no choices', () => {
    const raw = finding({ recommend: 1, recommend_action: 'leave_it' });

    expect(parseError(raw)).toBe(
      'Finding 1: recommend names a choice, but no choice has action ' +
        'leave_it, the recommend_action. Leave recommend out when the ' +
        'recommended action has no choices.',
    );
  });

  it('refuses a recommend naming a choice of another action', () => {
    const raw = finding({
      choices: TWO_ACTION_CHOICES,
      recommend: 2,
      recommend_action: 'fix_now',
    });

    expect(parseError(raw)).toBe(
      'Finding 1: recommend is 2, a follow_up choice, but recommend_action ' +
        'is fix_now. recommend names a choice of the recommended action.',
    );
  });

  it('keeps a layout name as sent and reads an absent one as null', () => {
    expect(
      findingFormat.parse(finding({ layout: 'compact' }), 'Finding 1: ').layout,
    ).toBe('compact');
    expect(findingFormat.parse(finding(), 'Finding 1: ').layout).toBeNull();
  });

  it('names a missing origin and impact and what each origin needs', () => {
    const partial: Record<string, unknown> = finding();
    delete partial.origin;
    delete partial.impact;

    expect(parseError(partial)).toBe(
      'Finding 1: missing impact, origin. Every finding needs title, origin, ' +
        'impact, finding, proof, choices, recommend_action; a caused or ' +
        'pre_existing finding also needs severity.',
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
      'Finding 1: a design finding takes 2 to 9 choices.',
    );
  });

  it('refuses a choice opening with an action word, naming it', () => {
    const raw = finding({
      choices: [{ text: 'Fix now: share the rule', reason: 'r' }],
    });

    expect(parseError(raw)).toBe(
      'Finding 1: choices[1].text opens with "Fix now", an action. A choice ' +
        'names a solution; its action field sets the action it sits under.',
    );
  });

  it('refuses an action word after leading spaces and in any case, naming it as the table spells it', () => {
    const raw = finding({
      choices: [{ text: '  fix NOW: share the rule', reason: 'r' }],
    });

    expect(parseError(raw)).toBe(
      'Finding 1: choices[1].text opens with "Fix now", an action. A choice ' +
        'names a solution; its action field sets the action it sits under.',
    );
  });

  it('refuses a choice opening with an action word before punctuation', () => {
    const raw = finding({
      choices: [{ text: 'Leave it: keep the guard', reason: 'r' }],
    });

    expect(parseError(raw)).toBe(
      'Finding 1: choices[1].text opens with "Leave it", an action. A choice ' +
        'names a solution; its action field sets the action it sits under.',
    );
  });

  it('accepts a choice whose first word only starts like an action word', () => {
    const raw = finding({
      choices: [{ text: 'Leave items cached', reason: 'r' }],
    });

    expect(findingFormat.parse(raw, 'Finding 1: ').choices).toEqual([
      { text: 'Leave items cached', reason: 'r', action: 'fix_now' },
    ]);
  });

  it('refuses an action word wrapped in bold before punctuation', () => {
    const raw = finding({
      choices: [{ text: '**Fix now**: share the rule', reason: 'r' }],
    });

    expect(parseError(raw)).toBe(
      'Finding 1: choices[1].text opens with "Fix now", an action. A choice ' +
        'names a solution; its action field sets the action it sits under.',
    );
  });

  it('refuses an action word wrapped in inline code', () => {
    const raw = finding({ choices: [{ text: '`Leave it`', reason: 'r' }] });

    expect(parseError(raw)).toBe(
      'Finding 1: choices[1].text opens with "Leave it", an action. A choice ' +
        'names a solution; its action field sets the action it sits under.',
    );
  });

  it('accepts an emphasised choice whose first word only starts like an action word', () => {
    const raw = finding({
      choices: [{ text: '_Leave items cached_', reason: 'r' }],
    });

    expect(findingFormat.parse(raw, 'Finding 1: ').choices).toEqual([
      { text: '_Leave items cached_', reason: 'r', action: 'fix_now' },
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
    expect(parseError(finding({ context: 'x' }))).toBe(
      'Finding 1: unknown field(s) context. The form draws the ' +
        'not-applicable control and the Notes box itself; do not describe ' +
        'them.',
    );
  });

  it('refuses a choice given as a plain string', () => {
    expect(parseError(finding({ choices: ['a', 'b'] }))).toBe(
      'Finding 1: choices[1] must be an object with text, reason and an ' +
        'optional action.',
    );
  });

  it("names a choice's missing reason", () => {
    const message = parseError(
      finding({ choices: [{ text: 'a', reason: 'r' }, { text: 'b' }] }),
    );

    expect(message).toBe(
      'Finding 1: choices[2] missing reason. Each choice takes text and ' +
        'reason, and an optional action.',
    );
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

    expect(message).toBe(
      'Finding 1: choices[1] unknown field(s) recommended. Each choice takes ' +
        'text and reason, and an optional action.',
    );
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

    expect(findingFormat.parse(lone, 'Finding 1: ').choices).toEqual([
      { text: 'a', reason: 'r', action: 'fix_now' },
    ]);
  });

  it('refuses a caused finding with zero choices or ten', () => {
    const choice = { text: 'a', reason: 'r' };
    const bound = 'Finding 1: a caused finding takes 1 to 9 choices.';

    expect(parseError(finding({ choices: [] }))).toBe(bound);
    expect(
      parseError(
        finding({ choices: Array.from({ length: 10 }, () => choice) }),
      ),
    ).toBe(bound);
  });

  it('refuses a finding numbering 10 entries, one past the number keys', () => {
    const choice = { text: 'a', reason: 'r' };
    // 8 fix_now choices, then the follow_up and leave_it headers.
    const raw = finding({ choices: Array.from({ length: 8 }, () => choice) });

    expect(parseError(raw)).toBe(
      'Finding 1: the card would number 10 entries — its choices plus a ' +
        'header for each action with no choices — and the page has 9 number ' +
        'keys. Give fewer choices, or move a fix_now choice under an action ' +
        'drawn as a header, which the choice replaces.',
    );
  });

  it('accepts a finding numbering exactly 9 entries', () => {
    const choice = { text: 'a', reason: 'r' };
    // 7 fix_now choices, then the follow_up and leave_it headers.
    const raw = finding({ choices: Array.from({ length: 7 }, () => choice) });

    expect(findingFormat.parse(raw, 'Finding 1: ').choices).toHaveLength(7);
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
    const headerRecommended = findingFormat.parse(
      findingWithoutRecommend({ recommend_action: 'leave_it' }),
      'Finding 1: ',
    );
    expect(findingFormat.answerSubject(headerRecommended).recommend).toBe(0);
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

  it("describes each origin's card, each card's choice count and the action a Nit lacks", () => {
    const items = findingFormat.arraySchema.items as {
      properties: Record<
        'origin' | 'choices' | 'recommend_action' | 'severity',
        {
          description: string;
        }
      >;
    };
    const { origin, choices, recommend_action, severity } = items.properties;

    expect(origin.description).toContain("'design' (Decision): a design call");
    expect(choices.description).toContain(
      'a Defect takes 1 to 9 choices, its solutions; a Decision takes 2 ' +
        'to 9 choices, the options a plan would weigh; a Nit takes ' +
        'exactly 1 choice, the fix.',
    );
    expect(choices.description).toContain(
      'The card numbers its choices and headers alike, one number key each, ' +
        'so a finding takes at most 9 of them together; one past that fails ' +
        'the call.',
    );
    expect(recommend_action.description).toContain(
      'follow_up: Follow-up (Defect), Plan it (Decision);',
    );
    expect(recommend_action.description).toContain(
      'A Nit offers no follow_up.',
    );
    expect(severity.description).toContain(
      'Required on a caused or pre_existing finding (a Defect)',
    );
  });
});

describe('findingFormat.arraySchema choice actions', () => {
  it('declares a choice action defaulting to fix_now and action_reasons with follow_up and leave_it', () => {
    const items = findingFormat.arraySchema.items as {
      required: string[];
      properties: {
        choices: {
          items: {
            required: string[];
            additionalProperties: boolean;
            properties: {
              action: { enum: string[]; default: string; description: string };
            };
          };
        };
        action_reasons: {
          type: string;
          additionalProperties: boolean;
          properties: Record<string, { description: string }>;
          description: string;
        };
        recommend: { description: string };
      };
    };
    const { choices, action_reasons, recommend } = items.properties;

    expect(items.required).not.toContain('recommend');
    expect(items.required).not.toContain('action_reasons');
    expect(choices.items.required).toEqual(['text', 'reason']);
    expect(choices.items.additionalProperties).toBe(false);
    expect(choices.items.properties.action.enum).toEqual([...FINDING_ACTIONS]);
    expect(choices.items.properties.action.default).toBe('fix_now');
    expect(choices.items.properties.action.description).toBe(
      "The action this choice sits under on the card, one the finding's " +
        'origin offers; fix_now when left out. A Nit offers no follow_up.',
    );
    expect(action_reasons.type).toBe('object');
    expect(action_reasons.additionalProperties).toBe(false);
    expect(Object.keys(action_reasons.properties)).toEqual([
      'follow_up',
      'leave_it',
    ]);
    expect(action_reasons.properties.follow_up.description).toBe(
      'Drawn under the follow-up action. Markdown.',
    );
    expect(action_reasons.properties.leave_it.description).toBe(
      'Drawn under the leave-it action. Markdown.',
    );
    expect(action_reasons.description).toBe(
      "Why to take a deferral action, drawn under that action's header. " +
        'Only an action the origin offers takes an entry. Send the entry for ' +
        'the action you recommend when it is a deferral; null reads as none. ' +
        'A Nit offers no follow_up.',
    );
    expect(recommend.description).toBe(
      'The 1-based number, in choices, of the recommended choice: a choice ' +
        'of recommend_action. Leave it out, or send null, only when no ' +
        'choice has recommend_action.',
    );
  });
});

describe('findingFormat.fingerprintContent', () => {
  const contentOf = (raw: unknown) =>
    JSON.stringify(
      findingFormat.fingerprintContent(findingFormat.parse(raw, 'Finding 1: ')),
    );

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
      contentOf(findingWithoutRecommend({ recommend_action }));

    expect(content('follow_up')).not.toBe(content('leave_it'));
  });

  it("differs when only a choice's action differs", () => {
    const withSecondAction = (action: string) =>
      finding({
        choices: [
          { text: 'Fix it now', reason: 'It is one line.' },
          { text: 'Keep the cache', reason: 'Reloads are rare.', action },
        ],
      });

    expect(contentOf(withSecondAction('follow_up'))).not.toBe(
      contentOf(withSecondAction('leave_it')),
    );
  });

  it('is the same for a choice with action fix_now and one with none', () => {
    const explicit = finding({
      choices: [
        { text: 'Fix it now', reason: 'It is one line.', action: 'fix_now' },
        { text: 'Keep the cache', reason: 'Reloads are rare.' },
      ],
    });

    expect(contentOf(explicit)).toBe(contentOf(finding()));
  });

  it('differs when only action_reasons differs', () => {
    const base = contentOf(finding());

    expect(
      contentOf(finding({ action_reasons: { leave_it: 'Rare.' } })),
    ).not.toBe(base);
    expect(contentOf(finding({ action_reasons: {} }))).toBe(base);
  });

  it('is the same when only layout differs', () => {
    expect(contentOf(finding({ layout: 'compact' }))).toBe(
      contentOf(finding()),
    );
  });
});
