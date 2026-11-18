import { describe, expect, it } from 'vitest';
import { activeForm } from '../../../../shared/page/session-forms';
import type { FormsAction } from '../form-state';
import type { RoundState } from '../round-model';
import {
  apply,
  finding,
  initialState,
  presentedRound,
  question,
} from '../test-rounds';
import { cardAnswer } from './layout-cards';
import { useBuiltInFindingOrigins } from '../../finding-origins.test-support';

useBuiltInFindingOrigins();

// Finding Delta at rail position 0, question Alpha at 1. Delta's entries:
// 1 fix_now/1, 2 fix_now/2, 3 follow_up/0, 4 leave_it/0.
function roundAfter(...actions: FormsAction[]): RoundState {
  const delta = finding('Delta', {
    choices: [
      { text: 'A', reason: 'A reason', action: 'fix_now' },
      { text: 'B', reason: 'B reason', action: 'fix_now' },
    ],
  });
  const start = initialState(
    [
      presentedRound('r1', {
        questions: [question('Alpha')],
        findings: [delta],
      }),
    ],
    'r1-session',
  );
  const round = activeForm(actions.reduce(apply, start));
  if (round === null) {
    throw new Error('The test round is not active');
  }
  return round;
}

describe('cardAnswer', () => {
  it('cardAnswer_Untouched_HasNullChoiceAndAction', () => {
    const answer = cardAnswer(roundAfter(), { kind: 'finding', index: 1 });

    expect(answer).toEqual({
      status: 'untouched',
      choice: null,
      notApplicable: false,
      dontAsk: false,
      action: null,
    });
  });

  it('cardAnswer_HeaderPick_NullChoiceWithAction', () => {
    const round = roundAfter(
      { type: 'focusItem', item: 0 },
      { type: 'choose', number: 4 },
    );

    const answer = cardAnswer(round, { kind: 'finding', index: 1 });

    expect(answer).toEqual({
      status: 'answered',
      choice: null,
      notApplicable: false,
      dontAsk: false,
      action: 'leave_it',
    });
  });

  it('cardAnswer_FindingWithActionAndChoice_CarriesBoth', () => {
    const round = roundAfter(
      { type: 'focusItem', item: 0 },
      { type: 'choose', number: 2 },
    );

    const answer = cardAnswer(round, { kind: 'finding', index: 1 });

    expect(answer.action).toBe('fix_now');
    expect(answer.choice).toBe(2);
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
