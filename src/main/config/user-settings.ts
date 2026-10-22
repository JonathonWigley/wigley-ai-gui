import type { Settings } from '../../contracts/settings';
import { jsonKind, parseJsonObject } from './config-json';

// What a `settings.json` may set: the core settings with their defaults, each
// plugin's settings under its id, the JSON kind of each setting (core or
// plugin) whose default is null or that the defaults leave unset, and the only
// strings a setting takes, both by dotted path (an array element's fields
// under `<path>[]`).
export interface SettingsSchema {
  defaults: Settings;
  pluginDefaults: Record<string, object>;
  optionalSettings: Readonly<Record<string, 'string' | 'number' | 'boolean'>>;
  settingChoices: Readonly<Record<string, readonly string[]>>;
}

export interface UserSettings {
  settings: Settings;
  pluginSettings: Record<string, object>;
}

// The kinds a setting named in `optionalSettings` takes, by name.
const OPTIONAL_KINDS = {
  string: 'a string',
  number: 'a number',
  boolean: 'a boolean',
} as const;

const ELEMENT_INDEX = /\[\d+\]/g;

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return jsonKind(value) === 'an object';
}

// `value` checked against the setting at `path` whose default is `fallback`
// (undefined for a setting the defaults leave unset), merged over it: objects
// merge key by key, arrays and scalars replace whole. An array's elements are
// each checked against the default's first element; an empty default array
// takes any elements, and an object element must carry every key of that
// first element except those `optionalSettings` declares. Throws naming the
// first value that is not a setting, not of its setting's kind, or missing.
function mergeSetting(
  path: string,
  fallback: unknown,
  value: unknown,
  schema: SettingsSchema,
): unknown {
  const kind = jsonKind(value);
  const declaredPath = path.replace(ELEMENT_INDEX, '[]');
  if (fallback === undefined) {
    const optional = schema.optionalSettings[declaredPath];
    if (optional === undefined) {
      throw new Error(`"${path}" is not a setting.`);
    }
    if (kind !== OPTIONAL_KINDS[optional]) {
      throw new Error(
        `"${path}" must be ${OPTIONAL_KINDS[optional]}, not ${kind}.`,
      );
    }
    return value;
  }
  const choices = schema.settingChoices[declaredPath];
  if (choices !== undefined) {
    if (typeof value !== 'string' || !choices.includes(value)) {
      throw new Error(
        `"${path}" must be one of ${choices.join(', ')}, not ${JSON.stringify(value)}.`,
      );
    }
    return value;
  }
  if (fallback === null) {
    const optional = schema.optionalSettings[declaredPath];
    if (optional === undefined) {
      throw new Error(`"${path}" defaults to null and declares no kind.`);
    }
    if (kind !== 'null' && kind !== OPTIONAL_KINDS[optional]) {
      throw new Error(
        `"${path}" must be ${OPTIONAL_KINDS[optional]} or null, not ${kind}.`,
      );
    }
    return value;
  }
  const expected = jsonKind(fallback);
  if (kind !== expected) {
    throw new Error(`"${path}" must be ${expected}, not ${kind}.`);
  }
  if (isJsonObject(fallback) && isJsonObject(value)) {
    return mergeObject(path, fallback, value, schema);
  }
  if (Array.isArray(fallback) && Array.isArray(value)) {
    checkElements(path, fallback, value, schema);
  }
  return value;
}

// Throws naming the first element of `value`, the array at `path`, that is
// not of the kind of `fallback`'s first element, or the first key of that
// first element an object element lacks. An element is checked, never merged,
// so it must carry every key the default element has, except a null-default
// key `optionalSettings` declares under `<path>[]` (`p.profiles[].note`).
function checkElements(
  path: string,
  fallback: unknown[],
  value: unknown[],
  schema: SettingsSchema,
): void {
  if (fallback.length === 0) {
    return;
  }
  const model = fallback[0];
  const declaredPath = `${path.replace(ELEMENT_INDEX, '[]')}[]`;
  value.forEach((element, index) => {
    const elementPath = `${path}[${index}]`;
    mergeSetting(elementPath, model, element, schema);
    if (isJsonObject(model) && isJsonObject(element)) {
      const missing = Object.keys(model).find(
        (key) =>
          !Object.hasOwn(element, key) &&
          !Object.hasOwn(schema.optionalSettings, `${declaredPath}.${key}`),
      );
      if (missing !== undefined) {
        throw new Error(`"${elementPath}.${missing}" is missing.`);
      }
    }
  });
}

function mergeObject(
  path: string,
  fallback: Record<string, unknown>,
  value: Record<string, unknown>,
  schema: SettingsSchema,
): Record<string, unknown> {
  const merged = { ...fallback };
  for (const [key, child] of Object.entries(value)) {
    const childPath = path === '' ? key : `${path}.${key}`;
    const childFallback = Object.hasOwn(fallback, key)
      ? fallback[key]
      : undefined;
    merged[key] = mergeSetting(childPath, childFallback, child, schema);
  }
  return merged;
}

// The settings `text`, a `settings.json`, deep-merges over the defaults: core
// settings by name, each plugin's under its id. Throws an Error whose message
// is the first problem found, as the user reads it.
export function mergeUserSettings(
  text: string,
  schema: SettingsSchema,
): UserSettings {
  const user = parseJsonObject(text);
  const defaults: Record<string, unknown> = {
    ...schema.defaults,
    ...schema.pluginDefaults,
  };
  const merged = mergeObject('', defaults, user, schema);
  const settings = Object.fromEntries(
    Object.keys(schema.defaults).map((key) => [key, merged[key]]),
  ) as unknown as Settings;
  const pluginSettings = Object.fromEntries(
    Object.keys(schema.pluginDefaults).map((id) => [id, merged[id] as object]),
  );
  return { settings, pluginSettings };
}
