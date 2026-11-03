import { describe, expect, it } from 'vitest';
import {
  type EntryFocus,
  focusAfterChange,
  focusAfterClose,
  focusAfterScroll,
  focusFirst,
  isAtLastStop,
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

  const onLine: EntryFocus = { entryId: 'activity:s1', following: true };
  const openRun = ['a', 'activity:s1', 's1', 's2', 's3'];

  it.each([
    {
      given: 'following',
      focus: onC,
      next: ['a', 'b', 'c', 'd'],
      lastRow: 'd',
      expected: { entryId: 'd', following: true },
    },
    {
      given: 'not following',
      focus: onB,
      next: ['a', 'b', 'c', 'd'],
      lastRow: 'd',
      expected: onB,
    },
    {
      given: 'a gone entry',
      focus: { entryId: 'x', following: false },
      next: ['a', 'b', 'c', 'd'],
      lastRow: 'd',
      expected: { entryId: 'd', following: true },
    },
    {
      given: 'following on the open last run line',
      focus: onLine,
      next: openRun,
      lastRow: 'activity:s1',
      expected: onLine,
    },
    {
      given: 'following on an open last run step',
      focus: { entryId: 's2', following: true },
      next: openRun,
      lastRow: 'activity:s1',
      expected: onLine,
    },
    {
      given: 'a gone entry after an open last run',
      focus: { entryId: 'q1', following: true },
      next: openRun,
      lastRow: 'activity:s1',
      expected: onLine,
    },
    {
      given: 'following on a run line no longer last',
      focus: onLine,
      next: [...openRun, 'b'],
      lastRow: 'b',
      expected: { entryId: 'b', following: true },
    },
    {
      given: 'no entries left',
      focus: onB,
      next: [],
      lastRow: null,
      expected: START_FOCUS,
    },
  ])(
    'focusAfterChange on $given → $expected',
    ({ focus, next, lastRow, expected }) => {
      expect(focusAfterChange(focus, next, lastRow)).toEqual(expected);
    },
  );

  it.each([
    { case: 'no ids', focus: START_FOCUS, stops: [], expected: true },
    { case: 'focus on the last id', focus: onC, stops: ids, expected: true },
    { case: 'focus on an earlier id', focus: onB, stops: ids, expected: false },
    {
      case: 'no focused entry with ids',
      focus: START_FOCUS,
      stops: ids,
      expected: false,
    },
    {
      case: 'focus on an open last run line before its steps',
      focus: onLine,
      stops: ['a', 'activity:s1', 's1', 's2'],
      expected: false,
    },
  ])('isAtLastStop_$case', ({ focus, stops, expected }) => {
    expect(isAtLastStop(focus, stops)).toBe(expected);
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

  it.each([
    {
      given: 'a closed step, following',
      focus: { entryId: 's2', following: true },
      expected: { entryId: 'activity:s1', following: true },
    },
    {
      given: 'a closed step, not following',
      focus: { entryId: 's1', following: false },
      expected: { entryId: 'activity:s1', following: false },
    },
    { given: 'another entry', focus: onB, expected: onB },
    { given: 'no entry', focus: START_FOCUS, expected: START_FOCUS },
  ])('focusAfterClose on $given → $expected', ({ focus, expected }) => {
    expect(focusAfterClose(focus, 'activity:s1', ['s1', 's2'])).toEqual(
      expected,
    );
  });
});
