import { describe, expect, it } from 'vitest';
import { countdownText } from './countdown';

const NOW = 1_000_000;

describe('countdownText', () => {
  it.each([
    { left: 10_000, text: '10s' },
    { left: 9001, text: '10s' },
    { left: 9000, text: '9s' },
    { left: 1, text: '1s' },
    { left: 0, text: '0s' },
    { left: -1500, text: '0s' },
  ])('$left ms → $text', ({ left, text }) => {
    expect(countdownText(NOW + left, NOW)).toBe(text);
  });
});
