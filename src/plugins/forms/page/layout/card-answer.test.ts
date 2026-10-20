import { describe, expect, it } from 'vitest';
import {
  activeRound,
  apply,
  type FormsAction,
  initialState,
  type RoundState,
} from '../form-state';
import { finding, presentedRound, question } from '../test-rounds';
import { cardAnswer } from './layout-cards';

// Finding Delta at rail position 0, question Alpha at 1.
function roundAfter(...actions: FormsAction[]): RoundState {
  const start = initialState(
    [
      presentedRound('r1', {
        questions: [question('Alpha')],
        findings: [finding('Delta')],
      }),
    ],
    'r1-session',
  );
  const round = activeRound(actions.reduce(apply, start));
  if (round === null) {
    throw new Error('The test round is not active');
  }
  return round;
}

describe('cardAnswer', () => {
  it('cardAnswer_Untouched_HoldsFixNowAndNullChoice', () => {
    const answer = cardAnswer(roundAfter(), { kind: 'finding', index: 1 });

    expect(answer).toEqual({
      status: 'untouched',
      choice: null,
      notApplicable: false,
      dontAsk: false,
      action: 'fix_now',
    });
  });

  it('cardAnswer_ActionCleared_HasNullChoiceAndAction', () => {
    const round = roundAfter(
      { type: 'focusItem', item: 0 },
      { type: 'chooseAction', action: 'fix_now' },
    );

    const answer = cardAnswer(round, { kind: 'finding', index: 1 });

    expect(answer).toEqual({
      status: 'untouched',
      choice: null,
      notApplicable: false,
      dontAsk: false,
      action: null,
    });
  });

  it('cardAnswer_FindingWithActionAndChoice_CarriesBoth', () => {
    const round = roundAfter(
      { type: 'focusItem', item: 0 },
      { type: 'chooseAction', action: 'follow_up' },
      { type: 'choose', choice: 3 },
    );

    const answer = cardAnswer(round, { kind: 'finding', index: 1 });

    expect(answer.action).toBe('follow_up');
    expect(answer.choice).toBe(3);
    expect(answer.status).toBe('answered');
  });

  it('cardAnswer_NotApplicable_StatusNotApplicable', () => {
    const round = roundAfter(
      { type: 'focusItem', item: 1 },
      { type: 'toggleNotApplicable' },
    );

    const answer = cardAnswer(round, { kind: 'question', index: 1 });

    expect(answer.status).toBe('not_applicable');
    expect(answer.notApplicable).toBe(true);
  });
});
