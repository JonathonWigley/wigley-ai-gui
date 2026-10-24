import { describe, expect, it } from 'vitest';
import type { FindingAction, FindingOrigin } from './contract';
import {
  findingEntries,
  findingEntryNumber,
  findingPickIsComplete,
  findingSolution,
  isFindingAction,
  type PickableFinding,
} from './finding-pick';

function pickable(
  origin: FindingOrigin,
  actions: FindingAction[],
): PickableFinding {
  return {
    origin,
    choices: actions.map((action, index) => ({
      text: `choice ${index + 1}`,
      reason: `reason ${index + 1}`,
      action,
    })),
  };
}

// Entries: 1 fix_now/2, 2 follow_up/1, 3 follow_up/3, 4 leave_it/0.
const GROUPED = pickable('caused', ['follow_up', 'fix_now', 'follow_up']);

describe('findingEntries', () => {
  it('findingEntries_GroupsByActionInTableOrder', () => {
    expect(findingEntries(GROUPED)).toEqual([
      { action: 'fix_now', choice: 2 },
      { action: 'follow_up', choice: 1 },
      { action: 'follow_up', choice: 3 },
      { action: 'leave_it', choice: 0 },
    ]);
  });

  it('findingEntries_ActionWithoutChoices_OneHeaderEntry', () => {
    expect(findingEntries(pickable('caused', ['fix_now', 'fix_now']))).toEqual([
      { action: 'fix_now', choice: 1 },
      { action: 'fix_now', choice: 2 },
      { action: 'follow_up', choice: 0 },
      { action: 'leave_it', choice: 0 },
    ]);
  });

  it('findingEntries_Nit_SkipsFollowUp', () => {
    expect(findingEntries(pickable('nit', ['fix_now']))).toEqual([
      { action: 'fix_now', choice: 1 },
      { action: 'leave_it', choice: 0 },
    ]);
  });
});

describe('findingEntryNumber', () => {
  it('findingEntryNumber_PickOrNone', () => {
    expect(findingEntryNumber(GROUPED, 3, 'follow_up')).toBe(3);
    expect(findingEntryNumber(GROUPED, 0, 'leave_it')).toBe(4);
    expect(findingEntryNumber(GROUPED, 0, 'fix_now')).toBe(0);
    expect(findingEntryNumber(GROUPED, 1, 'fix_now')).toBe(0);
    expect(findingEntryNumber(GROUPED, 0, '')).toBe(0);
  });
});

describe('findingPickIsComplete', () => {
  it('findingPickIsComplete_OnlyEntries', () => {
    expect(findingPickIsComplete(GROUPED, 0, 'leave_it')).toBe(true);
    expect(findingPickIsComplete(GROUPED, 0, 'fix_now')).toBe(false);
    expect(findingPickIsComplete(GROUPED, 3, 'follow_up')).toBe(true);
    expect(findingPickIsComplete(GROUPED, 3, 'leave_it')).toBe(false);
  });
});

describe('findingSolution', () => {
  it('findingSolution_ChoiceOrZero', () => {
    const leaveItChoice = pickable('caused', ['fix_now', 'leave_it']);

    expect(findingSolution(leaveItChoice, 2, 'leave_it')).toBe(2);
    expect(findingSolution(GROUPED, 0, 'leave_it')).toBe(0);
    expect(findingSolution(GROUPED, 1, 'fix_now')).toBe(0);
  });
});

describe('isFindingAction', () => {
  it('accepts the three actions and nothing else', () => {
    expect(isFindingAction('fix_now')).toBe(true);
    expect(isFindingAction('follow_up')).toBe(true);
    expect(isFindingAction('leave_it')).toBe(true);
    expect(isFindingAction('Fix now')).toBe(false);
    expect(isFindingAction(undefined)).toBe(false);
  });
});
