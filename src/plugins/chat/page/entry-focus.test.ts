import { describe, expect, it } from 'vitest';
import {
  type EntryFocus,
  focusAfterChange,
  focusAfterScroll,
  focusFirst,
  moveFocus,
  START_FOCUS,
} from './entry-focus';

const ids = ['a', 'b', 'c'];
const onA: EntryFocus = { entryId: 'a', following: false };
const onB: EntryFocus = { entryId: 'b', following: false };
const onC: EntryFocus = { entryId: 'c', following: true };

describe('entry focus', () => {
  it.each([
    { given: 'nothing', focus: START_FOCUS, by: -1, expected: onC },
    {
      given: 'the last',
      focus: onC,
      by: -1,
      expected: { entryId: 'b', following: false },
    },
    { given: 'the first', focus: onA, by: -1, expected: onA },
    { given: 'the last', focus: onC, by: 1, expected: onC },
    { given: 'a middle entry', focus: onB, by: 1, expected: onC },
  ] as const)(
    'moveFocus from $given by $by → $expected',
    ({ focus, by, expected }) => {
      expect(moveFocus(focus, ids, by)).toEqual(expected);
    },
  );

  it.each([
    {
      given: 'following',
      focus: onC,
      next: ['a', 'b', 'c', 'd'],
      expected: { entryId: 'd', following: true },
    },
    {
      given: 'not following',
      focus: onB,
      next: ['a', 'b', 'c', 'd'],
      expected: onB,
    },
    {
      given: 'a gone entry',
      focus: { entryId: 'x', following: false },
      next: ['a', 'b', 'c', 'd'],
      expected: { entryId: 'd', following: true },
    },
    { given: 'no entries left', focus: onB, next: [], expected: START_FOCUS },
  ])('focusAfterChange on $given → $expected', ({ focus, next, expected }) => {
    expect(focusAfterChange(focus, next)).toEqual(expected);
  });

  it.each([
    { entries: ['a', 'b', 'c'], expected: { entryId: 'a', following: false } },
    { entries: ['a'], expected: { entryId: 'a', following: true } },
    { entries: [], expected: START_FOCUS },
  ])('focusFirst of $entries → $expected', ({ entries, expected }) => {
    expect(focusFirst(entries)).toEqual(expected);
  });

  it.each([
    {
      focus: onC,
      direction: -1,
      atEnd: false,
      expected: { entryId: 'c', following: false },
    },
    { focus: onC, direction: -1, atEnd: true, expected: onC },
    {
      focus: onB,
      direction: 1,
      atEnd: true,
      expected: { entryId: 'b', following: true },
    },
    { focus: onB, direction: 1, atEnd: false, expected: onB },
    { focus: onB, direction: -1, atEnd: true, expected: onB },
  ] as const)(
    'focusAfterScroll from $focus by $direction, at the end $atEnd → $expected',
    ({ focus, direction, atEnd, expected }) => {
      expect(focusAfterScroll(focus, direction, atEnd)).toEqual(expected);
    },
  );
});
