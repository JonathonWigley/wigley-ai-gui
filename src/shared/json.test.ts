import { describe, expect, it } from 'vitest';
import { isJsonObject, isSameJson } from './json';

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

describe('isSameJson', () => {
  it('isSameJson_ObjectKeysInAnotherOrder_True', () => {
    expect(isSameJson({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
  });

  it('isSameJson_ArrayItemsInAnotherOrder_False', () => {
    expect(isSameJson([1, 2], [2, 1])).toBe(false);
  });

  it('isSameJson_NestedReordered_True', () => {
    const a = { x: { p: [1, { q: 'r', s: null }], t: true } };
    const b = { x: { t: true, p: [1, { s: null, q: 'r' }] } };
    expect(isSameJson(a, b)).toBe(true);
  });

  it('isSameJson_NestedValueDiffers_False', () => {
    expect(isSameJson({ x: { p: [1, 2] } }, { x: { p: [1, 3] } })).toBe(false);
  });

  it('isSameJson_KeyMissingOnOneSide_False', () => {
    expect(isSameJson({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(isSameJson({ a: 1, b: 2 }, { a: 1 })).toBe(false);
  });

  it('isSameJson_ArrayAgainstObjectOrNull_False', () => {
    expect(isSameJson([], {})).toBe(false);
    expect(isSameJson({}, null)).toBe(false);
    expect(isSameJson(0, null)).toBe(false);
  });

  it('isSameJson_UndefinedValuedKey_MatchesAbsentKey', () => {
    expect(isSameJson({ a: 1, b: undefined }, { a: 1 })).toBe(true);
  });
});
