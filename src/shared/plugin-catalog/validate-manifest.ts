import type { CommandArgShape } from '../../contracts/commands';
import type {
  CommandDecl,
  PluginManifest,
  ProcessName,
  SettingKind,
} from '../../contracts/plugin';
import type { TokenKind } from '../../contracts/theme';
import { pluginIdProblem } from '../define-plugin';
import { errorText } from '../error-text';
import { isJsonObject, isStringArray, type JsonObject } from '../json';
import {
  BIND_WHERES,
  EDITOR_MODES,
  pluginOptionalSettings,
  pluginSettingInfo,
  pluginThemeTokens,
  requireDeclaredScope,
} from '../plugin-manifests';

// A manifest that passed every check, or every problem found in it.
export type ManifestCheck =
  | { readonly ok: true; readonly manifest: PluginManifest }
  | { readonly ok: false; readonly problems: readonly string[] };

// The shape of a command or scope short id; the scope name `any` is refused.
export const SHORT_ID_PATTERN = '^[A-Za-z][A-Za-z0-9]*$';
const SHORT_ID = new RegExp(SHORT_ID_PATTERN);

// The scope a bind names to act in every scope.
const ANY_SCOPE = 'any';

// The keys of `members`, which names each member of a union once.
function membersOf<K extends string>(members: Record<K, true>): readonly K[] {
  return Object.keys(members) as K[];
}

export const TOKEN_KINDS = membersOf({
  color: true,
  length: true,
  duration: true,
  number: true,
  shadow: true,
  filter: true,
  raw: true,
} satisfies Record<TokenKind, true>);

export const PROCESS_NAMES = membersOf({
  main: true,
  page: true,
} satisfies Record<ProcessName, true>);

export const SETTING_KINDS = membersOf({
  string: true,
  number: true,
  boolean: true,
} satisfies Record<SettingKind, true>);

// The kinds a command's `arg` takes, alone or as each field of an object.
export const ARG_KINDS = membersOf({
  number: true,
  string: true,
} satisfies Record<Extract<CommandArgShape, string>, true>);

const MANIFEST_FIELDS = membersOf({
  id: true,
  label: true,
  description: true,
  dependsOn: true,
  reads: true,
  commands: true,
  scopes: true,
  keys: true,
  settings: true,
  optionalSettings: true,
  settingInfo: true,
  themeTokens: true,
  readsEverySlot: true,
} satisfies Record<keyof PluginManifest, true>);

const SCHEMA_FIELD = '$schema';
const COMMAND_FIELDS = membersOf({
  label: true,
  group: true,
  runsIn: true,
  arg: true,
  risky: true,
  targets: true,
} satisfies Record<keyof CommandDecl, true>);
// The command fields that hold only `true` when set.
const COMMAND_FLAGS = ['risky', 'targets'];
const KEYS_FIELDS = ['binds', 'groups', 'app', 'global', 'intercept'];
const SETTING_INFO_FIELDS = ['label', 'description'];
const TOKEN_FIELDS = ['kind', 'default'];
const MODIFIER_FIELDS = ['control', 'alt', 'shift', 'meta'];

// A key list of `keys`: its name, the process its commands run in, the fields
// an item takes, and which of them must be strings.
interface KeyList {
  name: 'binds' | 'app' | 'global' | 'intercept';
  process: ProcessName;
  fields: readonly string[];
  stringFields: readonly string[];
}

const KEY_LISTS: readonly KeyList[] = [
  {
    name: 'binds',
    process: 'page',
    fields: ['keys', 'scope', 'command', 'where', 'mode', 'arg'],
    stringFields: ['keys', 'scope', 'command'],
  },
  {
    name: 'app',
    process: 'main',
    fields: ['accelerator', 'command', 'arg'],
    stringFields: ['accelerator', 'command'],
  },
  {
    name: 'global',
    process: 'main',
    fields: ['accelerator', 'command', 'arg'],
    stringFields: ['accelerator', 'command'],
  },
  {
    name: 'intercept',
    process: 'main',
    fields: ['key', 'command', ...MODIFIER_FIELDS, 'arg'],
    stringFields: ['key', 'command'],
  },
];

// Checks a plugin's `manifest.json` value at load: the shape `definePlugin`'s
// types check at compile time, then, on a sound shape, the one-manifest checks
// of `plugin-manifests.ts`. Never throws; returns every problem found, or the
// manifest with only its `PluginManifest` fields, `$schema` dropped.
export function validateManifest(raw: unknown): ManifestCheck {
  if (!isJsonObject(raw)) {
    return { ok: false, problems: ['manifest must be a JSON object'] };
  }
  const problems = shapeProblems(raw);
  if (problems.length > 0) {
    return { ok: false, problems };
  }
  const manifest = manifestFields(raw);
  const crossFieldProblems = declarationProblems(manifest);
  if (crossFieldProblems.length > 0) {
    return { ok: false, problems: crossFieldProblems };
  }
  return { ok: true, manifest };
}

// The problems with `manifest`'s handlers in `process`, a start's returned
// `commands`: `missing <short>` for each command declared to run there with no
// function under its short id, in declaration order, then `undeclared <short>`
// for each key naming no command declared to run there, in key order.
export function handlerProblems(
  manifest: PluginManifest,
  process: ProcessName,
  commands: object,
): string[] {
  const declared = Object.keys(manifest.commands).filter(
    (short) => manifest.commands[short].runsIn === process,
  );
  const handlers: Record<string, unknown> = { ...commands };
  const missing = declared.filter(
    (short) =>
      !Object.hasOwn(handlers, short) || typeof handlers[short] !== 'function',
  );
  const undeclared = Object.keys(handlers).filter(
    (short) => !declared.includes(short),
  );
  return [
    ...missing.map((short) => `missing ${short}`),
    ...undeclared.map((short) => `undeclared ${short}`),
  ];
}

// Pass 1: every problem with the shape of each field of `raw`.
function shapeProblems(raw: JsonObject): string[] {
  const problems: string[] = [];
  for (const key of unknownFields(raw, [...MANIFEST_FIELDS, SCHEMA_FIELD])) {
    problems.push(`unknown field "${key}"`);
  }
  if (
    raw[SCHEMA_FIELD] !== undefined &&
    typeof raw[SCHEMA_FIELD] !== 'string'
  ) {
    problems.push('$schema must be a string');
  }
  const id = typeof raw.id === 'string' ? raw.id : null;
  if (id === null) {
    problems.push('id must be a string');
  } else {
    const idProblem = pluginIdProblem(id);
    if (idProblem !== null) {
      problems.push(idProblem);
    }
  }
  for (const field of ['label', 'description']) {
    if (typeof raw[field] !== 'string') {
      problems.push(`${field} must be a string`);
    }
  }
  for (const field of ['dependsOn', 'reads']) {
    addPluginListsProblems(field, raw[field], id, problems);
  }
  addCommandsProblems(raw.commands, problems);
  addScopesProblems(raw.scopes, problems);
  addKeysProblems(raw.keys, raw.commands, problems);
  addSettingsProblems(raw.settings, problems);
  addOptionalSettingsProblems(raw.optionalSettings, problems);
  addSettingInfoProblems(raw.settingInfo, problems);
  addThemeTokensProblems(raw.themeTokens, problems);
  if (raw.readsEverySlot !== undefined && raw.readsEverySlot !== true) {
    problems.push('readsEverySlot must be true');
  }
  return problems;
}

// The keys of `object` outside `allowed`, in key order.
function unknownFields(object: JsonObject, allowed: readonly string[]) {
  return Object.keys(object).filter((key) => !allowed.includes(key));
}

// Checks a `dependsOn` or `reads` value: `main` and `page` lists of plugin ids,
// neither naming the plugin itself.
function addPluginListsProblems(
  field: string,
  value: unknown,
  id: string | null,
  problems: string[],
) {
  if (!isJsonObject(value)) {
    problems.push(`${field} must be an object with main and page`);
    return;
  }
  for (const key of unknownFields(value, PROCESS_NAMES)) {
    problems.push(`${field} has unknown field "${key}"`);
  }
  for (const process of PROCESS_NAMES) {
    const ids = value[process];
    if (!isStringArray(ids)) {
      problems.push(`${field}.${process} must be an array of strings`);
    } else if (id !== null && ids.includes(id)) {
      problems.push(`${field}.${process} names the plugin itself`);
    }
  }
}

function addCommandsProblems(commands: unknown, problems: string[]) {
  if (!isJsonObject(commands)) {
    problems.push('commands must be an object');
    return;
  }
  for (const [short, decl] of Object.entries(commands)) {
    const name = `command "${short}"`;
    if (!SHORT_ID.test(short)) {
      problems.push(`${name} id must be a letter, then letters and digits`);
    }
    if (!isJsonObject(decl)) {
      problems.push(`${name} must be an object`);
      continue;
    }
    for (const field of ['label', 'group']) {
      if (typeof decl[field] !== 'string') {
        problems.push(`${name} ${field} must be a string`);
      }
    }
    if (!isOneOf(decl.runsIn, PROCESS_NAMES)) {
      problems.push(`${name} runsIn must be "main" or "page"`);
    }
    for (const key of unknownFields(decl, COMMAND_FIELDS)) {
      problems.push(`${name} has unknown field "${key}"`);
    }
    if (decl.arg !== undefined && !isArgShape(decl.arg)) {
      problems.push(
        `${name} arg must be "number", "string" or an object of those`,
      );
    }
    for (const flag of COMMAND_FLAGS) {
      if (decl[flag] !== undefined && decl[flag] !== true) {
        problems.push(`${name} ${flag} must be true`);
      }
    }
  }
}

// Whether `value` is one of `members`.
function isOneOf<T extends string>(
  value: unknown,
  members: readonly T[],
): value is T {
  return members.some((member) => member === value);
}

// Whether `shape` is a `CommandArgShape`: a kind, or an object of kinds.
function isArgShape(shape: unknown): boolean {
  return (
    isOneOf(shape, ARG_KINDS) ||
    (isJsonObject(shape) &&
      Object.values(shape).every((kind) => isOneOf(kind, ARG_KINDS)))
  );
}

// Whether `arg` is a `CommandArg`: a number, a string, or an object of those.
function isArgValue(arg: unknown): boolean {
  const isScalar = (value: unknown) =>
    typeof value === 'number' || typeof value === 'string';
  return (
    isScalar(arg) || (isJsonObject(arg) && Object.values(arg).every(isScalar))
  );
}

function addScopesProblems(scopes: unknown, problems: string[]) {
  if (!isJsonObject(scopes)) {
    problems.push('scopes must be an object');
    return;
  }
  for (const [short, title] of Object.entries(scopes)) {
    if (!SHORT_ID.test(short)) {
      problems.push(
        `scope "${short}" id must be a letter, then letters and digits`,
      );
    } else if (short === ANY_SCOPE) {
      problems.push(
        `scope "${ANY_SCOPE}" is reserved for binds that act in every scope`,
      );
    }
    if (typeof title !== 'string') {
      problems.push(`scope "${short}" title must be a string`);
    }
  }
}

function addKeysProblems(keys: unknown, commands: unknown, problems: string[]) {
  if (keys === undefined) {
    return;
  }
  if (!isJsonObject(keys)) {
    problems.push('keys must be an object');
    return;
  }
  for (const key of unknownFields(keys, KEYS_FIELDS)) {
    problems.push(`keys has unknown field "${key}"`);
  }
  if (keys.groups !== undefined) {
    if (!isJsonObject(keys.groups)) {
      problems.push('keys.groups must be an object');
    } else {
      for (const [prefix, name] of Object.entries(keys.groups)) {
        if (typeof name !== 'string') {
          problems.push(`keys.groups "${prefix}" must be a string`);
        }
      }
    }
  }
  for (const list of KEY_LISTS) {
    const items = keys[list.name];
    if (items === undefined) {
      continue;
    }
    if (!Array.isArray(items)) {
      problems.push(`keys.${list.name} must be an array`);
      continue;
    }
    items.forEach((item, index) =>
      addKeyItemProblems(
        list,
        `keys.${list.name}[${index}]`,
        item,
        commands,
        problems,
      ),
    );
  }
}

// Checks one item of a key list, named `name` in each problem.
function addKeyItemProblems(
  list: KeyList,
  name: string,
  item: unknown,
  commands: unknown,
  problems: string[],
) {
  if (!isJsonObject(item)) {
    problems.push(`${name} must be an object`);
    return;
  }
  for (const key of unknownFields(item, list.fields)) {
    problems.push(`${name} has unknown field "${key}"`);
  }
  for (const field of list.stringFields) {
    if (typeof item[field] !== 'string') {
      problems.push(`${name} ${field} must be a string`);
    }
  }
  if (list.name === 'binds') {
    if (item.where !== undefined && !isOneOf(item.where, BIND_WHERES)) {
      problems.push(`${name} where must be "page", "box" or "both"`);
    }
    if (item.mode !== undefined && !isOneOf(item.mode, EDITOR_MODES)) {
      problems.push(`${name} mode must be "normal" or "insert"`);
    }
  }
  if (list.name === 'intercept') {
    for (const field of MODIFIER_FIELDS) {
      if (item[field] !== undefined && typeof item[field] !== 'boolean') {
        problems.push(`${name} ${field} must be a boolean`);
      }
    }
  }
  if (typeof item.command === 'string') {
    const problem = boundCommandProblem(
      commands,
      item.command,
      list.process,
      name,
    );
    if (problem !== null) {
      problems.push(problem);
    }
  }
  if (item.arg !== undefined && !isArgValue(item.arg)) {
    problems.push(
      `${name} arg must be a number, a string or an object of those`,
    );
  }
}

// Why the key `name`, binding `command` in `process`, cannot run it: no
// command of that short id is declared, or it runs in the other process. Null
// when `commands` is no object, which its own problem reports.
function boundCommandProblem(
  commands: unknown,
  command: string,
  process: ProcessName,
  name: string,
): string | null {
  if (!isJsonObject(commands)) {
    return null;
  }
  if (!Object.hasOwn(commands, command)) {
    return `${name} command "${command}" is not a declared command`;
  }
  const decl = commands[command];
  const runsIn = isJsonObject(decl) ? decl.runsIn : undefined;
  const runsInOtherProcess =
    isOneOf(runsIn, PROCESS_NAMES) && runsIn !== process;
  if (!runsInOtherProcess) {
    return null;
  }
  return process === 'page'
    ? `${name} command "${command}" runs in main; bind it under keys.app, keys.global or keys.intercept`
    : `${name} command "${command}" runs in the page; bind it under keys.binds`;
}

// Checks that `settings` is an object holding only JSON values: null, a
// boolean, a finite number, a string, or an array or object of these.
function addSettingsProblems(settings: unknown, problems: string[]) {
  if (!isJsonObject(settings)) {
    problems.push('settings must be an object');
    return;
  }
  const pending: [string, unknown][] = Object.entries(settings);
  for (let index = 0; index < pending.length; index++) {
    const [path, value] = pending[index];
    const isScalar =
      value === null ||
      typeof value === 'boolean' ||
      typeof value === 'string' ||
      (typeof value === 'number' && Number.isFinite(value));
    if (isScalar) {
      continue;
    }
    if (Array.isArray(value)) {
      value.forEach((item, at) => pending.push([`${path}[${at}]`, item]));
    } else if (isJsonObject(value)) {
      for (const [key, child] of Object.entries(value)) {
        pending.push([`${path}.${key}`, child]);
      }
    } else {
      problems.push(`settings.${path} is not a JSON value`);
    }
  }
}

function addOptionalSettingsProblems(
  optionalSettings: unknown,
  problems: string[],
) {
  if (optionalSettings === undefined) {
    return;
  }
  if (!isJsonObject(optionalSettings)) {
    problems.push('optionalSettings must be an object');
    return;
  }
  for (const [path, kind] of Object.entries(optionalSettings)) {
    if (!isOneOf(kind, SETTING_KINDS)) {
      problems.push(
        `optionalSettings "${path}" must be "string", "number" or "boolean"`,
      );
    }
  }
}

function addSettingInfoProblems(settingInfo: unknown, problems: string[]) {
  if (!isJsonObject(settingInfo)) {
    problems.push('settingInfo must be an object');
    return;
  }
  for (const [path, info] of Object.entries(settingInfo)) {
    const isInfo =
      isJsonObject(info) &&
      typeof info.label === 'string' &&
      typeof info.description === 'string' &&
      unknownFields(info, SETTING_INFO_FIELDS).length === 0;
    if (!isInfo) {
      problems.push(
        `settingInfo "${path}" must have a label and a description`,
      );
    }
  }
}

function addThemeTokensProblems(themeTokens: unknown, problems: string[]) {
  if (!isJsonObject(themeTokens)) {
    problems.push('themeTokens must be an object');
    return;
  }
  for (const [key, decl] of Object.entries(themeTokens)) {
    const name = `theme token "${key}"`;
    if (!isJsonObject(decl)) {
      problems.push(`${name} must be an object`);
      continue;
    }
    if (!isOneOf(decl.kind, TOKEN_KINDS)) {
      problems.push(`${name} kind must be one of ${TOKEN_KINDS.join(', ')}`);
    }
    if (typeof decl.default !== 'string') {
      problems.push(`${name} default must be a string`);
    }
    for (const field of unknownFields(decl, TOKEN_FIELDS)) {
      problems.push(`${name} has unknown field "${field}"`);
    }
  }
}

// `raw`'s `PluginManifest` fields as a new object, once pass 1 has found its
// shape sound: `$schema` is left out, and so is a field `raw` does not hold.
function manifestFields(raw: JsonObject): PluginManifest {
  const fields = MANIFEST_FIELDS.filter((field) => raw[field] !== undefined);
  return Object.fromEntries(
    fields.map((field) => [field, raw[field]]),
  ) as unknown as PluginManifest;
}

// Pass 2: the problems the checks of `plugin-manifests.ts` throw for
// `manifest` alone, each call caught on its own.
function declarationProblems(manifest: PluginManifest): string[] {
  const checks: (() => unknown)[] = [
    ...(manifest.keys?.binds ?? [])
      .filter((bind) => bind.scope !== ANY_SCOPE)
      .map((bind) => () => requireDeclaredScope(manifest, bind.scope)),
    () => pluginOptionalSettings([manifest]),
    () => pluginSettingInfo([manifest]),
    () => pluginThemeTokens({}, [manifest]),
  ];
  const problems: string[] = [];
  for (const check of checks) {
    try {
      check();
    } catch (error) {
      problems.push(errorText(error));
    }
  }
  return problems;
}
