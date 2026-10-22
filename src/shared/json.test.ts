import { describe, expect, it } from 'vitest';
import { isJsonObject } from './json';

describe('isJsonObject', () => {
  it('isJsonObject_PlainObjects_True', () => {
    expect(isJsonObject({})).toBe(true);
    expect(isJsonObject(JSON.parse('{"a":1}'))).toBe(true);
  });

  it('isJsonObject_ArraysNullAndScalars_False', () => {
    for (const value of [[], null, undefined, 'x', 1, true]) {
      expect(isJsonObject(value)).toBe(false);
    }
  });
});
