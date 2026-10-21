import {
  type Files,
  type FileWatch,
  isMissingFile,
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
  joinPath,
  normalizePath,
  parentFolder,
} from '../doc-paths';
import { createTarget, nameProblem, skillFolder } from '../kinds';
import { changeRefusal } from '../path-guard';
import {
  installedPluginsFile,
  readClaudeConfigDirs,
  readIfPresent,
} from './script-locator';

export interface DocFilesDeps {
  files: Files;
  homeDir: string;
  log: Log;
  // The machine index's, for the guard.
  entries(): readonly IndexEntry[];
}

// Every path is `~` expanded and normalized first, and one that is not
// absolute rejects. A write, create, rename or trash outside the indexed
// folders and the Claude config folders, or inside a plugin install, rejects
// with the guard's refusal; each acts on the real path, so a symlinked doc
// stays a link.
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
  // A skill's `SKILL.md` trashes its whole folder. Resolves to the path
  // trashed.
  trash(path: string): Promise<string>;
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

  // The real path a change at `path` lands on, once the guard allows it.
  async function guarded(path: string): Promise<string> {
    const target = await realTarget(files, path);
    const configDirs = await realConfigDirs(files, homeDir, log);
    const refusal = changeRefusal(target, deps.entries(), configDirs);
    if (refusal !== null) {
      throw new Error(refusal);
    }
    return target;
  }

  async function exists(path: string): Promise<boolean> {
    return (await files.stat(path)) !== null;
  }

  async function write(
    path: string,
    text: string,
    expectedText: string | null,
  ): Promise<WriteResult> {
    const target = await guarded(absolute(path));
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
    const real = await guarded(path);
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
    const real = await guarded(path);
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
    const realMoved = await guarded(moved);
    const realDestination = await guarded(destination);
    if (await exists(realDestination)) {
      throw new Error(`${destination} already exists`);
    }
    await files.makeFolder(parentFolder(realDestination));
    await files.rename(realMoved, realDestination);
    return toPath;
  }

  async function trash(path: string): Promise<string> {
    const requested = absolute(path);
    const trashed = skillFolder(requested) ?? requested;
    await files.trash(await guarded(trashed));
    return trashed;
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

// Each Claude config folder, real when it exists.
async function realConfigDirs(
  files: Files,
  homeDir: string,
  log: Log,
): Promise<string[]> {
  const dirs = await readClaudeConfigDirs(files, homeDir, log);
  return Promise.all(dirs.map((dir) => realPathOrSelf(files, dir)));
}
