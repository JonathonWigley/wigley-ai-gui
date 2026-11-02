import { describe, expect, it } from 'vitest';
import { snapHead, widenRange } from './chip-decorations';

const CHIPS = [{ from: 4, to: 20 }];

describe('snapHead', () => {
  it.each([
    { previous: 3, next: 5, lineEnd: 30, isInsert: false, head: 20 },
    { previous: 20, next: 19, lineEnd: 30, isInsert: false, head: 4 },
    { previous: 4, next: 5, lineEnd: 20, isInsert: false, head: 4 },
    { previous: 4, next: 5, lineEnd: 20, isInsert: true, head: 20 },
    { previous: 3, next: 4, lineEnd: 30, isInsert: false, head: 4 },
    { previous: 24, next: 25, lineEnd: 30, isInsert: false, head: 25 },
  ])(
    "keeps the cursor off a chip's inside: ($previous → $next, line end $lineEnd, insert $isInsert) → $head",
    ({ previous, next, lineEnd, isInsert, head }) => {
      expect(snapHead(CHIPS, previous, next, lineEnd, isInsert)).toBe(head);
    },
  );
});

describe('widenRange', () => {
  it.each([
    { from: 4, to: 5, widened: { from: 4, to: 20 } },
    { from: 19, to: 20, widened: { from: 4, to: 20 } },
    { from: 2, to: 6, widened: { from: 2, to: 20 } },
    { from: 10, to: 12, widened: { from: 4, to: 20 } },
    { from: 0, to: 3, widened: { from: 0, to: 3 } },
    { from: 3, to: 25, widened: { from: 3, to: 25 } },
    { from: 20, to: 22, widened: { from: 20, to: 22 } },
  ])('takes a chip whole: ($from, $to) → $widened', ({ from, to, widened }) => {
    expect(widenRange(CHIPS, from, to)).toEqual(widened);
  });
});
