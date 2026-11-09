import type { CommandArg, CommandId } from '../../../contracts/commands';
import type {
  BindWhere,
  KeyBind,
  KeymapUnbind,
  UserKeymap,
} from '../../../contracts/keymap';
import type { UserConfigSchema } from '../../../contracts/user-config';
import { errorText } from '../../../shared/error-text';
import { normalVimKeys } from '../../../shared/key-hints';
import {
  isJsonObject,
  isSameJson,
  type JsonObject,
} from '../../../shared/json';
import {
  defaultBindLines,
  type DefaultBindLine,
  expandBind,
  sharedHalves,
} from '../../../shared/plugin-manifests';
import { type BindLine, isExpandable, keymapLeader } from './keymap-rows';

// The sections the advanced box edits, in the order it shows them.
const ADVANCED_SECTIONS = [
  'remaps',
  'app',
  'intercept',
  'global',
  'unbind',
] as const;

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

// Whether the bind or `keys` unbind entry `a` shares a page or editor half
// with `b`, as the merge tells binds apart.
function sharesAHalf(
  a: KeyBind | KeymapUnbind,
  b: KeyBind,
  leader: string,
): boolean {
  const shared = sharedHalves(a, b, leader);
  return shared.page || shared.editor;
}

// `layer` with `bind` appended, after dropping every user bind sharing a half
// with it under the layer's leader, else the schema's default. Keys the merge
// cannot expand drop nothing; writing the layer reports them.
export function withAddedBind(
  layer: UserKeymap | null,
  bind: KeyBind,
  schema: UserConfigSchema,
): UserKeymap {
  const leader = keymapLeader(schema, layer);
  const isValid = isExpandable(bind, leader);
  const kept = (layer?.binds ?? []).filter(
    (user) => !isValid || !sharesAHalf(user, bind, leader),
  );
  return tidied({ ...layer, binds: [...kept, bind] });
}

// The `where` of the unbind entry removing default `line`: the bind's own,
// narrowed to the one half still its own when a later default layer's bind
// took the other, so the entry leaves that bind alone.
function unbindWhere(line: BindLine, leader: string): BindWhere | undefined {
  const halves = expandBind(line.bind, leader);
  if (halves.page !== null && line.page === null) {
    return 'box';
  }
  if (halves.editor !== null && line.editor === null) {
    return 'page';
  }
  return line.bind.where;
}

// `layer` without `line`'s bind: a user bind leaves `binds` with every user
// bind sharing a half with it under the layer's leader, else the schema's
// default; a default gets a `keys` unbind entry for the halves that are its
// own in the merged default layers.
export function withRemovedBind(
  layer: UserKeymap | null,
  line: BindLine,
  schema: UserConfigSchema,
): UserKeymap {
  if (line.origin === 'user') {
    const leader = keymapLeader(schema, layer);
    return tidied({
      ...layer,
      binds: (layer?.binds ?? []).filter(
        (user) => !sharesAHalf(user, line.bind, leader),
      ),
    });
  }
  const { keys, scope, mode } = line.bind;
  const where = unbindWhere(line, keymapLeader(schema, layer));
  const entry: KeymapUnbind = {
    keys,
    scope,
    ...(where !== undefined && { where }),
    ...(mode !== undefined && { mode }),
  };
  return tidied({ ...layer, unbind: [...(layer?.unbind ?? []), entry] });
}

// Whether the bind or `keys` unbind entry `entry` shares a half of default
// `line` the merged default layers keep.
function sharesAKeptHalf(
  entry: KeyBind | KeymapUnbind,
  line: DefaultBindLine,
  leader: string,
): boolean {
  const shared = sharedHalves(entry, line.bind, leader);
  return (
    (shared.page && line.page !== null) ||
    (shared.editor && line.editor !== null)
  );
}

// `layer` with `command`'s default binds firing again: without each user bind
// naming `command`, each other user bind sharing a half the merged default layers
// keep of one of `command`'s default binds, and each `keys` unbind entry removing
// such a half. With `arg` given, only the binds holding that argument count as
// `command`'s.
export function withCommandReset(
  layer: UserKeymap | null,
  command: CommandId,
  schema: UserConfigSchema,
  arg?: CommandArg,
): UserKeymap {
  const isReset = (bind: KeyBind) =>
    bind.command === command &&
    (arg === undefined || isSameJson(bind.arg, arg));
  const leader = keymapLeader(schema, layer);
  const defaults = defaultBindLines(
    schema.defaultBindLayers,
    layer ?? {},
    leader,
  ).filter((line) => isReset(line.bind));
  const isOnDefault = (entry: KeyBind | KeymapUnbind) =>
    defaults.some((line) => sharesAKeptHalf(entry, line, leader));
  return tidied({
    ...layer,
    binds: (layer?.binds ?? []).filter(
      (bind) => !isReset(bind) && !isOnDefault(bind),
    ),
    unbind: (layer?.unbind ?? []).filter((entry) => !isOnDefault(entry)),
  });
}

// `layer` with `line`'s bind moved to `to`: a user bind's first entry equal
// to it is dropped, a default gets the `keys` unbind entry `withRemovedBind`
// writes, then `to` is added as `withAddedBind` adds it.
export function withMovedBind(
  layer: UserKeymap | null,
  line: BindLine,
  to: KeyBind,
  schema: UserConfigSchema,
): UserKeymap {
  return withAddedBind(withoutLine(layer, line, schema), to, schema);
}

function withoutLine(
  layer: UserKeymap | null,
  line: BindLine,
  schema: UserConfigSchema,
): UserKeymap {
  if (line.origin === 'default') {
    return withRemovedBind(layer, line, schema);
  }
  const binds = [...(layer?.binds ?? [])];
  const index = binds.findIndex((bind) => isSameJson(bind, line.bind));
  if (index !== -1) {
    binds.splice(index, 1);
  }
  return { ...layer, binds };
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

// `layer` with the `groups` name of `prefix` set to `name`, or removed for
// null; an entry spelling the same keys another way is replaced. An emptied
// `groups` drops.
export function withGroupName(
  layer: UserKeymap | null,
  prefix: string,
  name: string | null,
): UserKeymap {
  const normal = normalVimKeys(prefix);
  const groups = Object.fromEntries(
    Object.entries(layer?.groups ?? {}).filter(
      ([keys]) => normalVimKeys(keys) !== normal,
    ),
  );
  if (name !== null) {
    groups[prefix] = name;
  }
  return tidied({ ...layer, groups });
}

// The advanced box's text: the layer's remaps, app, intercept and global binds
// and its accelerator unbind entries, as 2-space JSON.
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
  if (key === 'groups') {
    return '"groups" belongs in the Leader menu';
  }
  const isAdvanced = (ADVANCED_SECTIONS as readonly string[]).includes(key);
  return isAdvanced ? null : `"${key}" is not a keymap section`;
}

// `layer` with the advanced box's sections replaced by those `text` holds,
// keeping `binds`, `leader`, `groups` and the `keys` unbind entries in their
// places; a problem when the text is not a JSON object of advanced sections.
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
  result.unbind = withBoxUnbinds(layer?.unbind ?? [], unbind);
  return { type: 'layer', layer: tidied(result as UserKeymap) };
}

// `unbind` with its accelerator entries replaced by `boxEntries`: each box
// entry takes the place of the next accelerator entry in order, the `keys`
// entries keep theirs, and box entries past the last place go at the end.
function withBoxUnbinds(
  unbind: KeymapUnbind[],
  boxEntries: unknown[],
): unknown[] {
  const pending = [...boxEntries];
  const merged: unknown[] = [];
  for (const entry of unbind) {
    if (isKeysUnbind(entry)) {
      merged.push(entry);
    } else if (pending.length > 0) {
      merged.push(pending.shift());
    }
  }
  return [...merged, ...pending];
}
