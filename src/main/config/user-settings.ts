import type { Settings } from '../../contracts/settings';
import { PLUGIN_ID_PATTERN } from '../../shared/define-plugin';
import { isJsonObject, jsonKind } from '../../shared/json';
import { parseJsonObject } from './config-json';

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

// `ignored` holds each top-level key the merge left out as a plugin's section
// whose plugin is not loaded.
export interface UserSettings {
  settings: Settings;
  pluginSettings: Record<string, object>;
  ignored: string[];
}

// A top-level key that may be a section of a plugin that is not loaded.
const PLUGIN_SECTION_KEY = new RegExp(PLUGIN_ID_PATTERN);

// The kinds a setting named in `optionalSettings` takes, by name.
const OPTIONAL_KINDS = {
  string: 'a string',
  number: 'a number',
  boolean: 'a boolean',
} as const;

const ELEMENT_INDEX = /\[\d+\]/g;

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

// The defaults as a `settings.json` lays them out: core settings by name, each
// plugin's under its id. An id sharing a core name declares no settings, so that
// key is the core setting's.
export function settingsFileDefaults(
  defaults: Settings,
  pluginDefaults: Record<string, object>,
): Record<string, unknown> {
  return { ...pluginDefaults, ...defaults };
}

// Whether `a` and `b` differ by at most one inserted, deleted or changed
// character, or one swap of neighbours.
function isOneEditApart(a: string, b: string): boolean {
  const lengthGap = Math.abs(a.length - b.length);
  if (lengthGap > 1) {
    return false;
  }
  let start = 0;
  while (start < a.length && a[start] === b[start]) {
    start++;
  }
  const rest = (from: string, skip: number) => from.slice(start + skip);
  const isSwap =
    a.length === b.length &&
    a[start] === b[start + 1] &&
    a[start + 1] === b[start] &&
    rest(a, 2) === rest(b, 2);
  return (
    isSwap ||
    rest(a, 1) === rest(b, 1) ||
    rest(a, 1) === rest(b, 0) ||
    rest(a, 0) === rest(b, 1)
  );
}

// Whether the top-level `key` of the file is the section of a plugin that is
// not loaded: an object under a plugin-id-shaped key that is no core setting,
// no plugin's id, and no misspelling of a core setting.
function isAbsentPluginSection(
  key: string,
  value: unknown,
  defaults: Record<string, unknown>,
  coreNames: readonly string[],
): boolean {
  const isKnownKey = Object.hasOwn(defaults, key);
  const isPluginIdShaped = PLUGIN_SECTION_KEY.test(key);
  const isMisspeltCoreName = coreNames.some((name) =>
    isOneEditApart(key, name),
  );
  return (
    !isKnownKey &&
    isPluginIdShaped &&
    !isMisspeltCoreName &&
    isJsonObject(value)
  );
}

// The settings `text`, a `settings.json`, deep-merges over the defaults: core
// settings by name, each plugin's under its id. A top-level object under a
// plugin-id-shaped key that is no core setting, no plugin's id and not one edit
// from a core setting's name is a plugin that is not loaded: it is ignored and
// listed in `ignored`. Throws an Error whose message is the first problem found,
// as the user reads it.
export function mergeUserSettings(
  text: string,
  schema: SettingsSchema,
): UserSettings {
  const file = parseJsonObject(text);
  const defaults = settingsFileDefaults(schema.defaults, schema.pluginDefaults);
  const coreNames = Object.keys(schema.defaults);
  const ignored = Object.keys(file).filter((key) =>
    isAbsentPluginSection(key, file[key], defaults, coreNames),
  );
  const user = Object.fromEntries(
    Object.entries(file).filter(([key]) => !ignored.includes(key)),
  );
  const merged = mergeObject('', defaults, user, schema);
  const settings = Object.fromEntries(
    Object.keys(schema.defaults).map((key) => [key, merged[key]]),
  ) as unknown as Settings;
  const pluginSettings = Object.fromEntries(
    Object.entries(schema.pluginDefaults).map(([id, fallback]) => [
      id,
      Object.hasOwn(schema.defaults, id) ? fallback : (merged[id] as object),
    ]),
  );
  return { settings, pluginSettings, ignored };
}
