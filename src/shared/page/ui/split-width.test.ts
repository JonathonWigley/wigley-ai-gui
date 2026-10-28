import { describe, expect, it } from 'vitest';
import type { UiState } from '../../../contracts/ui-state';
import {
  clampSplitWidth,
  nudgedSplitWidth,
  storedSplitWidth,
} from './split-width';

const limits = { initial: 240, min: 160, endMin: 200 };

function stateOver(values: Record<string, unknown>): UiState {
  const map = new Map(Object.entries(values));
  return {
    get: (key) => map.get(key),
    set: (key, value) => map.set(key, value),
  };
}

describe('clampSplitWidth', () => {
  it.each([
    { width: 100, span: 800, limits, expected: 160 },
    { width: 700, span: 800, limits, expected: 600 },
    { width: 250.6, span: 800, limits, expected: 251 },
    { width: NaN, span: 800, limits, expected: 240 },
    { width: Infinity, span: 800, limits, expected: 240 },
    { width: 300, span: 300, limits, expected: 160 },
    { width: 5000, span: Infinity, limits, expected: 5000 },
    {
      width: NaN,
      span: 800,
      limits: { initial: 900, min: 160, endMin: 200 },
      expected: 600,
    },
  ])(
    'holds $width in a $span span as $expected',
    ({ width, span, limits: rowLimits, expected }) => {
      expect(clampSplitWidth(width, rowLimits, span)).toBe(expected);
    },
  );
});

describe('nudgedSplitWidth', () => {
  it.each([
    { width: 240, direction: 'right', span: 800, expected: 264 },
    { width: 240, direction: 'left', span: 800, expected: 216 },
    { width: 170, direction: 'left', span: 800, expected: 160 },
    { width: 160, direction: 'left', span: 800, expected: 160 },
    { width: 590, direction: 'right', span: 800, expected: 600 },
    { width: 600, direction: 'right', span: 800, expected: 600 },
  ] as const)(
    'moves $width $direction to $expected',
    ({ width, direction, span, expected }) => {
      expect(nudgedSplitWidth(width, direction, limits, span)).toBe(expected);
    },
  );
});

describe('storedSplitWidth', () => {
  it.each([
    { stored: { 'docs-tree': 300 }, expected: 300 },
    { stored: { 'docs-tree': 999 }, expected: 999 },
    { stored: { 'docs-tree': 100 }, expected: 160 },
    { stored: {}, expected: 240 },
    { stored: { 'docs-tree': '300' }, expected: 240 },
  ])('reads $stored as $expected', ({ stored, expected }) => {
    expect(storedSplitWidth(stateOver(stored), 'docs-tree', limits)).toBe(
      expected,
    );
  });
});
