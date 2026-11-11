import { randomBytes } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  type Stats,
  watch as watchFolder,
} from 'node:fs';
import {
  appendFile,
  link,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import {
  type FileEntry,
  type Files,
  type FileStat,
  type FileWatch,
  isMissingFile,
  type WatchOptions,
} from '../../contracts/files';
import type { OsName } from '../../contracts/platform';

// Editors save through a rename and FSEvents repeats events, so one save
// arrives as several events for one path.
const WATCH_QUIET_MS = 100;

// The temp file `write` renames over its target: `.<name>.<8 hex>.tmp`.
const TEMP_FILE = /^\..+\.[0-9a-f]{8}\.tmp$/;

// Every macOS watch the process holds open. Node watches each folder through
// one FSEvents stream per process, rebuilt whenever a watch opens or closes,
// and the rebuild drops the events the old stream had not yet delivered.
const liveMacWatches = new Set<{ missed(): void }>();

// Tells every live macOS watch that it may have missed changes.
function announceStreamRebuilt(): void {
  for (const watch of liveMacWatches) {
    watch.missed();
  }
}

export interface NodeFilesOptions {
  // Moves a path to the OS Trash; main.ts passes Electron's shell.trashItem,
  // or a recursive rm under the self-test and a drive run.
  trashItem: (path: string) => Promise<void>;
  os: OsName;
}

// `Files` over the disk, through `node:fs`. Paths are absolute. `trash` hands
// its path to `options.trashItem`.
export function createNodeFiles(options: NodeFilesOptions): Files {
  return {
    read: (file) => readFile(file, 'utf8'),
    modified: async (file) => Math.trunc((await stat(file)).mtimeMs),
    readStart: readFirstBytes,
    write: writeAtomically,
    writeBytes: writeAtomically,
    append: async (file, text) => {
      await mkdir(path.dirname(file), { recursive: true });
      await appendFile(file, text, 'utf8');
    },
    readBytes: (file) => readFile(file),
    list: listFolder,
    watch: (folder, onChange, watchOptions) =>
      watchDebounced(options.os, folder, onChange, watchOptions),
    stat: statPath,
    realPath: (file) => realpath(file),
    makeFolder: async (folder) => {
      await mkdir(folder, { recursive: true });
    },
    rename: renameWithoutReplacing,
    trash: (file) => options.trashItem(file),
  };
}

async function readFirstBytes(file: string, maxBytes: number): Promise<string> {
  const handle = await open(file, 'r');
  try {
    const buffer = Buffer.alloc(maxBytes);
    // A read may return fewer bytes than asked for before the end of the file.
    let filled = 0;
    while (filled < maxBytes) {
      const { bytesRead } = await handle.read(
        buffer,
        filled,
        maxBytes - filled,
        filled,
      );
      if (bytesRead === 0) {
        break;
      }
      filled += bytesRead;
    }
    // `stream` holds back a multi-byte character the cut splits instead of
    // emitting U+FFFD.
    return new TextDecoder('utf-8').decode(buffer.subarray(0, filled), {
      stream: true,
    });
  } finally {
    await handle.close();
  }
}

async function statPath(file: string): Promise<FileStat | null> {
  try {
    const itself = await lstat(file);
    if (!itself.isSymbolicLink()) {
      return { isFolder: itself.isDirectory(), isLink: false };
    }
    return { isFolder: (await stat(file)).isDirectory(), isLink: true };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      return null;
    }
    throw error;
  }
}

// The codes `link` fails with on a volume or for a file that takes no hard
// link.
const NO_HARD_LINK = new Set(['EXDEV', 'EPERM', 'ENOTSUP']);

async function renameWithoutReplacing(from: string, to: string): Promise<void> {
  const target = await lstatOrNull(to);
  if (target !== null) {
    if (!(await isSameEntryRespelled(from, to, target))) {
      throw new Error(`${to} already exists`);
    }
    await rename(from, to);
    return;
  }
  try {
    if ((await lstat(from)).isFile() && (await movedByLink(from, to))) {
      return;
    }
    await rename(from, to);
  } catch (error) {
    if (await isFileAbove(to)) {
      throw Object.assign(new Error(`a file lies above ${to}`), {
        code: 'ENOTDIR',
      });
    }
    throw error;
  }
}

// Whether the nearest entry above `path` is something other than a folder.
// macOS reports a file above a rename's target as ENOTDIR from the first
// lstat; Windows reports it as EINVAL from `link` or ENOENT from `rename`.
async function isFileAbove(file: string): Promise<boolean> {
  let above = path.dirname(file);
  for (;;) {
    const entry = await statPath(above);
    if (entry !== null) {
      return !entry.isFolder;
    }
    const next = path.dirname(above);
    if (next === above) {
      return false;
    }
    above = next;
  }
}

// Whether `to` names the entry at `from` in another case, as on a
// case-insensitive volume.
async function isSameEntryRespelled(
  from: string,
  to: string,
  target: Stats,
): Promise<boolean> {
  const source = await lstatOrNull(from);
  const isSameEntry =
    source !== null && source.dev === target.dev && source.ino === target.ino;
  const differsOnlyInCase =
    from !== to && from.toLowerCase() === to.toLowerCase();
  return isSameEntry && differsOnlyInCase;
}

// Moves the file at `from` to `to` by hard link, which fails rather than
// replace a file at `to`; false, changing nothing, when the volume takes no
// hard link.
async function movedByLink(from: string, to: string): Promise<boolean> {
  try {
    await link(from, to);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EEXIST') {
      throw new Error(`${to} already exists`);
    }
    if (code !== undefined && NO_HARD_LINK.has(code)) {
      return false;
    }
    throw error;
  }
  try {
    await unlink(from);
  } catch (error) {
    await rm(to, { force: true });
    throw error;
  }
  return true;
}

// Through `lstat`, so a broken symlink counts as something there.
async function lstatOrNull(file: string): Promise<Stats | null> {
  try {
    return await lstat(file);
  } catch (error) {
    if (isMissingFile(error)) {
      return null;
    }
    throw error;
  }
}

// Text is written as UTF-8.
async function writeAtomically(
  file: string,
  content: string | Uint8Array,
): Promise<void> {
  const folder = path.dirname(file);
  const temp = path.join(
    folder,
    `.${path.basename(file)}.${randomBytes(4).toString('hex')}.tmp`,
  );
  await mkdir(folder, { recursive: true });
  try {
    await writeFile(temp, content, 'utf8');
    await rename(temp, file);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

async function listFolder(
  folder: string,
  options?: { recursive?: boolean },
): Promise<FileEntry[]> {
  let entries;
  try {
    entries = await readdir(folder, {
      recursive: options?.recursive ?? false,
      withFileTypes: true,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
  return entries.map((entry) => ({
    path: slashJoined(
      path.relative(folder, path.join(entry.parentPath, entry.name)),
    ),
    kind: entry.isDirectory() ? 'folder' : 'file',
  }));
}

function watchDebounced(
  os: OsName,
  folder: string,
  onChange: (path: string) => void,
  options?: WatchOptions,
): FileWatch {
  mkdirSync(folder, { recursive: true });
  const pending = new Map<string, NodeJS.Timeout>();
  const recursive = options?.recursive ?? true;
  const watcher = watchFolder(folder, { recursive }, (_event, name) => {
    if (name === null || isWatchedFolderItself(os, folder, name)) {
      return;
    }
    const changed = slashJoined(name);
    if (TEMP_FILE.test(changed.slice(changed.lastIndexOf('/') + 1))) {
      return;
    }
    clearTimeout(pending.get(changed));
    pending.set(
      changed,
      setTimeout(() => {
        pending.delete(changed);
        onChange(changed);
      }, WATCH_QUIET_MS),
    );
  });
  let missedTimer: NodeJS.Timeout | undefined;
  const live = {
    missed() {
      clearTimeout(missedTimer);
      missedTimer = setTimeout(() => options?.onMissed?.(), WATCH_QUIET_MS);
    },
  };
  if (os === 'macos') {
    announceStreamRebuilt();
    liveMacWatches.add(live);
  }
  const dispose = () => {
    watcher.close();
    for (const timer of pending.values()) {
      clearTimeout(timer);
    }
    pending.clear();
    clearTimeout(missedTimer);
    if (liveMacWatches.delete(live)) {
      announceStreamRebuilt();
    }
  };
  let failed = false;
  // A listener stays attached after the first error, since an `'error'` an
  // emitter has no listener for is thrown.
  watcher.on('error', (error) => {
    if (failed) {
      return;
    }
    failed = true;
    dispose();
    options?.onError?.(error);
  });
  return { dispose };
}

// FSEvents reports a change to the watched folder itself (its contents
// changing, or its own creation) under the folder's own name.
function isWatchedFolderItself(
  os: OsName,
  folder: string,
  name: string,
): boolean {
  return (
    os === 'macos' &&
    name === path.basename(folder) &&
    !existsSync(path.join(folder, name))
  );
}

function slashJoined(relative: string): string {
  return relative.split(path.sep).join('/');
}
