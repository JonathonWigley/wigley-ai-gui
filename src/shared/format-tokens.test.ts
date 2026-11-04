import { describe, expect, it } from 'vitest';
import { formatTokens } from './format-tokens';

describe('format-tokens', () => {
  it.each([
    { case: 'Zero', tokens: 0, expected: '0k' },
    { case: 'BelowAThousand', tokens: 999, expected: '999' },
    { case: 'AThousand', tokens: 1000, expected: '1k' },
    { case: 'Thousands', tokens: 180_000, expected: '180k' },
    { case: 'RoundsDownBelowAMillion', tokens: 999_499, expected: '999k' },
    { case: 'RoundsUpToAMillion', tokens: 999_500, expected: '1M' },
    { case: 'AMillion', tokens: 1_000_000, expected: '1M' },
    { case: 'MillionsToOneDecimal', tokens: 1_250_000, expected: '1.3M' },
  ])('formatTokens_$case', ({ tokens, expected }) => {
    expect(formatTokens(tokens)).toBe(expected);
  });
});
