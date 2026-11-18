import { describe, expect, it } from 'vitest';
import { decision, finding, nit } from '../../test-rounds';
import { verdictOf } from './verdict';
import { findingOrigins } from '../../../finding-origins';
import {
  SECURITY_ORIGIN,
  useBuiltInFindingOrigins,
} from '../../../finding-origins.test-support';

useBuiltInFindingOrigins();

describe('verdictOf', () => {
  it('states a caused finding as a defect card with its chips and impact', () => {
    const delta = finding('Delta', {
      severity: 'critical',
      impact: 'Saves are lost.',
    });
    expect(verdictOf(delta)).toEqual({
      card: 'defect',
      origin: expect.any(String),
      originToken: '--wg-forms-origin-caused',
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

  it('chips a registered plugin origin with its spec', () => {
    const registration = findingOrigins.register(SECURITY_ORIGIN);
    try {
      expect(verdictOf(finding('Golf', { origin: 'security' }))).toMatchObject({
        card: 'risk',
        origin: 'Security',
        originToken: '--wg-security-origin',
      });
    } finally {
      registration.dispose();
    }
  });

  it('falls back to the caused card with the origin id as chip text when the page holds no spec', () => {
    expect(verdictOf(finding('Hotel', { origin: 'license' }))).toMatchObject({
      card: 'defect',
      origin: 'license',
      originToken: '',
    });
  });
});
