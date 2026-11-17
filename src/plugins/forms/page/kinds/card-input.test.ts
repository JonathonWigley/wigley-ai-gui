import { describe, expect, it } from 'vitest';
import {
  cardInputOf,
  decision,
  finding,
  notice,
  presentedRound,
  question,
} from '../test-rounds';
import { findingPageKind } from './finding/finding-card';
import { noticePageKind } from './notice/notice-card';
import { questionPageKind } from './question/question-card';

describe('cardInput', () => {
  it('questionCardInput_CarriesSummaryRationaleAndRound', () => {
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

    const input = cardInputOf(questionPageKind, round, 2);

    expect(input.label).toBe('2');
    expect(input.summary).toBe('Beta summary');
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

    const input = cardInputOf(findingPageKind, round, 2);

    expect(input.label).toBe('F2');
    expect(input.card).toBe('decision');
    expect(input.severity).toBeNull();
    expect(input.severityChip).toBeNull();
    expect(input.actions.map((entry) => entry.action)).toEqual([
      'fix_now',
      'follow_up',
      'leave_it',
    ]);
  });

  it('findingCardInput_Defect_CarriesSeverityChip', () => {
    const { round } = presentedRound('r1', {
      findings: [finding('Delta', { severity: 'critical' })],
    });

    const input = cardInputOf(findingPageKind, round, 1);

    expect(input.card).toBe('defect');
    expect(input.severity).toBe('critical');
    expect(input.severityChip).not.toBeNull();
  });

  it('findingCardInput_Entries_NumberDownTheCard', () => {
    const { round } = presentedRound('r1', {
      findings: [
        finding('Delta', {
          choices: [
            { text: 'A', reason: 'A reason', action: 'follow_up' },
            { text: 'B', reason: 'B reason', action: 'fix_now' },
          ],
        }),
      ],
    });

    const input = cardInputOf(findingPageKind, round, 1);

    expect(input.entries).toEqual([
      { number: 1, action: 'fix_now', choice: 2 },
      { number: 2, action: 'follow_up', choice: 1 },
      { number: 3, action: 'leave_it', choice: 0 },
    ]);
    expect(input.choices).toEqual([
      { text: 'A', reason: 'A reason', action: 'follow_up' },
      { text: 'B', reason: 'B reason', action: 'fix_now' },
    ]);
  });

  it('findingCardInput_ActionReasonsAndNullRecommend', () => {
    const { round } = presentedRound('r1', {
      findings: [
        finding('Delta', {
          recommend: null,
          recommend_action: 'follow_up',
          actionReasons: { follow_up: 'Needs a spike first' },
        }),
      ],
    });

    const input = cardInputOf(findingPageKind, round, 1);

    expect(input.actionReasons).toEqual({ follow_up: 'Needs a spike first' });
    expect(input.recommend).toBeNull();
  });

  it('noticeCardInput_CarriesIndexAndBadge', () => {
    const { round } = presentedRound('r1', {
      notices: [notice('Zeta'), { ...notice('Eta'), badge: 'Dispatched' }],
    });

    const input = cardInputOf(noticePageKind, round, 2);

    expect(input.index).toBe(2);
    expect(input.label).toBe('N2');
    expect(input.title).toBe('Eta');
    expect(input.badge).toBe('Dispatched');
  });
});
