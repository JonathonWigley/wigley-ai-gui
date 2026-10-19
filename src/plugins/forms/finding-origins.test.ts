import { describe, expect, it } from 'vitest';
import type { FindingAction, FindingOrigin } from './contract';
import { ACTION_WORDS, actionLabel, isFindingOrigin } from './finding-origins';

describe('actionLabel', () => {
  const cases: [FindingOrigin, FindingAction, string | null][] = [
    ['caused', 'fix_now', 'Fix now'],
    ['caused', 'follow_up', 'Follow-up'],
    ['caused', 'leave_it', 'Leave it'],
    ['pre_existing', 'fix_now', 'Fix now'],
    ['pre_existing', 'follow_up', 'Follow-up'],
    ['pre_existing', 'leave_it', 'Leave it'],
    ['design', 'fix_now', 'Decide now'],
    ['design', 'follow_up', 'Plan it'],
    ['design', 'leave_it', 'Drop it'],
    ['nit', 'fix_now', 'Fix anyway'],
    ['nit', 'follow_up', null],
    ['nit', 'leave_it', 'Leave it'],
  ];

  it.each(cases)('labels %s %s as %s', (origin, action, label) => {
    expect(actionLabel(origin, action)).toBe(label);
  });
});

describe('isFindingOrigin', () => {
  it.each(['caused', 'pre_existing', 'design', 'nit'])(
    'accepts %s',
    (value) => {
      expect(isFindingOrigin(value)).toBe(true);
    },
  );

  it.each(['defect', ''])('rejects %j', (value) => {
    expect(isFindingOrigin(value)).toBe(false);
  });
});

describe('ACTION_WORDS', () => {
  it('holds each card word once', () => {
    expect(ACTION_WORDS).toHaveLength(new Set(ACTION_WORDS).size);
    expect(new Set(ACTION_WORDS)).toEqual(
      new Set([
        'Fix now',
        'Follow-up',
        'Leave it',
        'Decide now',
        'Plan it',
        'Drop it',
        'Fix anyway',
      ]),
    );
  });
});
