import { describe, expect, it } from 'vitest';
import {
  blockStopId,
  clearAnchor,
  type EntryFocus,
  entryIdOfStop,
  focusAfterChange,
  focusAfterClose,
  focusAfterScroll,
  focusAfterScrollEvent,
  focusFirst,
  focusLatest,
  focusStop,
  isAtLastStop,
  moveFocus,
  moveToMessage,
  nearestVisibleStop,
  rangeStops,
  START_FOCUS,
  toggleAnchor,
} from './entry-focus';

const ids = ['a', 'b', 'c'];
const onA: EntryFocus = { stopId: 'a', following: false, anchorId: null };
const onB: EntryFocus = { stopId: 'b', following: false, anchorId: null };
const onC: EntryFocus = { stopId: 'c', following: true, anchorId: null };

describe('entry focus', () => {
  it.each([
    { given: 'nothing', focus: START_FOCUS, by: -1, expected: onC },
    {
      given: 'the last',
      focus: onC,
      by: -1,
      expected: { stopId: 'b', following: false, anchorId: null },
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

  const onLine: EntryFocus = {
    stopId: 'activity:s1',
    following: true,
    anchorId: null,
  };
  const openRun = ['a', 'activity:s1', 's1', 's2', 's3'];

  it.each([
    {
      given: 'following',
      focus: onC,
      next: ['a', 'b', 'c', 'd'],
      lastRow: 'd',
      expected: { stopId: 'd', following: true, anchorId: null },
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
      focus: { stopId: 'x', following: false, anchorId: null },
      next: ['a', 'b', 'c', 'd'],
      lastRow: 'd',
      expected: { stopId: 'd', following: true, anchorId: null },
    },
    {
      given: 'following on the open last run line',
      focus: onLine,
      next: openRun,
      lastRow: 'activity:s1',
      expected: onLine,
    },
    {
      given: 'following on an open last run step, the last',
      focus: { stopId: 's3', following: true, anchorId: null },
      next: openRun,
      lastRow: 'activity:s1',
      expected: { stopId: 's3', following: true, anchorId: null },
    },
    {
      given: 'following on an open last run step, a middle one',
      focus: { stopId: 's2', following: true, anchorId: null },
      next: openRun,
      lastRow: 'activity:s1',
      expected: { stopId: 's3', following: true, anchorId: null },
    },
    {
      given: 'a gone entry after an open last run',
      focus: { stopId: 'q1', following: true, anchorId: null },
      next: openRun,
      lastRow: 'activity:s1',
      expected: onLine,
    },
    {
      given: 'following on a run line no longer last',
      focus: onLine,
      next: [...openRun, 'b'],
      lastRow: 'b',
      expected: { stopId: 'b', following: true, anchorId: null },
    },
    {
      given: 'no entries left',
      focus: onB,
      next: [],
      lastRow: null,
      expected: START_FOCUS,
    },
    {
      given: 'a block its entry lost',
      focus: { stopId: 'a#3', following: false, anchorId: null },
      next: ['a#0', 'a#1', 'b'],
      lastRow: 'b',
      expected: { stopId: 'a#1', following: false, anchorId: null },
    },
    {
      given: 'an entry that lost all its blocks',
      focus: { stopId: 'a#3', following: false, anchorId: null },
      next: ['a', 'b'],
      lastRow: 'b',
      expected: { stopId: 'a', following: false, anchorId: null },
    },
    {
      given: 'an entry that gained blocks',
      focus: { stopId: 'a1', following: false, anchorId: null },
      next: ['a1#0', 'a1#1', 'b'],
      lastRow: 'b',
      expected: { stopId: 'a1#0', following: false, anchorId: null },
    },
    {
      given: 'a following block its entry lost',
      focus: { stopId: 'a#3', following: true, anchorId: null },
      next: ['a#0', 'a#1', 'b'],
      lastRow: 'b',
      expected: { stopId: 'b', following: true, anchorId: null },
    },
    {
      given: 'no stop, not following',
      focus: { stopId: null, following: false, anchorId: null },
      next: ['a', 'b'],
      lastRow: 'b',
      expected: { stopId: 'b', following: true, anchorId: null },
    },
    {
      given: 'a kept stop with an anchor still listed',
      focus: { stopId: 'b', following: false, anchorId: 'a' },
      next: ['a', 'b', 'c'],
      lastRow: 'c',
      expected: { stopId: 'b', following: false, anchorId: 'a' },
    },
    {
      given: 'a kept stop with its anchor gone',
      focus: { stopId: 'b', following: false, anchorId: 'x' },
      next: ['a', 'b', 'c'],
      lastRow: 'c',
      expected: { stopId: 'b', following: false, anchorId: null },
    },
    {
      given: 'a moved stop with an anchor still listed',
      focus: { stopId: 'a#3', following: false, anchorId: 'b' },
      next: ['a#0', 'b'],
      lastRow: 'b',
      expected: { stopId: 'a#0', following: false, anchorId: 'b' },
    },
    {
      given: 'a stop following to the last with an anchor still listed',
      focus: { stopId: 'x', following: true, anchorId: 'a' },
      next: ['a', 'b'],
      lastRow: 'b',
      expected: { stopId: 'b', following: true, anchorId: 'a' },
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
    {
      entries: ['a', 'b', 'c'],
      anchorId: null,
      expected: { stopId: 'a', following: false, anchorId: null },
    },
    {
      entries: ['a'],
      anchorId: null,
      expected: { stopId: 'a', following: true, anchorId: null },
    },
    { entries: [], anchorId: null, expected: START_FOCUS },
    {
      entries: ['a', 'b', 'c'],
      anchorId: 'b',
      expected: { stopId: 'a', following: false, anchorId: 'b' },
    },
    { entries: [], anchorId: 'b', expected: START_FOCUS },
  ])(
    'focusFirst of $entries with anchor $anchorId → $expected',
    ({ entries, anchorId, expected }) => {
      expect(focusFirst(entries, anchorId)).toEqual(expected);
    },
  );

  it.each([
    {
      latestId: 'c',
      anchorId: 'a',
      expected: { stopId: 'c', following: true, anchorId: 'a' },
    },
    {
      latestId: 'c',
      anchorId: null,
      expected: { stopId: 'c', following: true, anchorId: null },
    },
    { latestId: null, anchorId: 'a', expected: START_FOCUS },
  ])(
    'focusLatest on $latestId with anchor $anchorId → $expected',
    ({ latestId, anchorId, expected }) => {
      expect(focusLatest(latestId, anchorId)).toEqual(expected);
    },
  );

  it.each([
    {
      focus: onC,
      direction: -1,
      atEnd: false,
      expected: { stopId: 'c', following: false, anchorId: null },
    },
    { focus: onC, direction: -1, atEnd: true, expected: onC },
    {
      focus: onB,
      direction: 1,
      atEnd: true,
      expected: { stopId: 'b', following: true, anchorId: null },
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
      focus: { stopId: 's2', following: true, anchorId: null },
      expected: { stopId: 'activity:s1', following: true, anchorId: null },
    },
    {
      given: 'a closed step, not following',
      focus: { stopId: 's1', following: false, anchorId: null },
      expected: { stopId: 'activity:s1', following: false, anchorId: null },
    },
    { given: 'another entry', focus: onB, expected: onB },
    { given: 'no entry', focus: START_FOCUS, expected: START_FOCUS },
  ])('focusAfterClose on $given → $expected', ({ focus, expected }) => {
    expect(focusAfterClose(focus, 'activity:s1', ['s1', 's2'])).toEqual(
      expected,
    );
  });

  const anchored: EntryFocus = { stopId: 'b', following: false, anchorId: 'a' };

  it.each([
    { name: 'moveFocus', moved: moveFocus(anchored, ids, 1), stopId: 'c' },
    {
      name: 'focusAfterScroll',
      moved: focusAfterScroll(anchored, 1, true),
      stopId: 'b',
    },
    {
      name: 'focusAfterScrollEvent',
      moved: focusAfterScrollEvent(anchored, true),
      stopId: 'b',
    },
    {
      name: 'focusAfterClose',
      moved: focusAfterClose(anchored, 'line', ['b']),
      stopId: 'line',
    },
  ])('$name keeps the anchor', ({ moved, stopId }) => {
    expect(moved.stopId).toBe(stopId);
    expect(moved.anchorId).toBe('a');
  });

  it.each([
    { entryId: 'a1', blockIndex: 3 },
    { entryId: 'tool#x', blockIndex: 0 },
  ])(
    'blockStopId of $entryId round-trips through entryIdOfStop',
    ({ entryId, blockIndex }) => {
      expect(entryIdOfStop(blockStopId(entryId, blockIndex))).toBe(entryId);
    },
  );

  it.each([
    { stopId: 'a1#12', expected: 'a1' },
    { stopId: 'a1', expected: 'a1' },
    { stopId: 'tool#x', expected: 'tool#x' },
    { stopId: 'tool#x#2', expected: 'tool#x' },
    { stopId: 'a#2b', expected: 'a#2b' },
  ])('entryIdOfStop of $stopId → $expected', ({ stopId, expected }) => {
    expect(entryIdOfStop(stopId)).toBe(expected);
  });

  it.each([
    {
      given: 'no anchor',
      focus: { stopId: 'b', following: false, anchorId: null },
      expected: { stopId: 'b', following: false, anchorId: 'b' },
    },
    {
      given: 'an anchor elsewhere',
      focus: { stopId: 'b', following: true, anchorId: 'a' },
      expected: { stopId: 'b', following: true, anchorId: null },
    },
    {
      given: 'no stop',
      focus: { stopId: null, following: true, anchorId: 'a' },
      expected: { stopId: null, following: true, anchorId: 'a' },
    },
  ])('toggleAnchor with $given → $expected', ({ focus, expected }) => {
    expect(toggleAnchor(focus)).toEqual(expected);
  });

  it.each([
    {
      focus: { stopId: 'b', following: true, anchorId: 'a' },
      expected: { stopId: 'b', following: true, anchorId: null },
    },
    {
      focus: { stopId: 'b', following: false, anchorId: null },
      expected: { stopId: 'b', following: false, anchorId: null },
    },
  ])('clearAnchor of $focus → $expected', ({ focus, expected }) => {
    expect(clearAnchor(focus)).toEqual(expected);
  });

  const blockStops = ['a#0', 'a#1', 'b#0', 'c#0'];

  it.each([
    {
      given: 'an anchor above the cursor',
      stopId: 'c#0',
      anchorId: 'a#1',
      expected: ['a#1', 'b#0', 'c#0'],
    },
    {
      given: 'an anchor below the cursor',
      stopId: 'a#1',
      anchorId: 'c#0',
      expected: ['a#1', 'b#0', 'c#0'],
    },
    {
      given: 'an anchor on the cursor',
      stopId: 'b#0',
      anchorId: 'b#0',
      expected: ['b#0'],
    },
    {
      given: 'no anchor',
      stopId: 'b#0',
      anchorId: null,
      expected: ['b#0'],
    },
    {
      given: 'an unlisted anchor',
      stopId: 'b#0',
      anchorId: 'x',
      expected: ['b#0'],
    },
    { given: 'no cursor', stopId: null, anchorId: 'a#1', expected: [] },
  ])('rangeStops with $given → $expected', ({ stopId, anchorId, expected }) => {
    const focus = { stopId, following: false, anchorId };
    expect(rangeStops(focus, blockStops)).toEqual(expected);
  });

  const messageStops = ['a#0', 'a#1', 'n1', 'b#0', 'b#1', 'n2'];
  const messages = ['a', 'b'];

  it.each([
    {
      given: 'a stop outside a message, forward',
      stopId: 'n1',
      step: 1,
      expected: 'b#0',
    },
    {
      given: 'a stop outside a message, back',
      stopId: 'n1',
      step: -1,
      expected: 'a#0',
    },
    {
      given: 'inside a message, forward',
      stopId: 'a#0',
      step: 1,
      expected: 'b#0',
    },
    {
      given: 'inside a message, back past its own first stop',
      stopId: 'b#1',
      step: -1,
      expected: 'a#0',
    },
    {
      given: 'the first message, back',
      stopId: 'a#1',
      step: -1,
      expected: 'a#1',
    },
    {
      given: 'the last message, forward',
      stopId: 'b#0',
      step: 1,
      expected: 'b#0',
    },
    { given: 'no cursor, forward', stopId: null, step: 1, expected: 'a#0' },
    { given: 'no cursor, back', stopId: null, step: -1, expected: null },
  ] as const)(
    'moveToMessage from $given → $expected',
    ({ stopId, step, expected }) => {
      const focus = { stopId, following: false, anchorId: 'n2' };
      expect(moveToMessage(focus, messageStops, messages, step)).toEqual({
        stopId: expected,
        following: false,
        anchorId: 'n2',
      });
    },
  );

  it('moveToMessage follows on a target that is the last stop', () => {
    const focus = { stopId: 'a#1', following: false, anchorId: null };
    expect(moveToMessage(focus, ['a#0', 'a#1', 'b'], messages, 1)).toEqual({
      stopId: 'b',
      following: true,
      anchorId: null,
    });
  });

  it.each([
    {
      given: 'the last id',
      from: { stopId: 'a', following: false, anchorId: 'b' },
      stopId: 'c',
      expected: { stopId: 'c', following: true, anchorId: 'b' },
    },
    {
      given: 'an earlier id, from following',
      from: { stopId: 'c', following: true, anchorId: 'a' },
      stopId: 'b',
      expected: { stopId: 'b', following: false, anchorId: 'a' },
    },
    {
      given: 'an earlier id, no anchor',
      from: START_FOCUS,
      stopId: 'a',
      expected: { stopId: 'a', following: false, anchorId: null },
    },
  ])('focusStop on $given → $expected', ({ from, stopId, expected }) => {
    expect(focusStop(from, ids, stopId)).toEqual(expected);
  });

  const stops = ['s0', 's1', 's2', 's3', 's4', 's5'];

  it.each([
    {
      given: 'a visible current',
      current: 's2',
      direction: 1,
      visible: ['s2', 's3'],
      expected: null,
    },
    {
      given: 'nothing visible',
      current: 's2',
      direction: 1,
      visible: [],
      expected: null,
    },
    {
      given: 'the next two hidden, forward',
      current: 's1',
      direction: 1,
      visible: ['s0', 's4'],
      expected: 's4',
    },
    {
      given: 'none following, forward',
      current: 's3',
      direction: 1,
      visible: ['s0', 's1'],
      expected: 's1',
    },
    {
      given: 'the previous hidden, back',
      current: 's4',
      direction: -1,
      visible: ['s1', 's5'],
      expected: 's1',
    },
    {
      given: 'none before, back',
      current: 's2',
      direction: -1,
      visible: ['s3', 's5'],
      expected: 's3',
    },
  ] as const)(
    'nearestVisibleStop with $given → $expected',
    ({ current, direction, visible, expected }) => {
      const isVisible = (id: string) =>
        (visible as readonly string[]).includes(id);
      expect(nearestVisibleStop(stops, current, direction, isVisible)).toBe(
        expected,
      );
    },
  );
});
