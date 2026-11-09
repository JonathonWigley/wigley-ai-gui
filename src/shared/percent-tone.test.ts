import { describe, expect, it } from 'vitest';
import { percentTone } from './percent-tone';

describe('percentTone', () => {
  it.each([
    { percent: 0, tone: 'normal' },
    { percent: 69.4, tone: 'normal' },
    { percent: 69.5, tone: 'warning' },
    { percent: 89.4, tone: 'warning' },
    { percent: 89.5, tone: 'critical' },
    { percent: 110, tone: 'critical' },
  ])('percentTone_RoundsThenThresholds: $percent', ({ percent, tone }) => {
    expect(percentTone(percent)).toBe(tone);
  });
});
