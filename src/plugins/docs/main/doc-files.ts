import {
  type Files,
  type FileWatch,
  isMissingFile,
  readIfPresent,
} from '../../../contracts/files';
import type { Log } from '../../../contracts/log';
import { errorText } from '../../../shared/error-text';
import type {
  CreatedDoc,
  CreateRequest,
  FolderEntry,
  IndexEntry,
  IndexHarness,
  WriteResult,
} from '../contract';
import {
  baseName,
  expandTilde,
  isInside,
  joinPath,
  normalizePath,
  parentFolder,
} from '../doc-paths';
import {
  createTarget,
  nameProblem,
  skillFolder,
  WIGLEY_AGENTS_FOLDER,
} from '../kinds';
import { changeRefusal, type GuardFolders } from '../path-guard';
import { installedPluginsFile, readClaudeConfigDirs } from './script-locator';

export interface DocFilesDeps {
  files: Files;
  homeDir: string;
  log: Log;
  // Every loaded view's entries (the machine index's and each session's), for
  // the guard.
  entries(): readonly IndexEntry[];
}

// Every path is `~` expanded and normalized first, and one that is not
// absolute rejects. A write, create, rename or trash the guard refuses (see
// `changeRefusal`) rejects with its refusal. A write or create lands on the
// real path, so a symlinked doc stays a link, and rejects on a link whose
// target is missing. A rename acts on the path itself with only its folder
// resolved, so a symlinked doc moves as the link and its target stays. A
// trash of a link trashes its target and then the link, so neither is left
// behind and both can be restored.
export interface DocFiles {
  read(path: string): Promise<string>;
  // `expectedText` non-null: writes only while the disk (missing reads as
  // '') still holds it, else returns what the disk holds.
  write(
    path: string,
    text: string,
    expectedText: string | null,
  ): Promise<WriteResult>;
  create(request: CreateRequest): Promise<CreatedDoc>;
  // A skill's `SKILL.md` moves its whole folder. Resolves to the doc's new
  // path.
  rename(from: string, to: string): Promise<string>;
  // What a trash at `path` moves, in order: the real file or folder, then the
  // path itself (its folder real) when that is a link. A skill's `SKILL.md`
  // stands for its whole folder.
  trashTargets(path: string): Promise<string[]>;
  // Moves `trashTargets(path)` to the Trash once the guard allows every one,
  // else moves none. Resolves to them.
  trash(path: string): Promise<string[]>;
  // `folder`'s entries one level down; [] when it is no folder.
  list(folder: string): Promise<FolderEntry[]>;
  // Calls `changed` after the file at `path` changes or is replaced.
  watch(path: string, changed: () => void): Promise<FileWatch>;
  pluginConfigFile(
    key: string,
    harness: IndexHarness,
  ): Promise<{ path: string; line: number } | null>;
}

export function createDocFiles(deps: DocFilesDeps): DocFiles {
  const { files, homeDir, log } = deps;

  const absolute = (path: string) => absolutePath(path, homeDir);

  // `target`, once the guard allows a change there.
  async function allowed(target: string): Promise<string> {
    const folders = await guardFolders(files, homeDir, log);
    const refusal = changeRefusal(target, deps.entries(), folders);
    if (refusal !== null) {
      throw new Error(refusal);
    }
    return target;
  }

  // The real path a write at `path` lands on, once the guard allows it.
  // Rejects on a link whose target is missing, which the write would replace.
  async function writeTarget(path: string): Promise<string> {
    if (await isDanglingLink(files, path)) {
      throw new Error(`Refused: ${path} is a link to a missing file`);
    }
    return allowed(await realTarget(files, path));
  }

  // `path` with its folder real, once the guard allows moving it.
  async function moveTarget(path: string): Promise<string> {
    return allowed(await folderRealTarget(files, path));
  }

  async function exists(path: string): Promise<boolean> {
    return (await files.stat(path)) !== null;
  }

  async function write(
    path: string,
    text: string,
    expectedText: string | null,
  ): Promise<WriteResult> {
    const target = await writeTarget(absolute(path));
    if (expectedText !== null) {
      const diskText = (await readIfPresent(files, target)) ?? '';
      if (diskText !== expectedText) {
        return { type: 'changedOnDisk', diskText };
      }
    }
    await files.write(target, text);
    return { type: 'written' };
  }

  async function create(request: CreateRequest): Promise<CreatedDoc> {
    if (request.type === 'path') {
      return createAtPath(request.path);
    }
    const problem = nameProblem(request.kind, request.name);
    if (problem !== null) {
      throw new Error(problem);
    }
    const target = createTarget(
      request.kind,
      request.place,
      request.name.trim(),
    );
    const path = absolute(target.path);
    const real = await writeTarget(path);
    const isThere = await exists(real);
    if (isThere && !target.appends) {
      throw new Error(`${path} already exists`);
    }
    const contents = target.contents(isThere ? await files.read(real) : null);
    await files.makeFolder(parentFolder(real));
    await files.write(real, contents.text);
    return { path, line: contents.line };
  }

  async function createAtPath(requested: string): Promise<CreatedDoc> {
    if (requested.endsWith('/')) {
      throw new Error('A path names a file, not a folder');
    }
    const path = absolute(requested);
    if (await exists(path)) {
      throw new Error(`${path} already exists`);
    }
    const real = await writeTarget(path);
    await files.makeFolder(parentFolder(real));
    await files.write(real, '');
    return { path, line: 1 };
  }

  async function rename(from: string, to: string): Promise<string> {
    const fromPath = absolute(from);
    const toPath = absolute(to);
    if (toPath === fromPath) {
      return fromPath;
    }
    const skill = skillFolder(fromPath);
    if (skill !== null && baseName(toPath) !== 'SKILL.md') {
      throw new Error("A skill's SKILL.md keeps its name; rename its folder");
    }
    const moved = skill ?? fromPath;
    const destination = skill === null ? toPath : parentFolder(toPath);
    const realMoved = await moveTarget(moved);
    const realDestination = await moveTarget(destination);
    // Files.rename moves the entry when only the case changes on a
    // case-insensitive volume, and refuses a distinct entry there.
    const isCaseOnly =
      realMoved !== realDestination &&
      realMoved.toLowerCase() === realDestination.toLowerCase();
    if (!isCaseOnly && (await exists(realDestination))) {
      throw new Error(`${destination} already exists`);
    }
    await files.makeFolder(parentFolder(realDestination));
    await files.rename(realMoved, realDestination);
    return toPath;
  }

  async function trashTargets(path: string): Promise<string[]> {
    const requested = absolute(path);
    const trashed = skillFolder(requested) ?? requested;
    const itself = await folderRealTarget(files, trashed);
    const target = await realTarget(files, trashed);
    return target === itself ? [itself] : [target, itself];
  }

  async function trash(path: string): Promise<string[]> {
    const targets = await trashTargets(path);
    for (const target of targets) {
      await allowed(target);
    }
    for (const target of targets) {
      await files.trash(target);
    }
    return targets;
  }

  async function list(folder: string): Promise<FolderEntry[]> {
    const path = absolute(folder);
    const found = await files.stat(path);
    if (found === null || !found.isFolder) {
      return [];
    }
    const entries = await files.list(path);
    return entries.map((entry) => ({
      name: entry.path,
      isFolder: entry.kind === 'folder',
    }));
  }

  // Watches the file's folder, not the file, so an atomic replace is seen.
  async function watch(path: string, changed: () => void): Promise<FileWatch> {
    const requested = absolute(path);
    const real = await realPathOrSelf(files, requested);
    const name = baseName(real);
    return files.watch(
      parentFolder(real),
      (changedPath) => {
        if (changedPath === name) {
          changed();
        }
      },
      (error) => log('docs', `watch ${requested} stopped: ${errorText(error)}`),
    );
  }

  async function pluginConfigFile(
    key: string,
    harness: IndexHarness,
  ): Promise<{ path: string; line: number } | null> {
    const candidates =
      harness === 'claude'
        ? (await readClaudeConfigDirs(files, homeDir, log)).map(
            installedPluginsFile,
          )
        : [joinPath(homeDir, '.codex', 'config.toml')];
    const quotedKeys = quotedKeyForms(key, harness);
    for (const path of candidates) {
      const text = await readIfPresent(files, path);
      const index = text
        ?.split('\n')
        .findIndex((line) =>
          quotedKeys.some((quoted) => line.includes(quoted)),
        );
      if (index !== undefined && index >= 0) {
        return { path, line: index + 1 };
      }
    }
    return null;
  }

  return {
    read: (path) => files.read(absolute(path)),
    write,
    create,
    rename,
    trashTargets,
    trash,
    list,
    watch,
    pluginConfigFile,
  };
}

// `key` as the harness's config file writes it: a JSON string in
// `installed_plugins.json`, a quoted TOML key (basic or literal) in Codex's
// `config.toml`, since `@` is not allowed in a bare one.
function quotedKeyForms(key: string, harness: IndexHarness): string[] {
  return harness === 'claude' ? [`"${key}"`] : [`"${key}"`, `'${key}'`];
}

function absolutePath(path: string, homeDir: string): string {
  const normal = normalizePath(expandTilde(path, homeDir));
  if (!normal.startsWith('/')) {
    throw new Error('A path starts with / or ~');
  }
  return normal;
}

// `path` with every link resolved: the real path of its nearest existing
// ancestor, joined with the segments not there yet.
async function realTarget(files: Files, path: string): Promise<string> {
  const missing: string[] = [];
  let existing = path;
  while (existing !== '/' && (await files.stat(existing)) === null) {
    missing.unshift(baseName(existing));
    existing = parentFolder(existing);
  }
  return joinPath(await files.realPath(existing), ...missing);
}

// `path` with its folder's links resolved and its own name kept, so a link
// names itself.
async function folderRealTarget(files: Files, path: string): Promise<string> {
  return joinPath(await realTarget(files, parentFolder(path)), baseName(path));
}

// Whether `path` is a link that leads nowhere: its folder lists it, but
// nothing is there once links are followed.
async function isDanglingLink(files: Files, path: string): Promise<boolean> {
  if ((await files.stat(path)) !== null) {
    return false;
  }
  const name = baseName(path);
  const siblings = await files.list(parentFolder(path));
  return siblings.some((sibling) => sibling.path === name);
}

async function realPathOrSelf(files: Files, path: string): Promise<string> {
  try {
    return await files.realPath(path);
  } catch (error) {
    if (isMissingFile(error)) {
      return path;
    }
    throw error;
  }
}

// The folders the index walks for global docs (each Claude config folder,
// `~/.codex`, `~/.agents` and `~/wigley-agents`) and the plugin caches (each
// config folder's and Codex's), all real. A docs folder at or above the home
// folder is dropped, so the home folder itself never becomes writable.
async function guardFolders(
  files: Files,
  homeDir: string,
  log: Log,
): Promise<GuardFolders> {
  const configDirs = await readClaudeConfigDirs(files, homeDir, log);
  const docFolders = [
    ...configDirs,
    joinPath(homeDir, '.codex'),
    joinPath(homeDir, '.agents'),
    joinPath(homeDir, WIGLEY_AGENTS_FOLDER),
  ];
  const caches = [
    ...configDirs.map((dir) => joinPath(dir, 'plugins', 'cache')),
    joinPath(homeDir, '.codex', 'plugins', 'cache'),
  ];
  const [realDocFolders, realCaches] = await Promise.all([
    Promise.all(docFolders.map((folder) => realTarget(files, folder))),
    Promise.all(caches.map((folder) => realTarget(files, folder))),
  ]);
  return {
    globalDocFolders: realDocFolders.filter(
      (folder) => !isInside(homeDir, folder),
    ),
    pluginCaches: realCaches,
  };
}
