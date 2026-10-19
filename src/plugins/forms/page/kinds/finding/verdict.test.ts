import { describe, expect, it } from 'vitest';
import { decision, finding, nit } from '../../test-rounds';
import { verdictOf } from './verdict';

describe('verdictOf', () => {
  it('states a caused finding as its card word, recommended choice and chips', () => {
    const delta = finding('Delta', {
      severity: 'critical',
      impact: 'Saves are lost.',
      choices: [
        { text: 'guard the write', reason: 'cheap' },
        { text: 'retry the write', reason: 'thorough' },
      ],
      recommend: 2,
      recommend_action: 'follow_up',
    });
    expect(verdictOf(delta)).toEqual({
      card: 'defect',
      action: 'Follow-up',
      choice: 'retry the write',
      origin: 'Caused by this change',
      severity: 'Critical',
      impact: 'Saves are lost.',
    });
  });

  it('states a nit left alone with no choice and no severity', () => {
    const verdict = verdictOf(nit('Echo', { recommend_action: 'leave_it' }));
    expect(verdict).toMatchObject({
      card: 'nit',
      action: 'Leave it',
      choice: null,
      severity: null,
    });
  });

  it("names a design finding's follow-up in the decision card's word", () => {
    const foxtrot = decision('Foxtrot', {
      choices: [
        { text: 'keep the seam', reason: 'simple' },
        { text: 'split the store', reason: 'scales' },
      ],
      recommend: 2,
      recommend_action: 'follow_up',
    });
    expect(verdictOf(foxtrot)).toMatchObject({
      card: 'decision',
      action: 'Plan it',
      choice: 'split the store',
      origin: 'Design decision',
    });
  });
});
