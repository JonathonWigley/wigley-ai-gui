import { describe, expect, it } from 'vitest';
import {
  formatDuration,
  formatMinor,
  formatPercent,
  formatUsd,
} from './usage-format';

describe('usage-format', () => {
  it.each([
    { case: 'UnderAMinute', ms: 59_999, expected: '<1m' },
    { case: 'AMinute', ms: 60_000, expected: '1m' },
    { case: 'UnderAnHour', ms: 3_599_999, expected: '59m' },
    { case: 'HoursAndMinutes', ms: 8_070_000, expected: '2h 14m' },
    { case: 'ADay', ms: 86_400_000, expected: '1d 0h' },
    { case: 'DaysAndHours', ms: 274_000_000, expected: '3d 4h' },
  ])('formatDuration_$case', ({ ms, expected }) => {
    expect(formatDuration(ms)).toBe(expected);
  });

  it.each([
    { case: 'Usd', minor: 1234, currency: 'USD', expected: '$12.34' },
    { case: 'UsdWhole', minor: 5000, currency: 'USD', expected: '$50.00' },
    { case: 'Eur', minor: 1234, currency: 'EUR', expected: '€12.34' },
    {
      case: 'JpyHasNoMinorUnit',
      minor: 500,
      currency: 'JPY',
      expected: '¥500',
    },
    { case: 'NoCurrency', minor: 1234, currency: null, expected: '12.34' },
  ])('formatMinor_$case', ({ minor, currency, expected }) => {
    expect(formatMinor(minor, currency)).toBe(expected);
  });

  it.each([
    { case: 'UsdTwoDecimals', text: () => formatUsd(1.234), expected: '$1.23' },
    { case: 'UsdZero', text: () => formatUsd(0), expected: '$0.00' },
    { case: 'PercentRounds', text: () => formatPercent(41.6), expected: '42%' },
    { case: 'PercentZero', text: () => formatPercent(0), expected: '0%' },
  ])('formatUsdAndPercent_$case', ({ text, expected }) => {
    expect(text()).toBe(expected);
  });
});
