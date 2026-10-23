import type { CommandId } from '../../../contracts/commands';
import type {
  KeyBind,
  KeymapUnbind,
  UserKeymap,
} from '../../../contracts/keymap';
import type { UserConfigSchema } from '../../../contracts/user-config';
import { errorText } from '../../../shared/error-text';
import { isJsonObject, type JsonObject } from '../../../shared/json';
import {
  type BindLine,
  isSameKeys,
  keymapLeader,
  sameBind,
} from './keymap-rows';

// The sections the advanced box edits, in the order it shows them.
const ADVANCED_SECTIONS = [
  'groups',
  'remaps',
  'app',
  'intercept',
  'global',
  'unbind',
] as const;

// Spelling `<Leader>` as itself compares keys as written.
const LEADER_AS_WRITTEN = '<Leader>';

// The leader an edit without the schema compares keys with: the layer's own,
// else `<Leader>` as written.
function layerLeader(layer: UserKeymap | null): string {
  return layer?.leader ?? LEADER_AS_WRITTEN;
}

function isKeysUnbind(
  entry: KeymapUnbind,
): entry is Extract<KeymapUnbind, { keys: string }> {
  return 'keys' in entry;
}

// `layer` without an empty array, an empty `groups` or an empty `unbind`.
function tidied(layer: UserKeymap): UserKeymap {
  const kept: JsonObject = { ...layer };
  for (const [key, value] of Object.entries(kept)) {
    const isEmptyArray = Array.isArray(value) && value.length === 0;
    const isEmptyGroups =
      key === 'groups' &&
      isJsonObject(value) &&
      Object.keys(value).length === 0;
    if (isEmptyArray || isEmptyGroups) {
      delete kept[key];
    }
  }
  return kept as UserKeymap;
}

// `layer` with `bind` appended, after dropping every user bind on its keys in
// its scope.
export function withAddedBind(
  layer: UserKeymap | null,
  bind: KeyBind,
): UserKeymap {
  const leader = layerLeader(layer);
  const kept = (layer?.binds ?? []).filter(
    (user) =>
      user.scope !== bind.scope || !isSameKeys(user.keys, bind.keys, leader),
  );
  return tidied({ ...layer, binds: [...kept, bind] });
}

// `layer` without `line`'s bind: a user bind leaves `binds`; a default gets a
// `keys` unbind entry.
export function withRemovedBind(
  layer: UserKeymap | null,
  line: BindLine,
): UserKeymap {
  if (line.origin === 'user') {
    const leader = layerLeader(layer);
    return tidied({
      ...layer,
      binds: (layer?.binds ?? []).filter(
        (user) => !sameBind(user, line.bind, leader),
      ),
    });
  }
  const { keys, scope, where, mode } = line.bind;
  const entry: KeymapUnbind = {
    keys,
    scope,
    ...(where !== undefined && { where }),
    ...(mode !== undefined && { mode }),
  };
  return tidied({ ...layer, unbind: [...(layer?.unbind ?? []), entry] });
}

// `layer` without each user bind naming `command` and each `keys` unbind
// entry that removes one of `command`'s default binds.
export function withCommandReset(
  layer: UserKeymap | null,
  command: CommandId,
  schema: UserConfigSchema,
): UserKeymap {
  const leader = keymapLeader(schema, layer);
  const defaults = schema.defaultBinds.filter(
    (bind) => bind.command === command,
  );
  return tidied({
    ...layer,
    binds: (layer?.binds ?? []).filter((bind) => bind.command !== command),
    unbind: (layer?.unbind ?? []).filter(
      (entry) => !defaults.some((bind) => sameBind(entry, bind, leader)),
    ),
  });
}

// `layer` with its `leader` set to `leader`, or without one for null.
export function withLeader(
  layer: UserKeymap | null,
  leader: string | null,
): UserKeymap {
  const result: UserKeymap = { ...layer };
  if (leader === null) {
    delete result.leader;
  } else {
    result.leader = leader;
  }
  return tidied(result);
}

// The advanced box's text: the layer's groups, remaps, app, intercept and
// global binds and its accelerator unbind entries, as 2-space JSON.
export function advancedText(layer: UserKeymap | null): string {
  const shown: JsonObject = {};
  for (const section of ADVANCED_SECTIONS) {
    const value = layer?.[section];
    if (value !== undefined) {
      shown[section] = value;
    }
  }
  if (layer?.unbind !== undefined) {
    shown.unbind = layer.unbind.filter((entry) => !isKeysUnbind(entry));
  }
  return JSON.stringify(tidied(shown as UserKeymap), null, 2);
}

export type AdvancedEdit =
  | { type: 'layer'; layer: UserKeymap }
  | { type: 'problem'; problem: string };

// The problem with a top-level key of the advanced box's text, or null.
function advancedKeyProblem(key: string): string | null {
  if (key === 'binds' || key === 'leader') {
    return `"${key}" belongs in the command rows`;
  }
  const isAdvanced = (ADVANCED_SECTIONS as readonly string[]).includes(key);
  return isAdvanced ? null : `"${key}" is not a keymap section`;
}

// `layer` with the advanced box's sections replaced by those `text` holds,
// keeping `binds`, `leader` and the `keys` unbind entries; a problem when the
// text is not a JSON object of advanced sections.
export function withAdvanced(
  layer: UserKeymap | null,
  text: string,
): AdvancedEdit {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { type: 'problem', problem: `Not valid JSON: ${errorText(error)}` };
  }
  if (!isJsonObject(parsed)) {
    return {
      type: 'problem',
      problem: 'The top level must be a JSON object.',
    };
  }
  for (const key of Object.keys(parsed)) {
    const problem = advancedKeyProblem(key);
    if (problem !== null) {
      return { type: 'problem', problem };
    }
  }
  const unbind = parsed.unbind ?? [];
  if (!Array.isArray(unbind)) {
    return { type: 'problem', problem: '"unbind" must be a list' };
  }
  const result: JsonObject = { ...layer };
  for (const section of ADVANCED_SECTIONS) {
    if (Object.hasOwn(parsed, section)) {
      result[section] = parsed[section];
    } else {
      delete result[section];
    }
  }
  const keysEntries = (layer?.unbind ?? []).filter(isKeysUnbind);
  result.unbind = [...keysEntries, ...unbind];
  return { type: 'layer', layer: tidied(result as UserKeymap) };
}
