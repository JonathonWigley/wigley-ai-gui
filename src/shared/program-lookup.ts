import type { Files } from '../contracts/files';
import type { Paths } from '../contracts/paths';
import type {
  OsName,
  ProgramCandidate,
  ProgramName,
} from '../contracts/platform';

// Where a program is looked for: the OS's rules, the PATH and PATHEXT values,
// and the home folder `~` stands for.
export interface ProgramSearch {
  os: OsName;
  path: string | undefined;
  // Read on Windows only.
  pathExt: string | undefined;
  homeDir: string;
  paths: Pick<Paths, 'expandTilde' | 'join'>;
}

// What Node spawns to start a program.
export interface ProgramLaunch {
  file: string;
  args: string[];
  windowsVerbatimArguments: boolean;
}

const DEFAULT_PATH_EXT = '.COM;.EXE;.BAT;.CMD';

// cmd.exe's metacharacters, each escaped with `^`.
const META = /([()\][%!^"`<>&|;, *?])/g;

const NOT_FOUND_MESSAGES: Record<ProgramName, string> = {
  python: 'Python was not found on PATH; set programs.python',
  claude:
    'claude was not found on PATH or in ~/.local/bin; set claude-code.command',
  unity: 'unity was not found on PATH or in ~/.unity/bin',
  shell:
    'no shell was found: checked $SHELL and /bin/zsh, or pwsh and powershell.exe on Windows',
};

// The value of `name` in `env`. Windows' names ignore case, which a copied
// environment record loses, so there the first key equal without case answers.
export function envVariable(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
  os: OsName,
): string | undefined {
  if (os !== 'windows') {
    return env[name];
  }
  const upper = name.toUpperCase();
  const key = Object.keys(env).find((each) => each.toUpperCase() === upper);
  return key === undefined ? undefined : env[key];
}

// The file `command` starts, or null when none is found. A path (`~/x`, or
// holding a separator, or on Windows `~\x` or a drive's `:`) is tried in its
// own folder, `~` expanded; a bare name in each PATH folder in order, empty
// entries skipped. On Windows a name whose extension PATHEXT lists is tried as
// it is, any other with each PATHEXT extension appended, every extension in a
// folder before the next folder. Elsewhere the name is tried as it is. A try
// finds a file that is not a folder; a `stat` that throws is a miss. Never
// rejects.
export async function findProgram(
  command: string,
  search: ProgramSearch,
  files: Pick<Files, 'stat'>,
): Promise<string | null> {
  for (const file of filesToTry(command, search)) {
    if (await isFile(file, files)) {
      return file;
    }
  }
  return null;
}

// The first candidate `findProgram` finds, as the found file with the
// candidate's args; null when none is found.
export async function findCandidate(
  candidates: readonly ProgramCandidate[],
  search: ProgramSearch,
  files: Pick<Files, 'stat'>,
): Promise<ProgramCandidate | null> {
  for (const candidate of candidates) {
    const found = await findProgram(candidate.command, search, files);
    if (found !== null) {
      return { command: found, args: candidate.args };
    }
  }
  return null;
}

// What Node spawns to start `target` with `args`. On Windows a `.cmd` or `.bat`
// cannot start without cmd.exe, so it starts as `<comSpec> /d /s /c "<line>"`
// with no quoting from Node, each part escaped once for cmd.exe, as
// cross-spawn escapes a `.cmd` outside `node_modules\.bin`.
// Throws on such a start when an argument holds a line break.
export function shimLaunch(
  target: string,
  args: readonly string[],
  os: OsName,
  comSpec: string,
): ProgramLaunch {
  const isShim = os === 'windows' && /\.(cmd|bat)$/i.test(target);
  if (!isShim) {
    return { file: target, args: [...args], windowsVerbatimArguments: false };
  }
  if (args.some((arg) => /[\r\n]/.test(arg))) {
    throw new Error(
      'an argument holds a line break, which cmd.exe cannot pass',
    );
  }
  const line = [escapeCommand(target), ...args.map(escapeArgument)].join(' ');
  return {
    file: comSpec,
    args: ['/d', '/s', '/c', `"${line}"`],
    windowsVerbatimArguments: true,
  };
}

// The line shown when no program for `name` is found, naming the setting that
// sets one.
export function programNotFoundMessage(name: ProgramName): string {
  return NOT_FOUND_MESSAGES[name];
}

function filesToTry(command: string, search: ProgramSearch): string[] {
  const names = namesToTry(command, search);
  if (isPathCommand(command, search.os)) {
    return names.map((name) => search.paths.expandTilde(name, search.homeDir));
  }
  return pathFolders(search).flatMap((folder) =>
    names.map((name) => search.paths.join(folder, name)),
  );
}

function isPathCommand(command: string, os: OsName): boolean {
  if (command.startsWith('~/') || command.includes('/')) {
    return true;
  }
  return (
    os === 'windows' &&
    (command.startsWith('~\\') ||
      command.includes('\\') ||
      command.includes(':'))
  );
}

function pathFolders(search: ProgramSearch): string[] {
  const isWindows = search.os === 'windows';
  return (search.path ?? '')
    .split(isWindows ? ';' : ':')
    .map((entry) => (isWindows ? entry.replace(/^"(.*)"$/, '$1') : entry))
    .filter((entry) => entry !== '');
}

// `command` as it is, or on Windows with each PATHEXT extension appended when
// its own extension is not one of them.
function namesToTry(command: string, search: ProgramSearch): string[] {
  if (search.os !== 'windows') {
    return [command];
  }
  const extensions = pathExtensions(search.pathExt);
  const ownExtension = extensionOf(command);
  const hasListedExtension =
    ownExtension !== null &&
    extensions.some(
      (extension) => extension.toLowerCase() === ownExtension.toLowerCase(),
    );
  if (hasListedExtension) {
    return [command];
  }
  return extensions.map((extension) => command + extension);
}

function pathExtensions(pathExt: string | undefined): string[] {
  const listed = (pathExt ?? '').split(';').filter((entry) => entry !== '');
  return listed.length > 0 ? listed : DEFAULT_PATH_EXT.split(';');
}

// The last segment's extension with its dot; null when it has none.
function extensionOf(command: string): string | null {
  const base = command.slice(
    Math.max(command.lastIndexOf('/'), command.lastIndexOf('\\')) + 1,
  );
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? null : base.slice(dot);
}

async function isFile(
  file: string,
  files: Pick<Files, 'stat'>,
): Promise<boolean> {
  try {
    const stat = await files.stat(file);
    return stat !== null && !stat.isFolder;
  } catch {
    // EACCES, EPERM or EINVAL on an odd PATH entry: a miss for this try only.
    return false;
  }
}

function escapeCommand(text: string): string {
  return text.replace(META, '^$1');
}

function escapeArgument(arg: string): string {
  const quoted = arg
    .replace(/(?=(\\+?)?)\1"/g, '$1$1\\"')
    .replace(/(?=(\\+?)?)\1$/, '$1$1');
  return `"${quoted}"`.replace(META, '^$1');
}
