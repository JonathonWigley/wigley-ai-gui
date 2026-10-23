import { describe, expect, it } from 'vitest';
import {
  argsObject,
  nullableNumberOr,
  nullableStringOr,
  optionalBoolean,
  optionalNumber,
  optionalOneOf,
  optionalString,
  optionalStringList,
  requiredBoolean,
  requiredNumber,
  requiredString,
  stringList,
} from './drive-args';

describe('argsObject', () => {
  it('reads no args as an empty object', () => {
    expect(argsObject(undefined)).toEqual({});
    expect(argsObject(null)).toEqual({});
  });

  it('passes an object through', () => {
    expect(argsObject({ a: 1 })).toEqual({ a: 1 });
  });

  it('rejects args that are not an object', () => {
    for (const args of ['x', 1, [], true]) {
      expect(() => argsObject(args)).toThrow('args must be an object');
    }
  });
});

describe('string readers', () => {
  it('read a string field', () => {
    expect(requiredString({ id: 'a' }, 'id')).toBe('a');
    expect(optionalString({ id: 'a' }, 'id')).toBe('a');
  });

  it('reject a field of another type, naming it', () => {
    expect(() => requiredString({ id: 3 }, 'id')).toThrow(
      'id must be a string',
    );
    expect(() => optionalString({ id: 3 }, 'id')).toThrow(
      'id must be a string',
    );
  });

  it('read a missing field as missing', () => {
    expect(() => requiredString({}, 'id')).toThrow('id must be a string');
    expect(optionalString({}, 'id')).toBeUndefined();
  });

  it('let a nullable field hold null, fall back only when left out, and reject other types', () => {
    expect(nullableStringOr({ dir: null }, 'dir', 'f')).toBeNull();
    expect(nullableStringOr({ dir: 'd' }, 'dir', 'f')).toBe('d');
    expect(nullableStringOr({}, 'dir', 'f')).toBe('f');
    expect(() => nullableStringOr({ dir: 1 }, 'dir', 'f')).toThrow(
      'dir must be a string or null',
    );
  });
});

describe('number readers', () => {
  it('read a finite number and reject anything else', () => {
    expect(requiredNumber({ n: 2 }, 'n')).toBe(2);
    expect(optionalNumber({}, 'n')).toBeUndefined();
    for (const n of ['2', Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => requiredNumber({ n }, 'n')).toThrow('n must be a number');
    }
  });

  it('let a nullable field hold null and fall back only when left out', () => {
    expect(nullableNumberOr({ n: null }, 'n', 9)).toBeNull();
    expect(nullableNumberOr({ n: 5 }, 'n', 9)).toBe(5);
    expect(nullableNumberOr({}, 'n', 9)).toBe(9);
    expect(() => nullableNumberOr({ n: 'x' }, 'n', 9)).toThrow(
      'n must be a number',
    );
  });
});

describe('boolean readers', () => {
  it('read a boolean, a missing field as missing, and reject anything else', () => {
    expect(optionalBoolean({ on: true }, 'on')).toBe(true);
    expect(optionalBoolean({ on: false }, 'on')).toBe(false);
    expect(optionalBoolean({}, 'on')).toBeUndefined();
    expect(() => optionalBoolean({ on: 'true' }, 'on')).toThrow(
      'on must be a boolean',
    );
    expect(() => requiredBoolean({}, 'on')).toThrow('on must be a boolean');
  });
});

describe('string list readers', () => {
  it('read a list of strings and reject a mixed list', () => {
    expect(stringList({ keys: ['a', 'b'] }, 'keys')).toEqual(['a', 'b']);
    expect(optionalStringList({}, 'keys')).toBeUndefined();
    expect(() => stringList({ keys: ['a', 1] }, 'keys')).toThrow(
      'keys must be a list of strings',
    );
  });
});

describe('optionalOneOf', () => {
  const allowed = ['claude', 'codex'] as const;

  it('reads an allowed value and a missing one', () => {
    expect(optionalOneOf({ h: 'codex' }, 'h', allowed)).toBe('codex');
    expect(optionalOneOf({}, 'h', allowed)).toBeUndefined();
  });

  it('rejects a value outside the list, naming the list', () => {
    expect(() => optionalOneOf({ h: 'gpt' }, 'h', allowed)).toThrow(
      'h "gpt" is none of claude, codex',
    );
    expect(() => optionalOneOf({ h: 1 }, 'h', allowed)).toThrow(
      'h 1 is none of claude, codex',
    );
  });
});
