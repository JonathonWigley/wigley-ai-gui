import { randomBytes } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  type Stats,
  watch as watchFolder,
} from 'node:fs';
import {
  appendFile,
  copyFile,
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
import { setTimeout as delay } from 'node:timers/promises';
import {
  type FileEntry,
  type Files,
  type FileStat,
  type FileWatch,
  isMissingFile,
  type WatchOptions,
  withoutLeadingContinuationBytes,
} from '../../contracts/files';
import type { OsName } from '../../contracts/platform';

// Editors save through a rename and FSEvents repeats events, so one save
// arrives as several events for one path.
const WATCH_QUIET_MS = 100;

// The temp file `write` and `copy` rename over their target:
// `.<name>.<8 hex>.tmp`, the target's name captured.
const TEMP_FILE = /^\.(.+)\.[0-9a-f]{8}\.tmp$/;

// The waits between tries of `write`'s rename while another process holds the
// file (EPERM or EBUSY, as on Windows): one try, then one after each wait.
const RENAME_RETRY_DELAYS_MS = [10, 20, 40, 80];
const HELD_FILE = new Set(['EPERM', 'EBUSY']);

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
    readEnd: readLastBytes,
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
    copy: copyAtomically,
    trash: (file) => options.trashItem(file),
    // No `recursive`, so a folder rejects.
    deleteFile: (file) => rm(file, { force: true }),
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

async function readLastBytes(file: string, maxBytes: number): Promise<string> {
  const handle = await open(file, 'r');
  try {
    const { size } = await handle.stat();
    const start = Math.max(0, size - maxBytes);
    const buffer = Buffer.alloc(size - start);
    // A read may return fewer bytes than asked for before the end of the file.
    let filled = 0;
    while (filled < buffer.length) {
      const { bytesRead } = await handle.read(
        buffer,
        filled,
        buffer.length - filled,
        start + filled,
      );
      if (bytesRead === 0) {
        break;
      }
      filled += bytesRead;
    }
    const read = buffer.subarray(0, filled);
    return new TextDecoder('utf-8').decode(
      start > 0 ? withoutLeadingContinuationBytes(read) : read,
    );
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
    // A failed check keeps the rename's own error.
    if (await isFileAbove(to).catch(() => false)) {
      throw Object.assign(new Error(`a file lies above ${to}`), {
        code: 'ENOTDIR',
      });
    }
    throw error;
  }
}

// Whether the nearest entry above `file` is something other than a folder.
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
  const temp = tempFileBeside(file);
  await mkdir(path.dirname(file), { recursive: true });
  try {
    await writeFile(temp, content, 'utf8');
    await renameRetryingHeld(temp, file);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

// `from`, then `to`, is checked before anything is made, so a folder at
// either rejects with code `EISDIR`, leaving no temp file or folder of `to`.
async function copyAtomically(from: string, to: string): Promise<void> {
  if ((await stat(from)).isDirectory()) {
    throw Object.assign(new Error(`${from} is a folder`), { code: 'EISDIR' });
  }
  if ((await lstatOrNull(to))?.isDirectory() === true) {
    throw Object.assign(new Error(`${to} is a folder`), { code: 'EISDIR' });
  }
  const temp = tempFileBeside(to);
  await mkdir(path.dirname(to), { recursive: true });
  try {
    await copyFile(from, temp);
    await renameRetryingHeld(temp, to);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

// The temp file `write` and `copy` rename over `file`, as `TEMP_FILE` matches.
function tempFileBeside(file: string): string {
  return path.join(
    path.dirname(file),
    `.${path.basename(file)}.${randomBytes(4).toString('hex')}.tmp`,
  );
}

// `rename`, tried again after each of `RENAME_RETRY_DELAYS_MS` while it fails
// with a code `HELD_FILE` names; rejects with the last error.
async function renameRetryingHeld(from: string, to: string): Promise<void> {
  for (const wait of [...RENAME_RETRY_DELAYS_MS, null]) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (wait === null || code === undefined || !HELD_FILE.has(code)) {
        throw error;
      }
      await delay(wait);
    }
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
  // By the path reported. `fromTempOnly` while every event of its quiet window
  // named the temp file of a `write` to it.
  const pending = new Map<
    string,
    { timer: NodeJS.Timeout; fromTempOnly: boolean }
  >();
  const recursive = options?.recursive ?? true;
  const watcher = watchFolder(folder, { recursive }, (_event, name) => {
    if (name === null || isWatchedFolderItself(os, folder, name)) {
      return;
    }
    const changed = slashJoined(name);
    const nameStart = changed.lastIndexOf('/') + 1;
    const tempTarget = TEMP_FILE.exec(changed.slice(nameStart))?.[1];
    const isTempFile = tempTarget !== undefined;
    const reported = isTempFile
      ? changed.slice(0, nameStart) + tempTarget
      : changed;
    const earlier = pending.get(reported);
    clearTimeout(earlier?.timer);
    const fromTempOnly = isTempFile && (earlier?.fromTempOnly ?? true);
    pending.set(reported, {
      fromTempOnly,
      timer: setTimeout(() => {
        pending.delete(reported);
        // The temp file of a write that failed leaves no target.
        const isReported =
          !fromTempOnly || existsSync(path.join(folder, reported));
        if (isReported) {
          onChange(reported);
        }
      }, WATCH_QUIET_MS),
    });
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
    for (const { timer } of pending.values()) {
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
