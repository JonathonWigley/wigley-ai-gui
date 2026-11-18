import type { ExCall } from '../../contracts/editor';

// A live ex command definition, as the host files it under its name.
export interface ExDefinition {
  prefix: string;
}

interface VimExCommand {
  name: string;
  shortName?: string;
}

// Vim's own ex commands that typed text reaches, from `defaultExCommandMap`
// and the `vimApi.defineEx` calls in @replit/codemirror-vim-core 0.1.0's
// vim.js: each one's name, and the short name vim keys it by when it has one.
// @replit/codemirror-vim 6.4.0 defines none of its own.
const VIM_EX_COMMANDS: readonly VimExCommand[] = [
  { name: 'colorscheme', shortName: 'colo' },
  { name: 'map' },
  { name: 'imap', shortName: 'im' },
  { name: 'nmap', shortName: 'nm' },
  { name: 'vmap', shortName: 'vm' },
  { name: 'omap', shortName: 'om' },
  { name: 'noremap', shortName: 'no' },
  { name: 'nnoremap', shortName: 'nn' },
  { name: 'vnoremap', shortName: 'vn' },
  { name: 'inoremap', shortName: 'ino' },
  { name: 'onoremap', shortName: 'ono' },
  { name: 'unmap' },
  { name: 'mapclear', shortName: 'mapc' },
  { name: 'nmapclear', shortName: 'nmapc' },
  { name: 'vmapclear', shortName: 'vmapc' },
  { name: 'imapclear', shortName: 'imapc' },
  { name: 'omapclear', shortName: 'omapc' },
  { name: 'write', shortName: 'w' },
  { name: 'undo', shortName: 'u' },
  { name: 'redo', shortName: 'red' },
  { name: 'set', shortName: 'se' },
  { name: 'setlocal', shortName: 'setl' },
  { name: 'setglobal', shortName: 'setg' },
  { name: 'sort', shortName: 'sor' },
  { name: 'substitute', shortName: 's' },
  { name: 'startinsert', shortName: 'start' },
  { name: 'nohlsearch', shortName: 'noh' },
  { name: 'yank', shortName: 'y' },
  { name: 'put', shortName: 'pu' },
  { name: 'delmarks', shortName: 'delm' },
  { name: 'marks' },
  { name: 'registers', shortName: 'reg' },
  { name: 'vglobal', shortName: 'v' },
  { name: 'delete', shortName: 'd' },
  { name: 'join', shortName: 'j' },
  { name: 'normal', shortName: 'norm' },
  { name: 'global', shortName: 'g' },
  { name: 'version', shortName: 've' },
];

// The rest of vim.js's `exCommands`, which no typed name reaches: vim runs
// `move` for a line number alone (`:42`).
const VIM_UNTYPED_EX_COMMANDS: readonly string[] = ['move', 'iput'];

const LETTERS_ONLY = /^[A-Za-z]+$/;

// The start of every `exBindName`.
const BIND_NAME_START = 'wigleybind';

// The name of each command vim files under each key: vim's own, with each
// live definition's name under its prefix over them, as `defineEx` writes vim's
// `commandMap_`.
function commandNamesByKey(
  defined: ReadonlyMap<string, ExDefinition>,
): Map<string, string> {
  const names = new Map<string, string>();
  for (const command of VIM_EX_COMMANDS) {
    names.set(command.shortName ?? command.name, command.name);
  }
  for (const [name, definition] of defined) {
    names.set(definition.prefix, name);
  }
  return names;
}

// The command typed `text` runs, as core 0.1.0's `matchCommand_` resolves it:
// from the longest start of `text` down, the first that keys a command whose
// name starts with `text`.
function commandTyped(
  text: string,
  namesByKey: ReadonlyMap<string, string>,
): string | undefined {
  for (let length = text.length; length > 0; length--) {
    const name = namesByKey.get(text.slice(0, length));
    if (name?.startsWith(text) === true) {
      return name;
    }
  }
  return undefined;
}

// What vim's `params.argString` holds: vim reads `:q!` as `q` with `!` after it.
export function exCallOf(argString: string | undefined): ExCall {
  const text = (argString ?? '').trimStart();
  const bang = text.startsWith('!');
  return { argString: (bang ? text.slice(1) : text).trim(), bang };
}

// The first reason `name` and `prefix` cannot be defined beside `defined`, the
// live definitions by name, or null. A prefix shadows one of vim's commands or
// a live definition exactly when vim runs that command for the prefix typed
// alone: only then would the prefix overwrite the command's key or catch a
// typed name ahead of it.
export function exDefinitionProblem(
  name: string,
  prefix: string,
  defined: ReadonlyMap<string, ExDefinition>,
): string | null {
  if (!LETTERS_ONLY.test(name)) {
    return `ex command name "${name}" must be letters only`;
  }
  if (name.startsWith(BIND_NAME_START)) {
    return `ex command name "${name}" is reserved for key binds`;
  }
  if (prefix === '' || !name.startsWith(prefix)) {
    return `ex command prefix "${prefix}" must be a non-empty start of "${name}"`;
  }
  if (defined.has(name)) {
    return `ex command ${name} is already defined`;
  }
  const holder = [...defined].find(
    ([, definition]) => definition.prefix === prefix,
  );
  if (holder !== undefined) {
    return `ex command ${name}: prefix ${prefix} is already defined by ${holder[0]}`;
  }
  const named = VIM_EX_COMMANDS.find(
    (command) => command.name === name || command.shortName === name,
  );
  if (named !== undefined) {
    return `ex command name "${name}" names vim's command ${named.name}`;
  }
  if (VIM_UNTYPED_EX_COMMANDS.includes(name)) {
    return `ex command name "${name}" names vim's command ${name}`;
  }
  const shadowed = commandTyped(prefix, commandNamesByKey(defined));
  if (shadowed === undefined) {
    return null;
  }
  const owner = defined.has(shadowed) ? 'ex command' : "vim's command";
  return `ex command prefix "${prefix}" would shadow ${owner} ${shadowed}`;
}
