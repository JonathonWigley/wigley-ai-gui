import { describe, expect, it } from 'vitest';
import type { DefectFinding, FindingChoice } from '../../contract';
import { findingFormat } from '../kinds/finding/finding-card';
import { finding, presentedRound } from '../test-rounds';
import { choiceGroupsOf } from './card-kit';

function choice(text: string, action: FindingChoice['action']): FindingChoice {
  return { text, reason: `${text} reason`, action };
}

// The card input of a caused finding, which offers every action.
function cardOf(overrides: Partial<DefectFinding>) {
  const { round } = presentedRound('r1', {
    findings: [finding('Delta', overrides)],
  });
  return findingFormat.cardInput(round, 1);
}

describe('choiceGroupsOf', () => {
  it('choiceGroupsOf_ActionWithoutChoices_HeaderTakesNumber', () => {
    const input = cardOf({
      choices: [choice('A', 'fix_now'), choice('B', 'fix_now')],
    });

    const groups = choiceGroupsOf(input);

    expect(
      groups.map(({ action, number, choices }) => ({
        action,
        number,
        numbers: choices.map((each) => each.number),
      })),
    ).toEqual([
      { action: 'fix_now', number: null, numbers: [1, 2] },
      { action: 'follow_up', number: 3, numbers: [] },
      { action: 'leave_it', number: 4, numbers: [] },
    ]);
  });

  it('choiceGroupsOf_ChoicesOutOfWireOrder_NumberDownTheCard', () => {
    const input = cardOf({
      choices: [choice('A', 'follow_up'), choice('B', 'fix_now')],
    });

    const groups = choiceGroupsOf(input);

    const fixNow = groups.find((group) => group.action === 'fix_now');
    const followUp = groups.find((group) => group.action === 'follow_up');
    expect(fixNow?.choices).toMatchObject([
      { text: 'B', number: 1, choice: 2 },
    ]);
    expect(followUp?.choices).toMatchObject([
      { text: 'A', number: 2, choice: 1 },
    ]);
  });

  it('choiceGroupsOf_ActionReasons_OnTheirGroup', () => {
    const withReason = choiceGroupsOf(
      cardOf({ actionReasons: { leave_it: 'Out of scope' } }),
    );
    const withBlank = choiceGroupsOf(
      cardOf({ actionReasons: { follow_up: '  ' } }),
    );

    expect(withReason.map(({ action, reason }) => [action, reason])).toEqual([
      ['fix_now', null],
      ['follow_up', null],
      ['leave_it', 'Out of scope'],
    ]);
    expect(
      withBlank.find((group) => group.action === 'follow_up')?.reason,
    ).toBeNull();
  });

  it('choiceGroupsOf_RecommendNull_TagsTheHeader', () => {
    const input = cardOf({
      choices: [choice('A', 'fix_now'), choice('B', 'fix_now')],
      recommend: null,
      recommend_action: 'leave_it',
    });

    const groups = choiceGroupsOf(input);

    expect(
      groups.filter((group) => group.isRecommended).map((g) => g.action),
    ).toEqual(['leave_it']);
    expect(
      groups.flatMap((group) => group.choices).some((c) => c.isRecommended),
    ).toBe(false);
  });

  it('choiceGroupsOf_Recommend_TagsOnlyThatChoice', () => {
    const input = cardOf({
      choices: [choice('A', 'fix_now'), choice('B', 'fix_now')],
      recommend: 2,
      recommend_action: 'fix_now',
    });

    const fixNow = choiceGroupsOf(input)[0];

    expect(
      fixNow.choices.map(({ choice: n, isRecommended }) => [n, isRecommended]),
    ).toEqual([
      [1, false],
      [2, true],
    ]);
  });
});
