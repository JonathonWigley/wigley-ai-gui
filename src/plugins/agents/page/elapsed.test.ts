import { describe, expect, it } from 'vitest';
import { elapsedText } from './elapsed';

describe('elapsedText', () => {
  it.each([
    { ms: 0, text: '0s' },
    { ms: 8000, text: '8s' },
    { ms: 42999, text: '42s' },
    { ms: 59999, text: '59s' },
    { ms: 60000, text: '1m 00s' },
    { ms: 185000, text: '3m 05s' },
    { ms: 3599000, text: '59m 59s' },
    { ms: 3600000, text: '1h 00m' },
    { ms: 3720000, text: '1h 02m' },
    { ms: -500, text: '0s' },
  ])('elapsedText_Ms_Formats ($ms → $text)', ({ ms, text }) => {
    expect(elapsedText(ms)).toBe(text);
  });
});
