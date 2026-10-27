import { describe, expect, it } from 'vitest';
import type { UiState } from '../../../contracts/ui-state';
import { clampSplitWidth, storedSplitWidth } from './split-width';

const limits = { initial: 240, min: 160, max: 400 };

function stateOver(values: Record<string, unknown>): UiState {
  const map = new Map(Object.entries(values));
  return {
    get: (key) => map.get(key),
    set: (key, value) => map.set(key, value),
  };
}

describe('clampSplitWidth', () => {
  it.each([
    { width: 100, limits, expected: 160 },
    { width: 500, limits, expected: 400 },
    { width: 250.6, limits, expected: 251 },
    { width: NaN, limits, expected: 240 },
    { width: Infinity, limits, expected: 240 },
    { width: NaN, limits: { initial: 900, min: 160, max: 400 }, expected: 400 },
  ])(
    'holds $width inside $limits.min–$limits.max as $expected',
    ({ width, limits: rowLimits, expected }) => {
      expect(clampSplitWidth(width, rowLimits)).toBe(expected);
    },
  );
});

describe('storedSplitWidth', () => {
  it.each([
    { stored: { 'docs-tree': 300 }, expected: 300 },
    { stored: { 'docs-tree': 999 }, expected: 400 },
    { stored: {}, expected: 240 },
    { stored: { 'docs-tree': '300' }, expected: 240 },
  ])('reads $stored as $expected', ({ stored, expected }) => {
    expect(storedSplitWidth(stateOver(stored), 'docs-tree', limits)).toBe(
      expected,
    );
  });
});
