import { describe, expect, it } from 'vitest';
import { sparklineShape } from './sparkline';

describe('sparklineShape', () => {
  it.each([
    { values: [], viewBox: '0 0 1 100', points: '' },
    { values: [40], viewBox: '0 0 1 100', points: '0,60 1,60' },
    { values: [10, 55, 100], viewBox: '0 0 2 100', points: '0,90 1,45 2,0' },
    {
      values: [-5, 120, 37.5, 64],
      viewBox: '0 0 3 100',
      points: '0,100 1,0 2,62.5 3,36',
    },
    { values: [NaN, 50], viewBox: '0 0 1 100', points: '0,100 1,50' },
  ])(
    'sparklineShape_PlacesEachValueAcrossTheWidth $values',
    ({ values, viewBox, points }) => {
      expect(sparklineShape(values)).toEqual({ viewBox, points });
    },
  );
});
