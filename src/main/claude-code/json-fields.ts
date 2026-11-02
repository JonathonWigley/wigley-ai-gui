import { isJsonObject, type JsonObject } from '../../shared/json';

// Readers for Claude's JSON lines: each reads a field as one shape, or that
// shape's empty value (null for a number) when the field holds another.
export type Json = JsonObject;

export function asJson(value: unknown): Json {
  return isJsonObject(value) ? value : {};
}

export function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function parsed(
  line: string,
): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(line) };
  } catch {
    return { ok: false };
  }
}
