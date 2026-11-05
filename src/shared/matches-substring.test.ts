import { describe, expect, it } from 'vitest';
import { matchesSubstring } from './matches-substring';

describe('matchesSubstring', () => {
  it.each([
    { query: 'wait', isMatch: true },
    { query: ' WAIT ', isMatch: true },
    { query: '   ', isMatch: true },
    { query: 'tpt', isMatch: false },
  ])('"$query" → $isMatch', ({ query, isMatch }) => {
    expect(matchesSubstring(query, 'A transparent wait')).toBe(isMatch);
  });
});
