// The checks one keymap entry takes, as the user keymap and a plugin
// manifest's keys share them. Each throws an Error naming the entry's path, as
// the user reads it.

import type { EditorMode, EditorRemap } from '../contracts/keymap';
import { jsonKind } from './json';
import { EDITOR_MODES } from './plugin-manifests';

// The fields one kind of entry holds, and the noun a problem names it by.
export interface EntryShape {
  noun: string;
  required: readonly string[];
  optional: readonly string[];
}

const EDITOR_REMAP: EntryShape = {
  noun: 'an editor remap',
  required: ['mode', 'keys', 'to'],
  optional: [],
};

export function requireObject(
  path: string,
  value: unknown,
): Record<string, unknown> {
  const kind = jsonKind(value);
  if (kind !== 'an object') {
    throw new Error(`"${path}" must be an object, not ${kind}.`);
  }
  return value as Record<string, unknown>;
}

export function requireString(path: string, value: unknown): string {
  const kind = jsonKind(value);
  if (kind !== 'a string') {
    throw new Error(`"${path}" must be a string, not ${kind}.`);
  }
  return value as string;
}

export function requireKeysString(path: string, value: unknown): string {
  const keys = requireString(path, value);
  if (keys === '') {
    throw new Error(`"${path}" is empty.`);
  }
  return keys;
}

export function requireMode(path: string, value: unknown): EditorMode {
  const isMode = EDITOR_MODES.some((mode) => mode === value);
  if (!isMode) {
    throw new Error(
      `"${path}" must be one of ${EDITOR_MODES.join(', ')}, not ${JSON.stringify(value)}.`,
    );
  }
  return value as EditorMode;
}

// The entry at `path` as an object holding only `shape`'s fields and every
// one it requires.
export function requireFields(
  path: string,
  value: unknown,
  shape: EntryShape,
): Record<string, unknown> {
  const entry = requireObject(path, value);
  const known = [...shape.required, ...shape.optional];
  for (const field of Object.keys(entry)) {
    if (!known.includes(field)) {
      throw new Error(`"${path}.${field}" is not a field of ${shape.noun}.`);
    }
  }
  for (const field of shape.required) {
    if (!Object.hasOwn(entry, field)) {
      throw new Error(`"${path}.${field}" is missing.`);
    }
  }
  return entry;
}

// The editor remap at `path`: `mode`, non-empty `keys` and `to`, and no other
// field.
export function readEditorRemap(path: string, value: unknown): EditorRemap {
  const entry = requireFields(path, value, EDITOR_REMAP);
  return {
    mode: requireMode(`${path}.mode`, entry.mode),
    keys: requireKeysString(`${path}.keys`, entry.keys),
    to: requireString(`${path}.to`, entry.to),
  };
}
