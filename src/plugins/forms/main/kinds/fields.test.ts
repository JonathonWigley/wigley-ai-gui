import { describe, expect, it } from 'vitest';
import { parseLayoutField, quotedList } from './fields';
import { RoundError } from '../round-error';

describe('quotedList', () => {
  it('quotes one name alone, joins two with and, and commas three', () => {
    expect(quotedList(['a'])).toBe("'a'");
    expect(quotedList(['a', 'b'])).toBe("'a' and 'b'");
    expect(quotedList(['a', 'b', 'c'])).toBe("'a', 'b', and 'c'");
  });
});

describe('parseLayoutField', () => {
  it('reads an absent or null layout as null', () => {
    expect(parseLayoutField({}, 'Question 1: ')).toBeNull();
    expect(parseLayoutField({ layout: null }, 'Question 1: ')).toBeNull();
  });

  it('keeps a layout name as sent', () => {
    expect(parseLayoutField({ layout: ' compact' }, 'Question 1: ')).toBe(
      ' compact',
    );
  });

  it('refuses a blank layout or one that is not a string', () => {
    for (const layout of ['', '  ', 3]) {
      const parse = () => parseLayoutField({ layout }, 'Question 1: ');
      expect(parse).toThrow(RoundError);
      expect(parse).toThrow(/^Question 1: .*layout/);
    }
  });
});
