import { describe, expect, it } from 'vitest';
import {
  chevronStates,
  type ItemSpan,
  revealTarget,
  stepTarget,
} from './h-scroller-steps';

// Five items 50 wide with a 10 gap, in a 290 track.
const fiveItems: ItemSpan[] = [
  { start: 0, end: 50 },
  { start: 60, end: 110 },
  { start: 120, end: 170 },
  { start: 180, end: 230 },
  { start: 240, end: 290 },
];

describe('chevronStates', () => {
  it.each([
    {
      scrollLeft: 0,
      scrollWidth: 100,
      expected: { overflows: false, back: false, forward: false },
    },
    {
      scrollLeft: 0,
      scrollWidth: 100.5,
      expected: { overflows: false, back: false, forward: false },
    },
    {
      scrollLeft: 0,
      scrollWidth: 300,
      expected: { overflows: true, back: false, forward: true },
    },
    {
      scrollLeft: 100,
      scrollWidth: 300,
      expected: { overflows: true, back: true, forward: true },
    },
    {
      scrollLeft: 200,
      scrollWidth: 300,
      expected: { overflows: true, back: true, forward: false },
    },
    {
      scrollLeft: 199.5,
      scrollWidth: 300,
      expected: { overflows: true, back: true, forward: false },
    },
  ])(
    'at $scrollLeft of $scrollWidth shows $expected',
    ({ scrollLeft, scrollWidth, expected }) => {
      expect(
        chevronStates({ scrollLeft, clientWidth: 100, scrollWidth }),
      ).toEqual(expected);
    },
  );
});

describe('stepTarget', () => {
  it.each([
    {
      items: fiveItems,
      scrollWidth: 290,
      scrollLeft: 0,
      direction: 'forward',
      expected: 10,
    },
    {
      items: fiveItems,
      scrollWidth: 290,
      scrollLeft: 10,
      direction: 'forward',
      expected: 70,
    },
    {
      items: fiveItems,
      scrollWidth: 290,
      scrollLeft: 70,
      direction: 'forward',
      expected: 130,
    },
    {
      items: fiveItems,
      scrollWidth: 290,
      scrollLeft: 190,
      direction: 'forward',
      expected: 190,
    },
    {
      items: fiveItems,
      scrollWidth: 290,
      scrollLeft: 190,
      direction: 'back',
      expected: 180,
    },
    {
      items: fiveItems,
      scrollWidth: 290,
      scrollLeft: 130,
      direction: 'back',
      expected: 120,
    },
    {
      items: fiveItems,
      scrollWidth: 290,
      scrollLeft: 0,
      direction: 'back',
      expected: 0,
    },
    {
      items: [
        { start: 0, end: 50 },
        { start: 60, end: 460 },
      ],
      scrollWidth: 460,
      scrollLeft: 0,
      direction: 'forward',
      expected: 60,
    },
    {
      items: [{ start: 0, end: 400 }],
      scrollWidth: 400,
      scrollLeft: 0,
      direction: 'forward',
      expected: 300,
    },
  ] as const)(
    'steps $direction from $scrollLeft to $expected',
    ({ items, scrollWidth, scrollLeft, direction, expected }) => {
      const view = { scrollLeft, clientWidth: 100, scrollWidth };
      expect(stepTarget(items, view, direction)).toBe(expected);
    },
  );
});

describe('revealTarget', () => {
  it.each([
    { item: { start: 60, end: 110 }, scrollLeft: 0, expected: 10 },
    { item: { start: 0, end: 50 }, scrollLeft: 130, expected: 0 },
    { item: { start: 60, end: 110 }, scrollLeft: 60, expected: 60 },
    { item: { start: 240, end: 290 }, scrollLeft: 0, expected: 190 },
    { item: { start: 60, end: 250 }, scrollLeft: 0, expected: 60 },
  ])(
    'reveals $item from $scrollLeft at $expected',
    ({ item, scrollLeft, expected }) => {
      const view = { scrollLeft, clientWidth: 100, scrollWidth: 290 };
      expect(revealTarget(item, view)).toBe(expected);
    },
  );
});
