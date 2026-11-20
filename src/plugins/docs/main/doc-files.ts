import {
  type Files,
  type FileWatch,
  isMissingFile,
  readIfPresent,
} from '../../../contracts/files';
import type { PluginLog } from '../../../contracts/log';
import type { Paths } from '../../../contracts/paths';
import { errorText } from '../../../shared/error-text';
import type {
  CreatedDoc,
  CreateRequest,
  FolderEntry,
  IndexEntry,
  IndexHarness,
  TrashResult,
  WriteResult,
} from '../contract';
import {
  createTarget,
  nameProblem,
  skillFolder,
  WIGLEY_AGENTS_FOLDER,
} from '../kinds';
import { changeRefusal, type GuardFolders } from '../path-guard';
import type { HarnessFolders } from '../../../shared/harness-folders';

export interface DocFilesDeps {
  files: Files;
  homeDir: string;
  log: PluginLog;
  paths: Paths;
  // The registered profiles' folders and installs, read at each guard and
  // lookup.
  folders: HarnessFolders;
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
// trash of a link trashes its final target and then the link, so neither is
// left behind and both can be restored; a link in between, in a chain of
// links, stays. A trash also takes every link the index walked to what goes.
export interface DocFiles {
  read(path: string): Promise<string>;
  // `read`, null when nothing is at `path`; any other failure rejects.
  readIfPresent(path: string): Promise<string | null>;
  // The wiki's `Main.md` with every link resolved, whether or not it exists.
  wikiMainPath(): Promise<string>;
  // `expectedText` non-null: writes only while the disk (missing reads as
  // '') still holds it, else returns what the disk holds.
  write(
    path: string,
    text: string,
    expectedText: string | null,
  ): Promise<WriteResult>;
  // `write` for bytes, with no changed-on-disk check.
  writeBytes(path: string, bytes: Uint8Array): Promise<WriteResult>;
  create(request: CreateRequest): Promise<CreatedDoc>;
  // A skill's `SKILL.md` moves its whole folder. Resolves to the doc's new
  // path.
  rename(from: string, to: string): Promise<string>;
  // What a trash at `path` moves, in order: the real file or folder (a link
  // chain's final target), then the path itself (its folder real) when that
  // is a link, then each walked link (its folder real) of the entries at or
  // inside the real one. A walked link is the nearest of an entry's `walked`
  // path and its ancestors that is a link resolving to the real one or inside
  // it; one inside the real one goes with it and is not named. A skill's
  // `SKILL.md` stands for its whole folder.
  trashTargets(path: string): Promise<string[]>;
  // Moves `trashTargets(path)` to the Trash in order once the guard allows
  // every one, else rejects moving none. Rejects when the first move fails;
  // when a later one fails, resolves to what moved and the failure.
  trash(path: string): Promise<TrashResult>;
  // `folder`'s entries one level down; [] when it is no folder.
  list(folder: string): Promise<FolderEntry[]>;
  // Calls `changed` after the file at `path` changes or is replaced.
  watch(path: string, changed: () => void): Promise<FileWatch>;
  // The `listedAt` of the first install of `key` under `harness` that has
  // one; null when none does or no adapter is registered under `harness`.
  pluginConfigFile(
    key: string,
    harness: IndexHarness,
  ): Promise<{ path: string; line: number } | null>;
}

export function createDocFiles(deps: DocFilesDeps): DocFiles {
  const { files, homeDir, log, paths, folders } = deps;

  const absolute = (path: string) => absolutePath(path, homeDir, paths);

  // `target`, once the guard allows a change there.
  async function allowed(target: string): Promise<string> {
    const guarded = await guardFolders(files, homeDir, folders, paths);
    const refusal = changeRefusal(target, deps.entries(), guarded, paths);
    if (refusal !== null) {
      throw new Error(refusal);
    }
    return target;
  }

  // The real path a write at `path` lands on, once the guard allows it.
  // Rejects on a link whose target is missing, which the write would replace.
  async function writeTarget(path: string): Promise<string> {
    if (await isDanglingLink(files, path, paths)) {
      throw new Error(`Refused: ${path} is a link to a missing file`);
    }
    return allowed(await realTarget(files, path, paths));
  }

  // `path` with its folder real, once the guard allows moving it.
  async function moveTarget(path: string): Promise<string> {
    return allowed(await folderRealTarget(files, path, paths));
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

  async function writeBytes(
    path: string,
    bytes: Uint8Array,
  ): Promise<WriteResult> {
    const target = await writeTarget(absolute(path));
    await files.writeBytes(target, bytes);
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
      paths,
    );
    const path = absolute(target.path);
    const real = await writeTarget(path);
    const isThere = await exists(real);
    if (isThere && !target.appends) {
      throw new Error(`${path} already exists`);
    }
    const contents = target.contents(isThere ? await files.read(real) : null);
    await files.makeFolder(paths.parent(real));
    await files.write(real, contents.text);
    return { path, line: contents.line };
  }

  async function createAtPath(requested: string): Promise<CreatedDoc> {
    const namesFolder =
      requested.endsWith('/') || requested.endsWith(paths.separator);
    if (namesFolder) {
      throw new Error('A path names a file, not a folder');
    }
    const path = absolute(requested);
    if (await exists(path)) {
      throw new Error(`${path} already exists`);
    }
    const real = await writeTarget(path);
    await files.makeFolder(paths.parent(real));
    await files.write(real, '');
    return { path, line: 1 };
  }

  async function rename(from: string, to: string): Promise<string> {
    const fromPath = absolute(from);
    const toPath = absolute(to);
    if (toPath === fromPath) {
      return fromPath;
    }
    const skill = skillFolder(fromPath, paths);
    if (skill !== null && paths.base(toPath) !== 'SKILL.md') {
      throw new Error("A skill's SKILL.md keeps its name; rename its folder");
    }
    const moved = skill ?? fromPath;
    const destination = skill === null ? toPath : paths.parent(toPath);
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
    await files.makeFolder(paths.parent(realDestination));
    await files.rename(realMoved, realDestination);
    return toPath;
  }

  async function trashTargets(path: string): Promise<string[]> {
    const itself = await folderRealTarget(
      files,
      trashedPath(absolute(path), paths),
      paths,
    );
    const found = await files.stat(itself);
    const targets =
      found === null || !found.isLink
        ? [itself]
        : [await files.realPath(itself), itself];
    const [real] = targets;
    const goingEntries = deps
      .entries()
      .filter((entry) => paths.isInside(entry.path, real));
    for (const entry of goingEntries) {
      for (const walked of entry.walked) {
        const link = await walkedLink(files, walked, real, paths);
        if (link === null) {
          continue;
        }
        const named = await folderRealTarget(files, link, paths);
        const goesWithReal = paths.isInside(named, real);
        const isNamed = targets.some((target) => paths.samePath(target, named));
        if (!goesWithReal && !isNamed) {
          targets.push(named);
        }
      }
    }
    return targets;
  }

  // A full trash also names the path as asked, so entries and an open doc
  // reached through a linked folder match it.
  async function trash(path: string): Promise<TrashResult> {
    const targets = await trashTargets(path);
    for (const target of targets) {
      await allowed(target);
    }
    const trashed: string[] = [];
    for (const target of targets) {
      try {
        await files.trash(target);
      } catch (error) {
        if (trashed.length === 0) {
          throw error;
        }
        return { trashed, error: errorText(error) };
      }
      trashed.push(target);
    }
    const asked = trashedPath(absolute(path), paths);
    if (!trashed.some((target) => paths.samePath(target, asked))) {
      trashed.push(asked);
    }
    return { trashed, error: null };
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

  // Watches the file's folder, not the file, so an atomic replace is seen;
  // one level only, since only the file's own name is reported. When the
  // watch may have missed changes, calls `changed` only when the file's
  // modified time differs from the one last seen, so a caller that watches
  // again on each change does not set off another missed burst.
  async function watch(path: string, changed: () => void): Promise<FileWatch> {
    const requested = absolute(path);
    const real = await realPathOrSelf(files, requested);
    const name = paths.base(real);
    // Null when the file is missing or its time cannot be read.
    const modifiedNow = () =>
      files.modified(real).then(
        (time) => time,
        () => null,
      );
    let seen = await modifiedNow();
    // Takes the file's modified time; true when it differs from `seen`.
    const isChangedSinceSeen = async () => {
      const time = await modifiedNow();
      const differs = time !== seen;
      seen = time;
      return differs;
    };
    return files.watch(
      paths.parent(real),
      (changedPath) => {
        if (paths.samePath(changedPath, name)) {
          changed();
          void isChangedSinceSeen();
        }
      },
      {
        recursive: false,
        onError: (error) =>
          log(`watch ${requested} stopped: ${errorText(error)}`),
        onMissed: () => {
          void isChangedSinceSeen().then((differs) => {
            if (differs) {
              changed();
            }
          });
        },
      },
    );
  }

  async function pluginConfigFile(
    key: string,
    harness: IndexHarness,
  ): Promise<{ path: string; line: number } | null> {
    const listing = (await folders.installedPlugins()).find(
      ({ harnessId, plugin }) =>
        harnessId === harness && plugin.key === key && plugin.listedAt !== null,
    );
    return listing?.plugin.listedAt ?? null;
  }

  return {
    read: async (path) => files.read(absolute(path)),
    readIfPresent: async (path) => readIfPresent(files, absolute(path)),
    wikiMainPath: () =>
      realTarget(
        files,
        paths.join(homeDir, WIGLEY_AGENTS_FOLDER, 'wiki', 'Main.md'),
        paths,
      ),
    write,
    writeBytes,
    create,
    rename,
    trashTargets,
    trash,
    list,
    watch,
    pluginConfigFile,
  };
}

// What a trash of the doc at `path` moves: a skill's whole folder for its
// `SKILL.md`, else the doc.
function trashedPath(path: string, paths: Paths): string {
  return skillFolder(path, paths) ?? path;
}

function absolutePath(path: string, homeDir: string, paths: Paths): string {
  const full = paths.expandTilde(path, homeDir);
  if (!paths.isAbsolute(full)) {
    throw new Error('A path is absolute or starts with ~');
  }
  return paths.normalize(full);
}

// `path` with every link resolved: the real path of its nearest existing
// ancestor, joined with the segments not there yet.
async function realTarget(
  files: Files,
  path: string,
  paths: Paths,
): Promise<string> {
  const missing: string[] = [];
  let existing = path;
  while (
    paths.parent(existing) !== existing &&
    (await files.stat(existing)) === null
  ) {
    missing.unshift(paths.base(existing));
    existing = paths.parent(existing);
  }
  return paths.join(await files.realPath(existing), ...missing);
}

// `path` with its folder's links resolved and its own name kept, so a link
// names itself.
async function folderRealTarget(
  files: Files,
  path: string,
  paths: Paths,
): Promise<string> {
  return paths.join(
    await realTarget(files, paths.parent(path), paths),
    paths.base(path),
  );
}

// The nearest of `walked` and its ancestors that is a link resolving to
// `real` or inside it, else null.
async function walkedLink(
  files: Files,
  walked: string,
  real: string,
  paths: Paths,
): Promise<string | null> {
  let candidate = walked;
  for (;;) {
    const isLink = (await files.stat(candidate))?.isLink === true;
    const resolvesIntoReal =
      isLink && paths.isInside(await files.realPath(candidate), real);
    if (resolvesIntoReal) {
      return candidate;
    }
    const parent = paths.parent(candidate);
    if (parent === candidate) {
      return null;
    }
    candidate = parent;
  }
}

// Whether `path` is a link that leads nowhere: its folder lists its name,
// compared as samePath does, but nothing is there once links are followed.
async function isDanglingLink(
  files: Files,
  path: string,
  paths: Paths,
): Promise<boolean> {
  if ((await files.stat(path)) !== null) {
    return false;
  }
  const name = paths.base(path);
  const siblings = await files.list(paths.parent(path));
  return siblings.some((sibling) => paths.samePath(sibling.path, name));
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

// The folders the index walks for global docs (each registered profile's
// config folder, `~/.agents` and `~/wigley-agents`), the plugin caches each
// profile's harness declares and the synced skill folders (each config
// folder's `skills/synced`), all real. Each declared folder is `~` expanded
// and normalized, and one that is not absolute then is dropped. A docs folder
// at or above the home folder is dropped, so the home folder itself never
// becomes writable.
async function guardFolders(
  files: Files,
  homeDir: string,
  folders: Pick<HarnessFolders, 'roots'>,
  paths: Paths,
): Promise<GuardFolders> {
  const declared = (folder: string): string[] => {
    const full = paths.expandTilde(folder, homeDir);
    return paths.isAbsolute(full) ? [paths.normalize(full)] : [];
  };
  const roots = folders.roots().map((profile) => profile.roots);
  const configDirs = roots.flatMap((root) => declared(root.configDir));
  const docFolders = [
    ...configDirs,
    paths.join(homeDir, '.agents'),
    paths.join(homeDir, WIGLEY_AGENTS_FOLDER),
  ];
  const caches = roots.flatMap((root) =>
    root.pluginCacheDirs.flatMap((folder) => declared(folder)),
  );
  const syncedSkills = configDirs.map((dir) =>
    paths.join(dir, 'skills', 'synced'),
  );
  const [realDocFolders, realCaches, realSyncedSkills] = await Promise.all([
    Promise.all(docFolders.map((folder) => realTarget(files, folder, paths))),
    Promise.all(caches.map((folder) => realTarget(files, folder, paths))),
    Promise.all(syncedSkills.map((folder) => realTarget(files, folder, paths))),
  ]);
  return {
    globalDocFolders: realDocFolders.filter(
      (folder) => !paths.isInside(homeDir, folder),
    ),
    pluginCaches: realCaches,
    thirdPartyFolders: realSyncedSkills,
  };
}
