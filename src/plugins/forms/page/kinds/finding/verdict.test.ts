import { describe, expect, it } from 'vitest';
import { decision, finding, nit } from '../../test-rounds';
import { verdictOf } from './verdict';

describe('verdictOf', () => {
  it('states a caused finding as a defect card with its chips and impact', () => {
    const delta = finding('Delta', {
      severity: 'critical',
      impact: 'Saves are lost.',
    });
    expect(verdictOf(delta)).toEqual({
      card: 'defect',
      origin: expect.any(String),
      severity: expect.any(String),
      impact: 'Saves are lost.',
    });
  });

  it('states a nit with no severity', () => {
    const verdict = verdictOf(nit('Echo', { recommend_action: 'leave_it' }));
    expect(verdict).toMatchObject({ card: 'nit', severity: null });
  });

  it('chips a design finding as a decision card', () => {
    expect(verdictOf(decision('Foxtrot'))).toMatchObject({
      card: 'decision',
      origin: expect.any(String),
    });
  });
});
