import { describe, expect, it } from 'vitest';
import { loadedAgo, loadedLine } from './loaded-time';

// Noon UTC, so every local date below is the same day from UTC−11 to UTC+11.
const NOW = Date.parse('2026-06-01T12:00:00Z');
const DAY = 86_400_000;

function ago(ms: number): string {
  return new Date(NOW - ms).toISOString();
}

describe('loadedAgo', () => {
  it('loadedAgo_UnderAMinute_Now', () => {
    expect(loadedAgo(ago(0), NOW)).toBe('now');
    expect(loadedAgo(ago(59_999), NOW)).toBe('now');
  });

  it('loadedAgo_AheadOfClock_Now', () => {
    expect(loadedAgo(ago(-5_000), NOW)).toBe('now');
  });

  it('loadedAgo_Minutes_Floor', () => {
    expect(loadedAgo(ago(60_000), NOW)).toBe('1m');
    expect(loadedAgo(ago(3_599_999), NOW)).toBe('59m');
  });

  it('loadedAgo_Hours_Floor', () => {
    expect(loadedAgo(ago(3_600_000), NOW)).toBe('1h');
    expect(loadedAgo(ago(86_399_999), NOW)).toBe('23h');
  });

  it('loadedAgo_Days_Floor', () => {
    expect(loadedAgo(ago(DAY), NOW)).toBe('1d');
    expect(loadedAgo(ago(7 * DAY - 1), NOW)).toBe('6d');
  });

  it('loadedAgo_Weeks_Floor', () => {
    expect(loadedAgo(ago(7 * DAY), NOW)).toBe('1w');
    expect(loadedAgo(ago(56 * DAY - 1), NOW)).toBe('7w');
  });

  it('loadedAgo_EightWeeks_Date', () => {
    expect(ago(56 * DAY)).toBe('2026-04-06T12:00:00.000Z');
    expect(loadedAgo(ago(56 * DAY), NOW)).toBe('Apr 6');
  });

  it('loadedAgo_SameYear_MonthAndDay', () => {
    expect(loadedAgo('2026-03-03T12:00:00Z', NOW)).toBe('Mar 3');
  });

  it('loadedAgo_OtherYear_WithYear', () => {
    expect(loadedAgo('2025-03-03T12:00:00Z', NOW)).toBe('Mar 3, 2025');
  });
});

describe('loadedLine', () => {
  it('loadedLine_Now_JustNow', () => {
    expect(loadedLine(ago(1_000), NOW)).toBe('Loaded just now');
  });

  it('loadedLine_Relative_Ago', () => {
    expect(loadedLine(ago(3 * 3_600_000), NOW)).toBe('Loaded 3h ago');
    expect(loadedLine(ago(5 * 7 * DAY), NOW)).toBe('Loaded 5w ago');
  });

  it('loadedLine_Date_NoAgo', () => {
    expect(loadedLine('2026-03-03T12:00:00Z', NOW)).toBe('Loaded Mar 3');
    expect(loadedLine('2025-03-03T12:00:00Z', NOW)).toBe('Loaded Mar 3, 2025');
  });
});
