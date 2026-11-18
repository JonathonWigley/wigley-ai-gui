import { describe, expect, it } from 'vitest';
import { roundErrorText } from '../../mcp-wording';
import { RoundError, type RoundItemPath } from '../../../contract';
import { BUILT_IN_KINDS } from '../formats';
import { findingAnswerSubject, findingKind } from './finding-format';
import { findingOrigins } from '../../../finding-origins';
import {
  SECURITY_ORIGIN,
  useBuiltInFindingOrigins,
} from '../../../finding-origins.test-support';

useBuiltInFindingOrigins();

const FINDING_1: RoundItemPath = { at: 'item', kind: 'finding', number: 1 };

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

// The tool error text of the RoundError the finding format throws for this
// item.
function parseError(raw: unknown): string {
  try {
    findingKind.parse(raw, FINDING_1);
  } catch (error) {
    if (error instanceof RoundError) {
      return roundErrorText(BUILT_IN_KINDS, error);
    }
    throw error;
  }
  throw new Error('the finding format accepted the finding');
}

// Asserts the finding format refuses this item with a message holding each
// of `parts`: the field, value or bound that names the refusal.
function expectRefusal(raw: unknown, ...parts: string[]): void {
  const message = parseError(raw);
  for (const part of parts) {
    expect(message).toContain(part);
  }
}

describe('findingKind.parse', () => {
  it('parses a caused finding to a Defect with its severity', () => {
    expect(findingKind.parse(finding(), FINDING_1)).toEqual({
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

    expect(findingKind.parse(raw, FINDING_1)).toEqual({
      title: 'Stale cache',
      origin: 'design',
      severity: null,
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
    expect(findingKind.parse(nitFinding(), FINDING_1)).toEqual({
      title: 'Stale cache',
      origin: 'nit',
      severity: null,
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

  it('parses a caused finding with no proof as empty proof', () => {
    const { proof: _proof, ...raw } = finding();

    expect(findingKind.parse(raw, FINDING_1).proof).toBe('');
  });

  it('refuses a nit finding with no proof, naming proof', () => {
    const { proof: _proof, ...raw } = nitFinding();

    expect(parseError(raw)).toBe('Finding 1: a nit finding needs proof.');
  });

  it.each([
    { name: 'null', proof: null },
    { name: 'blank', proof: '  ' },
  ])('reads a null or blank proof off a Nit as none: $name', ({ proof }) => {
    const design = (overrides: Record<string, unknown>) =>
      findingWithoutSeverity({
        origin: 'design',
        choices: TWO_ACTION_CHOICES,
        ...overrides,
      });
    const { proof: _proof, ...withoutProof } = design({});
    const parsed = findingKind.parse(design({ proof }), FINDING_1);

    expect(parsed.proof).toBe('');
    expect(JSON.stringify(findingKind.fingerprintContent(parsed))).toBe(
      JSON.stringify(
        findingKind.fingerprintContent(
          findingKind.parse(withoutProof, FINDING_1),
        ),
      ),
    );
  });

  it('refuses a proof that is not a string', () => {
    expect(parseError(finding({ proof: 3 }))).toBe(
      'Finding 1: proof must be a string.',
    );
  });

  it('parses a registered plugin origin and refuses a choice opening with its action word', () => {
    const registration = findingOrigins.register(SECURITY_ORIGIN);
    try {
      expect(
        findingKind.parse(finding({ origin: 'security' }), FINDING_1).origin,
      ).toBe('security');
      expectRefusal(
        finding({
          origin: 'security',
          choices: [{ text: 'Patch: bound the input', reason: 'r' }],
        }),
        'choices[1].text',
        'Patch',
      );
    } finally {
      registration.dispose();
    }
  });

  it('refuses an origin disposed before the call', () => {
    findingOrigins.register(SECURITY_ORIGIN).dispose();

    expectRefusal(
      finding({ origin: 'security' }),
      'origin must be one of',
      'nit',
    );
  });

  it.each([
    {
      field: 'choices[2].action',
      raw: finding({
        choices: [
          { text: 'Fix it now', reason: 'It is one line.' },
          {
            text: 'Keep the cache',
            reason: 'Reloads are rare.',
            action: 'later',
          },
        ],
      }),
    },
    { field: 'origin', raw: finding({ origin: 'style' }) },
    { field: 'severity', raw: finding({ severity: 'major' }) },
    {
      field: 'recommend_action',
      raw: finding({ recommend_action: 'Fix now' }),
    },
  ])('refuses a $field outside its allowed values', ({ field, raw }) => {
    expectRefusal(raw, field);
  });

  it('refuses a follow_up choice on a nit finding, naming what it offers', () => {
    const raw = nitFinding({
      choices: [
        { text: 'Rename it', reason: 'It reads better.', action: 'follow_up' },
      ],
    });

    expectRefusal(raw, 'choices[1].action', 'follow_up', 'nit');
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

    expectRefusal(raw, 'fix_now');
  });

  it('parses action_reasons for the deferral actions the origin offers', () => {
    const raw = finding({
      action_reasons: { follow_up: 'The plan covers it.', leave_it: 'Rare.' },
    });

    expect(findingKind.parse(raw, FINDING_1).actionReasons).toEqual({
      follow_up: 'The plan covers it.',
      leave_it: 'Rare.',
    });
  });

  it('reads null action_reasons as none', () => {
    const raw = finding({ action_reasons: null });

    expect(findingKind.parse(raw, FINDING_1).actionReasons).toEqual({});
  });

  it('refuses action_reasons for fix_now or an unknown key', () => {
    const raw = finding({ action_reasons: { fix_now: 'x', later: 'y' } });

    expectRefusal(raw, 'fix_now', 'later');
  });

  it('refuses action_reasons.follow_up on a nit finding', () => {
    const raw = nitFinding({ action_reasons: { follow_up: 'Later.' } });

    expectRefusal(raw, 'action_reasons.follow_up', 'nit');
  });

  it('refuses action_reasons that is not an object', () => {
    expectRefusal(finding({ action_reasons: 'Later.' }), 'action_reasons');
  });

  it('refuses a blank action_reasons entry', () => {
    expectRefusal(
      finding({ action_reasons: { leave_it: ' ' } }),
      'action_reasons.leave_it',
    );
  });

  it('leaves recommend null when recommend_action has no choices', () => {
    const raw = findingWithoutRecommend({ recommend_action: 'leave_it' });

    expect(findingKind.parse(raw, FINDING_1).recommend).toBeNull();
  });

  it('reads a null recommend as absent when recommend_action has no choices', () => {
    const raw = finding({ recommend: null, recommend_action: 'leave_it' });

    expect(findingKind.parse(raw, FINDING_1).recommend).toBeNull();
  });

  it('refuses a missing recommend when recommend_action has choices', () => {
    const raw = findingWithoutRecommend({ recommend_action: 'fix_now' });

    expectRefusal(raw, 'recommend', 'fix_now');
  });

  it('refuses recommend when recommend_action has no choices', () => {
    const raw = finding({ recommend: 1, recommend_action: 'leave_it' });

    expectRefusal(raw, 'recommend', 'leave_it');
  });

  it('refuses a recommend naming a choice of another action', () => {
    const raw = finding({
      choices: TWO_ACTION_CHOICES,
      recommend: 2,
      recommend_action: 'fix_now',
    });

    expectRefusal(raw, 'recommend', 'follow_up', 'fix_now');
  });

  it('keeps a layout name as sent and reads an absent one as null', () => {
    expect(
      findingKind.parse(finding({ layout: 'compact' }), FINDING_1).layout,
    ).toBe('compact');
    expect(findingKind.parse(finding(), FINDING_1).layout).toBeNull();
  });

  it('names a missing origin and impact', () => {
    const partial: Record<string, unknown> = finding();
    delete partial.origin;
    delete partial.impact;

    expectRefusal(partial, 'impact', 'origin');
  });

  it('refuses a pre_existing finding with no severity, naming its origin', () => {
    const raw = findingWithoutSeverity({ origin: 'pre_existing' });

    expectRefusal(raw, 'pre_existing', 'severity');
  });

  it('refuses severity on a design finding', () => {
    expectRefusal(finding({ origin: 'design' }), 'severity');
  });

  it('refuses a nit finding with two choices', () => {
    const raw = findingWithoutSeverity({ origin: 'nit' });

    expectRefusal(raw, 'nit');
  });

  it('refuses a design finding with one choice', () => {
    const raw = findingWithoutSeverity({
      origin: 'design',
      choices: [{ text: 'a', reason: 'r' }],
    });

    expectRefusal(raw, 'design');
  });

  // `refused` is the action word the error names, as the table spells it, or
  // null when the choice is accepted.
  it.each([
    { text: 'Fix now: share the rule', refused: 'Fix now' },
    { text: '  fix NOW: share the rule', refused: 'Fix now' },
    { text: 'Leave it: keep the guard', refused: 'Leave it' },
    { text: 'Leave items cached', refused: null },
    { text: '**Fix now**: share the rule', refused: 'Fix now' },
    { text: '`Leave it`', refused: 'Leave it' },
    { text: '_Leave items cached_', refused: null },
  ])(
    'checks choice text $text for an opening action word: $refused',
    ({ text, refused }) => {
      const raw = finding({ choices: [{ text, reason: 'r' }] });

      if (refused === null) {
        expect(findingKind.parse(raw, FINDING_1).choices).toEqual([
          { text, reason: 'r', action: 'fix_now' },
        ]);
        return;
      }
      expectRefusal(raw, 'choices[1].text', refused);
    },
  );

  it('refuses follow_up on a nit finding', () => {
    const raw = findingWithoutSeverity({
      origin: 'nit',
      choices: [{ text: 'a', reason: 'r' }],
      recommend_action: 'follow_up',
    });

    expectRefusal(raw, 'nit', 'fix_now', 'leave_it');
  });

  it('refuses an extra finding field', () => {
    expectRefusal(finding({ context: 'x' }), 'context');
  });

  it('refuses a choice given as a plain string', () => {
    expectRefusal(finding({ choices: ['a', 'b'] }), 'choices[1]');
  });

  it("names a choice's missing reason", () => {
    expectRefusal(
      finding({ choices: [{ text: 'a', reason: 'r' }, { text: 'b' }] }),
      'choices[2]',
      'reason',
    );
  });

  it('refuses an unknown choice field', () => {
    expectRefusal(
      finding({
        choices: [
          { text: 'Fix it now', reason: 'It is one line.', recommended: true },
          { text: 'Keep the cache', reason: 'Reloads are rare.' },
        ],
      }),
      'choices[1] unknown field(s) recommended',
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

    expect(message).toContain('Finding 1: ');
    expect(message).toContain('choices[2].reason');
  });

  it('accepts a single solution on a caused finding', () => {
    const lone = finding({ choices: [{ text: 'a', reason: 'r' }] });

    expect(findingKind.parse(lone, FINDING_1).choices).toEqual([
      { text: 'a', reason: 'r', action: 'fix_now' },
    ]);
  });

  it('refuses a caused finding with zero choices or ten', () => {
    const choice = { text: 'a', reason: 'r' };
    const bound = 'caused';

    expectRefusal(finding({ choices: [] }), bound);
    expectRefusal(
      finding({ choices: Array.from({ length: 10 }, () => choice) }),
      bound,
    );
  });

  it('refuses a finding numbering 10 entries, one past the number keys', () => {
    const choice = { text: 'a', reason: 'r' };
    // 8 fix_now choices, then the follow_up and leave_it headers.
    const raw = finding({ choices: Array.from({ length: 8 }, () => choice) });

    expectRefusal(raw, '10', '9');
  });

  it('accepts a finding numbering exactly 9 entries', () => {
    const choice = { text: 'a', reason: 'r' };
    // 7 fix_now choices, then the follow_up and leave_it headers.
    const raw = finding({ choices: Array.from({ length: 7 }, () => choice) });

    expect(findingKind.parse(raw, FINDING_1).choices).toHaveLength(7);
  });

  it('names the title and the legal range for an out-of-range recommend', () => {
    const message = parseError(finding({ recommend: 3 }));

    expect(message).toContain("'Stale cache'");
    expect(message).toMatch(/1.*2/);
  });
});

describe('findingKind.answerSubject', () => {
  it('gives the result builder its title, choice texts and recommend', () => {
    const parsed = findingKind.parse(finding(), FINDING_1);

    expect(findingAnswerSubject(parsed)).toEqual({
      title: 'Stale cache',
      choiceTexts: ['Fix it now', 'Keep the cache'],
      recommend: 1,
    });
    const headerRecommended = findingKind.parse(
      findingWithoutRecommend({ recommend_action: 'leave_it' }),
      FINDING_1,
    );
    expect(findingAnswerSubject(headerRecommended).recommend).toBe(0);
  });
});

describe('findingKind.fingerprintContent', () => {
  const contentOf = (raw: unknown) =>
    JSON.stringify(
      findingKind.fingerprintContent(findingKind.parse(raw, FINDING_1)),
    );

  it('differs when only the origin, impact or severity differs', () => {
    const content = (overrides: Record<string, unknown>) =>
      JSON.stringify(
        findingKind.fingerprintContent(
          findingKind.parse(finding(overrides), FINDING_1),
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

  it('leaves an omitted proof out of the content', () => {
    const { proof: _proof, ...raw } = finding();

    expect(contentOf(raw)).not.toContain('proof');
  });

  it('is the same when only layout differs', () => {
    expect(contentOf(finding({ layout: 'compact' }))).toBe(
      contentOf(finding()),
    );
  });
});
