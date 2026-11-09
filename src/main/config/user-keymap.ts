import type { CommandArg, CommandId } from '../../contracts/commands';
import { UNBOUND_INSERT_KEYS } from '../../contracts/editor';
import type {
  AcceleratorBind,
  BindWhere,
  EditorMode,
  EditorRemap,
  InterceptBind,
  KeyBind,
  KeyGroups,
  KeymapUnbind,
  UserKeymap,
} from '../../contracts/keymap';
import type {
  CommandInfo,
  ProcessName,
  ScopeInfo,
} from '../../contracts/plugin';
import {
  acceleratorProblem,
  canonicalAccelerator,
} from '../../shared/accelerator';
import { checkCommandArg } from '../../shared/command-args';
import { errorText } from '../../shared/error-text';
import { vimTokens } from '../../shared/key-hints';
import {
  isChordKeys,
  pageKeysFor,
  vimTokenForPageKey,
} from '../../shared/key-notation';
import { expandBind } from '../../shared/plugin-manifests';
import { jsonKind, parseJsonObject } from './config-json';

// The commands and scopes a user bind may name, by qualified id, the ids of
// the loaded plugins, and the default keymap's leader, which a bind's checks
// expand it with when the file sets none.
export interface KeymapNames {
  commands: Record<CommandId, CommandInfo>;
  scopes: readonly ScopeInfo[];
  plugins: readonly string[];
  defaultLeader: string;
}

const SECTIONS = [
  'leader',
  'groups',
  'binds',
  'remaps',
  'app',
  'intercept',
  'global',
  'unbind',
];
// Sections of the keymap format before binds were written once in vim
// notation, and the fields an old unbind entry named its keys by; a file
// holding one is refused rather than read half.
const OLD_SECTIONS = ['page', 'editor'];
const UNBIND_KINDS = ['keys', 'app', 'global', 'intercept'] as const;
const EDITOR_MODES: readonly EditorMode[] = ['normal', 'insert'];
const BIND_WHERES: readonly BindWhere[] = ['page', 'box', 'both'];
const LEADER_PROBLEM =
  '"leader" must be one key that is not a chord or Tab, such as "<Space>" or ",".';
const MODIFIERS = ['control', 'alt', 'shift', 'meta'] as const;

// The fields one kind of entry holds, and the noun a problem names it by.
interface EntryShape {
  noun: string;
  required: readonly string[];
  optional: readonly string[];
}

const BIND: EntryShape = {
  noun: 'a bind',
  required: ['keys', 'scope', 'command'],
  optional: ['where', 'mode', 'arg'],
};
const EDITOR_REMAP: EntryShape = {
  noun: 'an editor remap',
  required: ['mode', 'keys', 'to'],
  optional: [],
};
const INTERCEPT_CHORD = {
  required: ['key'],
  optional: MODIFIERS,
};
const INTERCEPT_BIND: EntryShape = {
  noun: 'an intercept bind',
  required: [...INTERCEPT_CHORD.required, 'command'],
  optional: [...INTERCEPT_CHORD.optional, 'arg'],
};

function acceleratorShape(noun: string): EntryShape {
  return { noun, required: ['accelerator', 'command'], optional: ['arg'] };
}

function unbindShape(kind: (typeof UNBIND_KINDS)[number]): EntryShape {
  const noun = 'an unbind entry';
  switch (kind) {
    case 'keys':
      return { noun, required: ['keys', 'scope'], optional: ['where', 'mode'] };
    case 'intercept':
      return { noun, required: ['intercept'], optional: [] };
    default:
      return { noun, required: [kind], optional: [] };
  }
}

function requireObject(path: string, value: unknown): Record<string, unknown> {
  const kind = jsonKind(value);
  if (kind !== 'an object') {
    throw new Error(`"${path}" must be an object, not ${kind}.`);
  }
  return value as Record<string, unknown>;
}

function requireArray(path: string, value: unknown): unknown[] {
  const kind = jsonKind(value);
  if (kind !== 'an array') {
    throw new Error(`"${path}" must be an array, not ${kind}.`);
  }
  return value as unknown[];
}

function requireString(path: string, value: unknown): string {
  const kind = jsonKind(value);
  if (kind !== 'a string') {
    throw new Error(`"${path}" must be a string, not ${kind}.`);
  }
  return value as string;
}

function requireKeysString(path: string, value: unknown): string {
  const keys = requireString(path, value);
  if (keys === '') {
    throw new Error(`"${path}" is empty.`);
  }
  return keys;
}

function requireAccelerator(path: string, value: unknown): string {
  const accelerator = requireKeysString(path, value);
  const problem = acceleratorProblem(accelerator);
  if (problem !== null) {
    throw new Error(`"${path}" is not an accelerator: ${problem}.`);
  }
  return accelerator;
}

function requireWhere(path: string, value: unknown): BindWhere {
  const isWhere = BIND_WHERES.some((where) => where === value);
  if (!isWhere) {
    throw new Error(
      `"${path}" must be one of ${BIND_WHERES.join(', ')}, not ${JSON.stringify(value)}.`,
    );
  }
  return value as BindWhere;
}

function requireMode(path: string, value: unknown): EditorMode {
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
function requireFields(
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

function commandInfoOf(id: CommandId, names: KeymapNames) {
  return Object.hasOwn(names.commands, id) ? names.commands[id] : undefined;
}

function isKnownScope(scope: string, names: KeymapNames): boolean {
  return names.scopes.some((info) => info.id === scope);
}

function idPrefix(id: string): string {
  return id.split('.')[0];
}

// The plugin the command or scope `id` names, the text before its first `.`,
// when that plugin is not loaded: the prefix is not `core`, no loaded plugin's
// id, and no known command's or scope's. Null when the prefix is known.
function absentPlugin(id: string, names: KeymapNames): string | null {
  const prefix = idPrefix(id);
  const isKnown =
    prefix === 'core' ||
    names.plugins.includes(prefix) ||
    Object.keys(names.commands).some((known) => idPrefix(known) === prefix) ||
    names.scopes.some((info) => idPrefix(info.id) === prefix);
  return isKnown ? null : prefix;
}

// The line for the entry at `path`, kept in the file and left out of the
// keymap because it names `plugin`, which is not loaded.
function ignoredLine(path: string, plugin: string): string {
  return `keymap.json ${path} names plugin "${plugin}", which is not loaded; kept and ignored`;
}

// What is wrong with a known command as the bind at `entryPath`'s: it runs in the
// other process, or the bind's `arg` does not fit it.
function knownCommandProblem(
  entryPath: string,
  info: CommandInfo,
  arg: unknown,
  runsIn: ProcessName,
  noun: string,
): string | null {
  if (info.runsIn !== runsIn) {
    const where = info.runsIn === 'page' ? 'the page' : 'main';
    return `"${entryPath}.command" names "${info.id}", which runs in ${where}; ${noun} needs a ${runsIn} command.`;
  }
  const problem = checkCommandArg(info.id, info.arg, arg);
  return problem === null ? null : `"${entryPath}.arg": ${problem}.`;
}

// The bind at `entryPath`'s command id. An id `names` does not hold stays: a part may
// register it later, and `heldBackUserBinds` judges it then. Throws on a known
// command the bind cannot name.
function requireCommand(
  entryPath: string,
  value: unknown,
  arg: unknown,
  runsIn: ProcessName,
  noun: string,
  names: KeymapNames,
): CommandId {
  const id = requireString(`${entryPath}.command`, value);
  const info = commandInfoOf(id, names);
  const problem =
    info === undefined
      ? null
      : knownCommandProblem(entryPath, info, arg, runsIn, noun);
  if (problem !== null) {
    throw new Error(problem);
  }
  return id;
}

// `arg` of the entry, when it sets one. Its shape is the command's to judge.
function readArg(entry: Record<string, unknown>): { arg?: CommandArg } {
  return Object.hasOwn(entry, 'arg') ? { arg: entry.arg as CommandArg } : {};
}

// The scope at `path`. A scope of a plugin that is not loaded stays, for
// `heldBackUserBinds` to leave out.
function requireScope(
  path: string,
  value: unknown,
  names: KeymapNames,
): string {
  const scope = requireString(path, value);
  const isOfAbsentPlugin = absentPlugin(scope, names) !== null;
  if (!isKnownScope(scope, names) && !isOfAbsentPlugin) {
    throw new Error(`"${path}" names no scope "${scope}".`);
  }
  return scope;
}

// Throws unless an insert bind's `keys` are one the editor types itself when
// the bind does not run.
function requireUnboundInsertKey(path: string, keys: string): void {
  if (!UNBOUND_INSERT_KEYS.some((key) => key === keys)) {
    throw new Error(
      `"${path}" is ${JSON.stringify(keys)}; an insert bind takes ${UNBOUND_INSERT_KEYS.join(', ')}.`,
    );
  }
}

function readModifiers(
  path: string,
  entry: Record<string, unknown>,
): Omit<InterceptBind, 'key' | 'command'> {
  const modifiers: Omit<InterceptBind, 'key' | 'command'> = {};
  for (const modifier of MODIFIERS) {
    if (Object.hasOwn(entry, modifier)) {
      const value = entry[modifier];
      const kind = jsonKind(value);
      if (kind !== 'a boolean') {
        throw new Error(
          `"${path}.${modifier}" must be a boolean, not ${kind}.`,
        );
      }
      modifiers[modifier] = value as boolean;
    }
  }
  return modifiers;
}

// `where` and `mode` of the entry at `path`, each when it sets one.
function readWhereAndMode(
  path: string,
  entry: Record<string, unknown>,
): Pick<KeyBind, 'where' | 'mode'> {
  const read: Pick<KeyBind, 'where' | 'mode'> = {};
  if (Object.hasOwn(entry, 'where')) {
    read.where = requireWhere(`${path}.where`, entry.where);
  }
  if (Object.hasOwn(entry, 'mode')) {
    read.mode = requireMode(`${path}.mode`, entry.mode);
  }
  return read;
}

// Throws, naming `path`, on keys or a `where` the merge could not expand
// `bind` with.
function requireExpandable(path: string, bind: KeyBind, leader: string): void {
  try {
    expandBind(bind, leader);
  } catch (error) {
    throw new Error(`"${path}": ${errorText(error)}`, { cause: error });
  }
}

function readBind(
  path: string,
  value: unknown,
  leader: string,
  names: KeymapNames,
): KeyBind {
  const entry = requireFields(path, value, BIND);
  const bind: KeyBind = {
    keys: requireKeysString(`${path}.keys`, entry.keys),
    scope: requireScope(`${path}.scope`, entry.scope, names),
    command: requireCommand(
      path,
      entry.command,
      entry.arg,
      'page',
      BIND.noun,
      names,
    ),
    ...readWhereAndMode(path, entry),
    ...readArg(entry),
  };
  requireExpandable(path, bind, leader);
  if (bind.mode === 'insert') {
    requireUnboundInsertKey(`${path}.keys`, bind.keys);
  }
  return bind;
}

function readRemap(path: string, value: unknown): EditorRemap {
  const entry = requireFields(path, value, EDITOR_REMAP);
  return {
    mode: requireMode(`${path}.mode`, entry.mode),
    keys: requireKeysString(`${path}.keys`, entry.keys),
    to: requireString(`${path}.to`, entry.to),
  };
}

function readAcceleratorBind(
  path: string,
  value: unknown,
  shape: EntryShape,
  names: KeymapNames,
): AcceleratorBind {
  const entry = requireFields(path, value, shape);
  return {
    accelerator: requireAccelerator(`${path}.accelerator`, entry.accelerator),
    command: requireCommand(
      path,
      entry.command,
      entry.arg,
      'main',
      shape.noun,
      names,
    ),
    ...readArg(entry),
  };
}

function readInterceptBind(
  path: string,
  value: unknown,
  names: KeymapNames,
): InterceptBind {
  const entry = requireFields(path, value, INTERCEPT_BIND);
  return {
    key: requireKeysString(`${path}.key`, entry.key),
    ...readModifiers(path, entry),
    command: requireCommand(
      path,
      entry.command,
      entry.arg,
      'main',
      INTERCEPT_BIND.noun,
      names,
    ),
    ...readArg(entry),
  };
}

function readUnbind(
  path: string,
  value: unknown,
  leader: string,
  names: KeymapNames,
): KeymapUnbind {
  const entry = requireObject(path, value);
  if (OLD_SECTIONS.some((section) => Object.hasOwn(entry, section))) {
    throw new Error(
      `"${path}" is an old unbind: name its keys in vim notation under "keys".`,
    );
  }
  const named = UNBIND_KINDS.filter((kind) => Object.hasOwn(entry, kind));
  if (named.length !== 1) {
    throw new Error(`"${path}" must name one of ${UNBIND_KINDS.join(', ')}.`);
  }
  const kind = named[0];
  requireFields(path, entry, unbindShape(kind));
  switch (kind) {
    case 'keys': {
      const unbind = {
        keys: requireKeysString(`${path}.keys`, entry.keys),
        scope: requireScope(`${path}.scope`, entry.scope, names),
        ...readWhereAndMode(path, entry),
      };
      requireExpandable(path, { ...unbind, command: '' }, leader);
      return unbind;
    }
    case 'intercept': {
      const chordPath = `${path}.intercept`;
      const chord = requireFields(chordPath, entry.intercept, {
        noun: 'an intercept chord',
        ...INTERCEPT_CHORD,
      });
      return {
        intercept: {
          key: requireKeysString(`${chordPath}.key`, chord.key),
          ...readModifiers(chordPath, chord),
        },
      };
    }
    case 'app':
      return { app: requireAccelerator(`${path}.app`, entry.app) };
    case 'global':
      return { global: requireAccelerator(`${path}.global`, entry.global) };
  }
}

// Throws on two binds in `section` on one accelerator, however each spells it.
function requireDistinctAccelerators(
  section: string,
  binds: readonly AcceleratorBind[],
): void {
  const chords = binds.map((bind) => canonicalAccelerator(bind.accelerator));
  binds.forEach((bind, index) => {
    const first = chords.indexOf(chords[index]);
    if (first < index) {
      throw new Error(
        `"${section}[${index}]" binds ${bind.accelerator}, the same chord as "${section}[${first}]" (${binds[first].accelerator}).`,
      );
    }
  });
}

function sameChord(a: InterceptBind, b: InterceptBind): boolean {
  return (
    a.key === b.key &&
    MODIFIERS.every((modifier) => Boolean(a[modifier]) === Boolean(b[modifier]))
  );
}

// Throws on two intercept binds on one chord.
function requireDistinctIntercepts(binds: readonly InterceptBind[]): void {
  binds.forEach((bind, index) => {
    const first = binds.findIndex((other) => sameChord(other, bind));
    if (first < index) {
      throw new Error(
        `"intercept[${index}]" binds the same chord as "intercept[${first}]".`,
      );
    }
  });
}

function readList<T>(
  path: string,
  value: unknown,
  read: (entryPath: string, entry: unknown) => T,
): T[] {
  return requireArray(path, value).map((entry, index) =>
    read(`${path}[${index}]`, entry),
  );
}

// The file's `leader`: one key the page can bind that is not a chord, Tab
// included, and not
// `<`, since a `<` leader would make `<Leader>a>` read as the named key `<a>`.
// A key that types one visible character comes back as that character,
// however it is written (`<Bslash>` is `\`); any other key comes back spelled
// as vim reports it (`<space>` is `<Space>`).
function readLeader(value: unknown): string {
  const leader = requireKeysString('leader', value);
  let pageKeys: string[] = [];
  let isPageKey = true;
  try {
    pageKeys = pageKeysFor(leader, leader);
  } catch {
    isPageKey = false;
  }
  const isOneKey = vimTokens(leader, leader).length === 1;
  const isChord = isChordKeys(leader, leader);
  const pageKey = pageKeys[0];
  const isLessThan = pageKey === '<';
  if (!isPageKey || !isOneKey || isChord || isLessThan) {
    throw new Error(LEADER_PROBLEM);
  }
  const isVisibleCharacter = /^\S$/u.test(pageKey);
  return isVisibleCharacter ? pageKey : vimTokenForPageKey(pageKey);
}

// The file's `groups`: each key a leader prefix, each name non-empty.
function readGroups(value: unknown): KeyGroups {
  const groups = requireObject('groups', value);
  for (const [keys, name] of Object.entries(groups)) {
    const path = `groups.${keys}`;
    if (!keys.startsWith('<Leader>')) {
      throw new Error(`"${path}" must start with <Leader>.`);
    }
    requireKeysString(path, name);
  }
  return groups as KeyGroups;
}

// The user keymap `text`, a `keymap.json`, holds, its leader spelled as
// `readLeader` gives it, each bind naming a scope of `names` or of a plugin
// that is not loaded, and either a command of `names` that runs in the bind's
// process and fits the bind's `arg`, or an id `names` does not hold, for
// `heldBackUserBinds` to judge; each unbind's scope one a bind may name; each
// bind's and unbind's keys and `where` ones the merge expands, each insert bind
// a key of `UNBOUND_INSERT_KEYS`, and each accelerator one Electron accepts.
// Throws an Error whose message is the first problem found, as the user reads
// it.
export function parseUserKeymap(text: string, names: KeymapNames): UserKeymap {
  const file = parseJsonObject(text);
  for (const key of Object.keys(file)) {
    if (OLD_SECTIONS.includes(key)) {
      throw new Error(
        `"${key}" is an old keymap section: write its binds under "binds" in vim notation.`,
      );
    }
  }
  for (const key of Object.keys(file)) {
    if (!SECTIONS.includes(key)) {
      throw new Error(`"${key}" is not a keymap section.`);
    }
  }
  const keymap: UserKeymap = {};
  if (Object.hasOwn(file, 'leader')) {
    keymap.leader = readLeader(file.leader);
  }
  const leader = keymap.leader ?? names.defaultLeader;
  if (Object.hasOwn(file, 'groups')) {
    keymap.groups = readGroups(file.groups);
  }
  if (Object.hasOwn(file, 'binds')) {
    keymap.binds = readList('binds', file.binds, (path, entry) =>
      readBind(path, entry, leader, names),
    );
  }
  if (Object.hasOwn(file, 'remaps')) {
    keymap.remaps = readList('remaps', file.remaps, readRemap);
  }
  if (Object.hasOwn(file, 'app')) {
    keymap.app = readList('app', file.app, (path, entry) =>
      readAcceleratorBind(path, entry, acceleratorShape('an app bind'), names),
    );
    requireDistinctAccelerators('app', keymap.app);
  }
  if (Object.hasOwn(file, 'intercept')) {
    keymap.intercept = readList('intercept', file.intercept, (path, entry) =>
      readInterceptBind(path, entry, names),
    );
    requireDistinctIntercepts(keymap.intercept);
  }
  if (Object.hasOwn(file, 'global')) {
    keymap.global = readList('global', file.global, (path, entry) =>
      readAcceleratorBind(
        path,
        entry,
        acceleratorShape('a global bind'),
        names,
      ),
    );
    requireDistinctAccelerators('global', keymap.global);
  }
  if (Object.hasOwn(file, 'unbind')) {
    keymap.unbind = readList('unbind', file.unbind, (path, entry) =>
      readUnbind(path, entry, leader, names),
    );
  }
  return keymap;
}

// `user` without each bind or unbind that names a plugin that is not loaded,
// in its command or scope, and without each bind whose command `fixedCommands`
// does not hold and `names` cannot run: an unknown id, the wrong process or a bad
// `arg`. The first give one `ignored` line each, and the file keeps them for when
// the plugin loads. The others give one problem each, with the text the parse
// would give and the bind's path in `user`. A part can register the command
// later, so the caller decides when these are reported.
export function heldBackUserBinds(
  user: UserKeymap,
  names: KeymapNames,
  fixedCommands: KeymapNames['commands'],
): { kept: UserKeymap; problems: string[]; ignored: string[] } {
  const problems: string[] = [];
  const ignored: string[] = [];
  // The absent plugin the first unknown name of `bind` belongs to, if any.
  const absentPluginOf = (bind: { command?: CommandId; scope?: string }) => {
    const unknownNames = [
      ...(bind.command !== undefined &&
      commandInfoOf(bind.command, names) === undefined
        ? [bind.command]
        : []),
      ...(bind.scope !== undefined && !isKnownScope(bind.scope, names)
        ? [bind.scope]
        : []),
    ];
    return (
      unknownNames
        .map((name) => absentPlugin(name, names))
        .find((plugin) => plugin !== null) ?? null
    );
  };
  const keptOf = <
    B extends { command: CommandId; arg?: CommandArg; scope?: string },
  >(
    section: 'binds' | 'app' | 'intercept' | 'global',
    binds: readonly B[],
    runsIn: ProcessName,
    noun: string,
  ): B[] =>
    binds.filter((bind, index) => {
      const path = `${section}[${index}]`;
      const absent = absentPluginOf(bind);
      if (absent !== null) {
        ignored.push(ignoredLine(path, absent));
        return false;
      }
      if (Object.hasOwn(fixedCommands, bind.command)) {
        return true;
      }
      const info = commandInfoOf(bind.command, names);
      const problem =
        info === undefined
          ? `"${path}.command" names no command "${bind.command}".`
          : knownCommandProblem(path, info, bind.arg, runsIn, noun);
      if (problem !== null) {
        problems.push(problem);
      }
      return problem === null;
    });
  const kept: UserKeymap = { ...user };
  if (user.binds !== undefined) {
    kept.binds = keptOf('binds', user.binds, 'page', BIND.noun);
  }
  if (user.app !== undefined) {
    kept.app = keptOf('app', user.app, 'main', 'an app bind');
  }
  if (user.intercept !== undefined) {
    kept.intercept = keptOf(
      'intercept',
      user.intercept,
      'main',
      INTERCEPT_BIND.noun,
    );
  }
  if (user.global !== undefined) {
    kept.global = keptOf('global', user.global, 'main', 'a global bind');
  }
  if (user.unbind !== undefined) {
    kept.unbind = user.unbind.filter((unbind, index) => {
      const absent = 'scope' in unbind ? absentPluginOf(unbind) : null;
      if (absent !== null) {
        ignored.push(ignoredLine(`unbind[${index}]`, absent));
      }
      return absent === null;
    });
  }
  return { kept, problems, ignored };
}
