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
  it('clamps a width below min to min', () => {
    expect(clampSplitWidth(100, limits)).toBe(160);
  });

  it('clamps a width above max to max', () => {
    expect(clampSplitWidth(500, limits)).toBe(400);
  });

  it('rounds a width inside the limits', () => {
    expect(clampSplitWidth(250.6, limits)).toBe(251);
  });

  it('takes initial for a width that is not finite', () => {
    expect(clampSplitWidth(NaN, limits)).toBe(240);
    expect(clampSplitWidth(Infinity, limits)).toBe(240);
  });

  it('clamps an initial outside the limits', () => {
    expect(clampSplitWidth(NaN, { initial: 900, min: 160, max: 400 })).toBe(
      400,
    );
  });
});

describe('storedSplitWidth', () => {
  it('reads a stored width', () => {
    expect(
      storedSplitWidth(stateOver({ 'docs-tree': 300 }), 'docs-tree', limits),
    ).toBe(300);
  });

  it('clamps a stored width', () => {
    expect(
      storedSplitWidth(stateOver({ 'docs-tree': 999 }), 'docs-tree', limits),
    ).toBe(400);
  });

  it('takes initial when nothing is stored', () => {
    expect(storedSplitWidth(stateOver({}), 'docs-tree', limits)).toBe(240);
  });

  it('takes initial for a stored value that is not a number', () => {
    expect(
      storedSplitWidth(stateOver({ 'docs-tree': '300' }), 'docs-tree', limits),
    ).toBe(240);
  });
});
