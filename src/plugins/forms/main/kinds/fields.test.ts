import { describe, expect, it } from 'vitest';
import { quotedList } from './fields';

describe('quotedList', () => {
  it('quotes one name alone, joins two with and, and commas three', () => {
    expect(quotedList(['a'])).toBe("'a'");
    expect(quotedList(['a', 'b'])).toBe("'a' and 'b'");
    expect(quotedList(['a', 'b', 'c'])).toBe("'a', 'b', and 'c'");
  });
});
