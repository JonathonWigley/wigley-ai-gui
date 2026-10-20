import { describe, expect, it } from 'vitest';
import { actionLabel } from '../../finding-origins';
import {
  decision,
  finding,
  notice,
  presentedRound,
  question,
} from '../test-rounds';
import { findingFormat } from './finding/finding-card';
import { noticeFormat } from './notice/notice-card';
import { questionFormat } from './question/question-card';

describe('cardInput', () => {
  it('questionCardInput_CarriesRationaleAndRound', () => {
    const { round } = presentedRound('r1', {
      questions: [
        question('Alpha'),
        question('Beta', {
          choices: ['keep', 'drop'],
          recommend: 1,
          rationale: 'keeping is cheaper',
        }),
      ],
    });
    round.overview = 'the overview';

    const input = questionFormat.cardInput(round, 2);

    expect(input.label).toBe('2');
    expect(input.choices).toEqual(['keep', 'drop']);
    expect(input.recommend).toBe(1);
    expect(input.rationale).toBe('keeping is cheaper');
    expect(input.round).toEqual({
      heading: 'r1 heading',
      overview: 'the overview',
    });
  });

  it('findingCardInput_Decision_HasNoSeverityAndDecisionWords', () => {
    const { round } = presentedRound('r1', {
      findings: [finding('Delta'), decision('Epsilon')],
    });

    const input = findingFormat.cardInput(round, 2);

    expect(input.label).toBe('F2');
    expect(input.card).toBe('decision');
    expect(input.severity).toBeNull();
    expect(input.severityChip).toBeNull();
    expect(input.words.kind).toBe('Decision');
    expect(input.actions).toEqual([
      { action: 'fix_now', label: actionLabel('design', 'fix_now') },
      { action: 'follow_up', label: actionLabel('design', 'follow_up') },
      { action: 'leave_it', label: actionLabel('design', 'leave_it') },
    ]);
  });

  it('findingCardInput_Defect_CarriesSeverityChip', () => {
    const { round } = presentedRound('r1', {
      findings: [finding('Delta', { severity: 'critical' })],
    });

    const input = findingFormat.cardInput(round, 1);

    expect(input.card).toBe('defect');
    expect(input.severity).toBe('critical');
    expect(input.severityChip).toBe('Critical');
  });

  it('noticeCardInput_CarriesBadge', () => {
    const { round } = presentedRound('r1', {
      notices: [notice('Zeta'), { ...notice('Eta'), badge: 'Dispatched' }],
    });

    const input = noticeFormat.cardInput(round, 2);

    expect(input.label).toBe('N2');
    expect(input.title).toBe('Eta');
    expect(input.badge).toBe('Dispatched');
  });
});
