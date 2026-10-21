import type { Settings } from '../../contracts/settings';
import { jsonKind, parseJsonObject } from './config-json';

// What a `settings.json` may set: the core settings with their defaults, each
// plugin's settings under its id, the JSON kind of each core setting the
// defaults leave unset, and the only strings a setting takes, both by dotted
// path.
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

const NULL_DEFAULT_KINDS = ['a number', 'a string', 'a boolean', 'null'];

// The kinds a setting named in `optionalSettings` takes, by name.
const OPTIONAL_KINDS = {
  string: 'a string',
  number: 'a number',
  boolean: 'a boolean',
} as const;

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return jsonKind(value) === 'an object';
}

// `value` checked against the setting at `path` whose default is `fallback`
// (undefined for a setting the defaults leave unset), merged over it: objects
// merge key by key, arrays and scalars replace whole. Throws naming the first
// value that is not a setting or not of its setting's kind.
function mergeSetting(
  path: string,
  fallback: unknown,
  value: unknown,
  schema: SettingsSchema,
): unknown {
  const kind = jsonKind(value);
  if (fallback === undefined) {
    const optional = schema.optionalSettings[path];
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
  const choices = schema.settingChoices[path];
  if (choices !== undefined) {
    if (typeof value !== 'string' || !choices.includes(value)) {
      throw new Error(
        `"${path}" must be one of ${choices.join(', ')}, not ${JSON.stringify(value)}.`,
      );
    }
    return value;
  }
  if (fallback === null) {
    if (!NULL_DEFAULT_KINDS.includes(kind)) {
      throw new Error(
        `"${path}" must be a number, a string, a boolean or null, not ${kind}.`,
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
  return value;
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
