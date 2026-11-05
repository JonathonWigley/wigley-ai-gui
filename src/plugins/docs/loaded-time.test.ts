import { describe, expect, it } from 'vitest';
import { loadedAgo, loadedLine, loadedMark } from './loaded-time';

// Noon UTC, so every local date below is the same day from UTC−11 to UTC+11.
const NOW = Date.parse('2026-06-01T12:00:00Z');
const DAY = 86_400_000;

function ago(ms: number): string {
  return new Date(NOW - ms).toISOString();
}

describe('loadedAgo', () => {
  it.each([
    { loaded: ago(0), expected: 'now' },
    { loaded: ago(59_999), expected: 'now' },
    { loaded: ago(-5_000), expected: 'now' },
    { loaded: ago(60_000), expected: '1m' },
    { loaded: ago(3_599_999), expected: '59m' },
    { loaded: ago(3_600_000), expected: '1h' },
    { loaded: ago(86_399_999), expected: '23h' },
    { loaded: ago(DAY), expected: '1d' },
    { loaded: ago(7 * DAY - 1), expected: '6d' },
    { loaded: ago(7 * DAY), expected: '1w' },
    { loaded: ago(56 * DAY - 1), expected: '7w' },
    { loaded: '2026-03-03T12:00:00Z', expected: 'Mar 3' },
    { loaded: '2025-03-03T12:00:00Z', expected: 'Mar 3, 2025' },
  ])('$loaded → $expected', ({ loaded, expected }) => {
    expect(loadedAgo(loaded, NOW)).toBe(expected);
  });

  it('loadedAgo_EightWeeks_Date', () => {
    expect(ago(56 * DAY)).toBe('2026-04-06T12:00:00.000Z');
    expect(loadedAgo(ago(56 * DAY), NOW)).toBe('Apr 6');
  });
});

describe('loadedMark', () => {
  it('loadedMark_NeverLoaded_Null', () => {
    expect(loadedMark(null, NOW)).toBeNull();
  });

  it('loadedMark_Loaded_ShortTextAndFullTitle', () => {
    const mark = loadedMark(ago(3 * 3_600_000), NOW);

    expect(mark?.text).toBe('3h');
    expect(mark?.title).toContain('2026');
  });
});

describe('loadedLine', () => {
  it.each([
    { loaded: ago(1_000), expected: 'now' },
    { loaded: ago(3 * 3_600_000), expected: '3h' },
    { loaded: ago(5 * 7 * DAY), expected: '5w' },
    { loaded: '2026-03-03T12:00:00Z', expected: 'Mar 3' },
    { loaded: '2025-03-03T12:00:00Z', expected: 'Mar 3, 2025' },
  ])('$loaded → $expected', ({ loaded, expected }) => {
    expect(loadedLine(loaded, NOW)).toContain(expected);
  });
});
