import { describe, expect, it } from 'vitest';
import {
  focusAfterChange,
  focusAfterScroll,
  focusFirst,
  moveFocus,
  START_FOCUS,
} from './entry-focus';

const ids = ['a', 'b', 'c'];

describe('entry focus', () => {
  it('moveFocus_FromNothing_Latest', () => {
    expect(moveFocus(START_FOCUS, ids, -1)).toEqual({
      entryId: 'c',
      following: true,
    });
  });

  it('moveFocus_UpLeavesFollowing', () => {
    const onC = { entryId: 'c', following: true };

    expect(moveFocus(onC, ids, -1)).toEqual({ entryId: 'b', following: false });
  });

  it('moveFocus_ClampsAtBothEnds', () => {
    const onA = { entryId: 'a', following: false };
    const onC = { entryId: 'c', following: true };

    expect(moveFocus(onA, ids, -1)).toEqual({ entryId: 'a', following: false });
    expect(moveFocus(onC, ids, 1)).toEqual({ entryId: 'c', following: true });
  });

  it('moveFocus_DownOntoLast_Follows', () => {
    const onB = { entryId: 'b', following: false };

    expect(moveFocus(onB, ids, 1)).toEqual({ entryId: 'c', following: true });
  });

  it('focusAfterChange_FollowingMovesToNewLast', () => {
    const onC = { entryId: 'c', following: true };

    expect(focusAfterChange(onC, ['a', 'b', 'c', 'd'])).toEqual({
      entryId: 'd',
      following: true,
    });
  });

  it('focusAfterChange_NotFollowing_Stays', () => {
    const onB = { entryId: 'b', following: false };

    expect(focusAfterChange(onB, ['a', 'b', 'c', 'd'])).toEqual(onB);
  });

  it('focusAfterChange_GoneId_Latest', () => {
    const onX = { entryId: 'x', following: false };

    expect(focusAfterChange(onX, ['a', 'b', 'c', 'd'])).toEqual({
      entryId: 'd',
      following: true,
    });
  });

  it('focusAfterChange_NoIds_Start', () => {
    const onB = { entryId: 'b', following: false };

    expect(focusAfterChange(onB, [])).toEqual(START_FOCUS);
  });

  it('focusFirst_FirstOfMany_NotFollowing', () => {
    expect(focusFirst(['a', 'b', 'c'])).toEqual({
      entryId: 'a',
      following: false,
    });
  });

  it('focusFirst_OnlyEntry_Follows', () => {
    expect(focusFirst(['a'])).toEqual({ entryId: 'a', following: true });
  });

  it('focusFirst_NoIds_Start', () => {
    expect(focusFirst([])).toEqual(START_FOCUS);
  });

  it('focusAfterScroll_UpOffTheBottom_StopsFollowingOnSameEntry', () => {
    const onC = { entryId: 'c', following: true };

    expect(focusAfterScroll(onC, -1, false)).toEqual({
      entryId: 'c',
      following: false,
    });
  });

  it('focusAfterScroll_UpStillAtBottom_KeepsFollowing', () => {
    const onC = { entryId: 'c', following: true };

    expect(focusAfterScroll(onC, -1, true)).toEqual(onC);
  });

  it('focusAfterScroll_DownOntoTheBottom_FollowsOnSameEntry', () => {
    const onB = { entryId: 'b', following: false };

    expect(focusAfterScroll(onB, 1, true)).toEqual({
      entryId: 'b',
      following: true,
    });
  });

  it('focusAfterScroll_DownShortOfTheBottom_StaysNotFollowing', () => {
    const onB = { entryId: 'b', following: false };

    expect(focusAfterScroll(onB, 1, false)).toEqual(onB);
  });

  it('focusAfterScroll_UpOntoTheBottom_StaysNotFollowing', () => {
    const onB = { entryId: 'b', following: false };

    expect(focusAfterScroll(onB, -1, true)).toEqual(onB);
  });
});
