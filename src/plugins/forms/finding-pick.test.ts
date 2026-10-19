import { describe, expect, it } from 'vitest';
import {
  findingPickIsComplete,
  findingSolution,
  isFindingAction,
} from './finding-pick';

describe('findingPickIsComplete', () => {
  it('holds for leave_it with no solution picked', () => {
    expect(findingPickIsComplete(2, 0, 'leave_it')).toBe(true);
  });

  it('needs a solution for fix_now when the finding offers two', () => {
    expect(findingPickIsComplete(2, 0, 'fix_now')).toBe(false);
    expect(findingPickIsComplete(2, 2, 'fix_now')).toBe(true);
  });

  it('refuses a solution outside the finding', () => {
    expect(findingPickIsComplete(2, 3, 'follow_up')).toBe(false);
  });

  it('needs no solution pick when the finding offers one', () => {
    expect(findingPickIsComplete(1, 0, 'follow_up')).toBe(true);
  });

  it('fails with no action, whatever the choice', () => {
    expect(findingPickIsComplete(2, 1, '')).toBe(false);
  });
});

describe('findingSolution', () => {
  it('gives the picked solution among several for fix_now and follow_up', () => {
    expect(findingSolution(3, 2, 'fix_now')).toBe(2);
    expect(findingSolution(3, 3, 'follow_up')).toBe(3);
  });

  it('gives solution 1 on a one-solution finding, whatever the choice', () => {
    expect(findingSolution(1, 0, 'fix_now')).toBe(1);
    expect(findingSolution(1, 2, 'follow_up')).toBe(1);
  });

  it('gives none for leave_it, even with a kept solution', () => {
    expect(findingSolution(3, 2, 'leave_it')).toBe(0);
    expect(findingSolution(1, 1, 'leave_it')).toBe(0);
  });

  it('gives none while the pick is incomplete', () => {
    expect(findingSolution(3, 2, '')).toBe(0);
    expect(findingSolution(3, 0, 'fix_now')).toBe(0);
    expect(findingSolution(3, 4, 'fix_now')).toBe(0);
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
