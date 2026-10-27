import { describe, expect, it } from 'vitest';
import { fitScale } from './fit-scale';

describe('fitScale', () => {
  it('fitScale_LargerImage_ScalesDown', () => {
    expect(
      fitScale({ width: 2000, height: 1000 }, { width: 800, height: 600 }),
    ).toBe(0.4);
  });

  it('fitScale_SmallerImage_KeepsOne', () => {
    expect(
      fitScale({ width: 400, height: 300 }, { width: 800, height: 600 }),
    ).toBe(1);
  });

  it('fitScale_ZeroHost_Throws', () => {
    expect(() =>
      fitScale({ width: 400, height: 300 }, { width: 0, height: 600 }),
    ).toThrow();
  });
});
