import { describe, expect, it } from 'vitest';
import { keepTail } from './keep-tail';

describe('keepTail', () => {
  it.each([
    { case: 'UnderTheLimit_KeepsAll', text: 'ab', limit: 4, kept: 'ab' },
    {
      case: 'OverTheLimit_KeepsTheLast',
      text: 'abcdef',
      limit: 4,
      kept: 'cdef',
    },
    {
      case: 'CutOnALowSurrogate_DropsIt',
      text: 'a\u{1F600}bc',
      limit: 3,
      kept: 'bc',
    },
  ])('keepTail_$case', ({ text, limit, kept }) => {
    expect(keepTail(text, limit)).toBe(kept);
  });
});
