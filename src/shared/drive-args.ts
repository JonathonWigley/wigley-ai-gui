import { isJsonObject, type JsonObject } from './json';

// Readers for a drive command's or drive action's args. Each throws naming
// the field when the value there is of the wrong type; an `optional` reader
// returns undefined when the args leave the field out.

// A drive action's args as an object: none (undefined or null) reads as an
// empty object, so every field reads as left out.
export function argsObject(args: unknown): JsonObject {
  if (args === undefined || args === null) {
    return {};
  }
  if (!isJsonObject(args)) {
    throw new Error('args must be an object');
  }
  return args;
}

export function requiredString(args: JsonObject, name: string): string {
  const value = args[name];
  if (typeof value !== 'string') {
    throw new Error(`${name} must be a string`);
  }
  return value;
}

export function optionalString(
  args: JsonObject,
  name: string,
): string | undefined {
  return args[name] === undefined ? undefined : requiredString(args, name);
}

// A field that may hold null as well as a string.
export function optionalNullableString(
  args: JsonObject,
  name: string,
): string | null | undefined {
  const value = args[name];
  if (value !== undefined && value !== null && typeof value !== 'string') {
    throw new Error(`${name} must be a string or null`);
  }
  return value;
}

export function requiredNumber(args: JsonObject, name: string): number {
  const value = args[name];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${name} must be a number`);
  }
  return value;
}

export function optionalNumber(
  args: JsonObject,
  name: string,
): number | undefined {
  return args[name] === undefined ? undefined : requiredNumber(args, name);
}

// A field that may hold null as well as a number.
export function optionalNullableNumber(
  args: JsonObject,
  name: string,
): number | null | undefined {
  return args[name] === null ? null : optionalNumber(args, name);
}

export function stringList(args: JsonObject, name: string): string[] {
  const value = args[name];
  const isStringList =
    Array.isArray(value) && value.every((item) => typeof item === 'string');
  if (!isStringList) {
    throw new Error(`${name} must be a list of strings`);
  }
  return value;
}

export function optionalStringList(
  args: JsonObject,
  name: string,
): string[] | undefined {
  return args[name] === undefined ? undefined : stringList(args, name);
}

// A field that, when present, must be one of `allowed`.
export function optionalOneOf<T extends string>(
  args: JsonObject,
  name: string,
  allowed: readonly T[],
): T | undefined {
  const value = args[name];
  if (value === undefined) {
    return undefined;
  }
  if (!allowed.includes(value as T)) {
    throw new Error(
      `${name} ${JSON.stringify(value)} is none of ${allowed.join(', ')}`,
    );
  }
  return value as T;
}
