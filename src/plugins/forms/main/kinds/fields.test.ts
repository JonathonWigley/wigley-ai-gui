import { describe, expect, it } from 'vitest';
import { parseLayoutField, quotedList } from './fields';
import { roundErrorText } from '../mcp-wording';
import { RoundError, type RoundItemPath } from '../round-error';

const QUESTION_1: RoundItemPath = { at: 'item', kind: 'question', number: 1 };

describe('quotedList', () => {
  it('quotes one name alone, joins two with and, and commas three', () => {
    expect(quotedList(['a'])).toBe("'a'");
    expect(quotedList(['a', 'b'])).toBe("'a' and 'b'");
    expect(quotedList(['a', 'b', 'c'])).toBe("'a', 'b', and 'c'");
  });
});

describe('parseLayoutField', () => {
  it('reads an absent or null layout as null', () => {
    expect(parseLayoutField({}, QUESTION_1)).toBeNull();
    expect(parseLayoutField({ layout: null }, QUESTION_1)).toBeNull();
  });

  it('keeps a layout name as sent', () => {
    expect(parseLayoutField({ layout: ' compact' }, QUESTION_1)).toBe(
      ' compact',
    );
  });

  it('refuses a blank layout or one that is not a string', () => {
    for (const layout of ['', '  ', 3]) {
      let thrown: unknown = null;
      try {
        parseLayoutField({ layout }, QUESTION_1);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(RoundError);
      expect(roundErrorText(thrown as RoundError)).toMatch(
        /^Question 1: .*layout/,
      );
    }
  });
});
