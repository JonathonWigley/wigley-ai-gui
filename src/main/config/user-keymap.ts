import type { CommandId } from '../../contracts/commands';
import type {
  AcceleratorBind,
  EditorBind,
  EditorMode,
  EditorRemap,
  InterceptBind,
  KeymapUnbind,
  PageBind,
  UserKeymap,
} from '../../contracts/keymap';
import type {
  CommandInfo,
  ProcessName,
  ScopeInfo,
} from '../../contracts/plugin';
import { acceleratorProblem } from '../../shared/accelerator';
import { jsonKind, parseJsonObject } from './config-json';

// The commands and scopes a user bind may name, by qualified id.
export interface KeymapNames {
  commands: Record<CommandId, CommandInfo>;
  scopes: readonly ScopeInfo[];
}

const SECTIONS = ['page', 'editor', 'app', 'intercept', 'global', 'unbind'];
const EDITOR_SECTIONS = ['leader', 'remaps', 'binds'];
const UNBIND_KINDS = ['page', 'editor', 'app', 'global', 'intercept'] as const;
const EDITOR_MODES: readonly EditorMode[] = ['normal', 'insert'];
const MODIFIERS = ['control', 'alt', 'shift', 'meta'] as const;

// The fields one kind of entry holds, and the noun a problem names it by.
interface EntryShape {
  noun: string;
  required: readonly string[];
  optional: readonly string[];
}

const PAGE_BIND: EntryShape = {
  noun: 'a page bind',
  required: ['keys', 'scope', 'command'],
  optional: [],
};
const EDITOR_BIND: EntryShape = {
  noun: 'an editor bind',
  required: ['keys', 'scope', 'command'],
  optional: ['mode'],
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
  optional: INTERCEPT_CHORD.optional,
};

function acceleratorShape(noun: string): EntryShape {
  return { noun, required: ['accelerator', 'command'], optional: [] };
}

function unbindShape(kind: (typeof UNBIND_KINDS)[number]): EntryShape {
  const noun = 'an unbind entry';
  switch (kind) {
    case 'page':
      return { noun, required: ['page', 'scope'], optional: [] };
    case 'editor':
      return { noun, required: ['editor', 'scope'], optional: ['mode'] };
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

function requireKeyList(path: string, value: unknown): string[] {
  const keys = requireArray(path, value).map((key, index) =>
    requireKeysString(`${path}[${index}]`, key),
  );
  if (keys.length === 0) {
    throw new Error(`"${path}" is empty.`);
  }
  return keys;
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

function requireCommand(
  path: string,
  value: unknown,
  runsIn: ProcessName,
  noun: string,
  names: KeymapNames,
): CommandId {
  const id = requireString(path, value);
  const info = Object.hasOwn(names.commands, id)
    ? names.commands[id]
    : undefined;
  if (info === undefined) {
    throw new Error(`"${path}" names no command "${id}".`);
  }
  if (info.runsIn !== runsIn) {
    const where = info.runsIn === 'page' ? 'the page' : 'main';
    throw new Error(
      `"${path}" names "${id}", which runs in ${where}; ${noun} needs a ${runsIn} command.`,
    );
  }
  return id;
}

function requireScope(
  path: string,
  value: unknown,
  names: KeymapNames,
): string {
  const scope = requireString(path, value);
  if (!names.scopes.some((info) => info.id === scope)) {
    throw new Error(`"${path}" names no scope "${scope}".`);
  }
  return scope;
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

function readPageBind(
  path: string,
  value: unknown,
  names: KeymapNames,
): PageBind {
  const entry = requireFields(path, value, PAGE_BIND);
  return {
    keys: requireKeyList(`${path}.keys`, entry.keys),
    scope: requireScope(`${path}.scope`, entry.scope, names),
    command: requireCommand(
      `${path}.command`,
      entry.command,
      'page',
      PAGE_BIND.noun,
      names,
    ),
  };
}

function readEditorBind(
  path: string,
  value: unknown,
  names: KeymapNames,
): EditorBind {
  const entry = requireFields(path, value, EDITOR_BIND);
  const bind: EditorBind = {
    keys: requireKeysString(`${path}.keys`, entry.keys),
    scope: requireScope(`${path}.scope`, entry.scope, names),
    command: requireCommand(
      `${path}.command`,
      entry.command,
      'page',
      EDITOR_BIND.noun,
      names,
    ),
  };
  if (Object.hasOwn(entry, 'mode')) {
    bind.mode = requireMode(`${path}.mode`, entry.mode);
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
      `${path}.command`,
      entry.command,
      'main',
      shape.noun,
      names,
    ),
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
      `${path}.command`,
      entry.command,
      'main',
      INTERCEPT_BIND.noun,
      names,
    ),
  };
}

function readUnbind(path: string, value: unknown): KeymapUnbind {
  const entry = requireObject(path, value);
  const named = UNBIND_KINDS.filter((kind) => Object.hasOwn(entry, kind));
  if (named.length !== 1) {
    throw new Error(`"${path}" must name one of ${UNBIND_KINDS.join(', ')}.`);
  }
  const kind = named[0];
  requireFields(path, entry, unbindShape(kind));
  switch (kind) {
    case 'page':
      return {
        page: requireKeyList(`${path}.page`, entry.page),
        scope: requireString(`${path}.scope`, entry.scope),
      };
    case 'editor': {
      const unbind: KeymapUnbind = {
        editor: requireKeysString(`${path}.editor`, entry.editor),
        scope: requireString(`${path}.scope`, entry.scope),
      };
      if (Object.hasOwn(entry, 'mode')) {
        unbind.mode = requireMode(`${path}.mode`, entry.mode);
      }
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

// Throws on two binds in `section` on one accelerator.
function requireDistinctAccelerators(
  section: string,
  binds: readonly AcceleratorBind[],
): void {
  binds.forEach((bind, index) => {
    const first = binds.findIndex(
      (other) => other.accelerator === bind.accelerator,
    );
    if (first < index) {
      throw new Error(
        `"${section}[${index}]" binds ${bind.accelerator}, as "${section}[${first}]" does.`,
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

function readEditor(
  value: unknown,
  names: KeymapNames,
): NonNullable<UserKeymap['editor']> {
  const editor = requireObject('editor', value);
  for (const key of Object.keys(editor)) {
    if (!EDITOR_SECTIONS.includes(key)) {
      throw new Error(`"editor.${key}" is not a keymap section.`);
    }
  }
  const read: NonNullable<UserKeymap['editor']> = {};
  if (Object.hasOwn(editor, 'leader')) {
    read.leader = requireKeysString('editor.leader', editor.leader);
  }
  if (Object.hasOwn(editor, 'remaps')) {
    read.remaps = readList('editor.remaps', editor.remaps, readRemap);
  }
  if (Object.hasOwn(editor, 'binds')) {
    read.binds = readList('editor.binds', editor.binds, (path, entry) =>
      readEditorBind(path, entry, names),
    );
  }
  return read;
}

// The user keymap `text`, a `keymap.json`, holds, each bind naming a command
// and scope of `names` that runs in the bind's process, and each accelerator
// one Electron accepts. Throws an Error whose message is the first problem
// found, as the user reads it.
export function parseUserKeymap(text: string, names: KeymapNames): UserKeymap {
  const file = parseJsonObject(text);
  for (const key of Object.keys(file)) {
    if (!SECTIONS.includes(key)) {
      throw new Error(`"${key}" is not a keymap section.`);
    }
  }
  const keymap: UserKeymap = {};
  if (Object.hasOwn(file, 'page')) {
    keymap.page = readList('page', file.page, (path, entry) =>
      readPageBind(path, entry, names),
    );
  }
  if (Object.hasOwn(file, 'editor')) {
    keymap.editor = readEditor(file.editor, names);
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
    keymap.unbind = readList('unbind', file.unbind, readUnbind);
  }
  return keymap;
}
