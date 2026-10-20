import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, watch as watchFolder } from 'node:fs';
import {
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import {
  type FileEntry,
  type Files,
  type FileStat,
  type FileWatch,
  isMissingFile,
} from '../../contracts/files';

// Editors save through a rename and FSEvents repeats events, so one save
// arrives as several events for one path.
const WATCH_QUIET_MS = 100;

// The temp file `write` renames over its target: `.<name>.<8 hex>.tmp`.
const TEMP_FILE = /^\..+\.[0-9a-f]{8}\.tmp$/;

export interface NodeFilesOptions {
  // Moves a path to the OS Trash; main.ts passes Electron's shell.trashItem.
  trashItem: (path: string) => Promise<void>;
}

// `Files` over the disk, through `node:fs`. Paths are absolute. `trash` hands
// its path to `options.trashItem`.
export function createNodeFiles(options: NodeFilesOptions): Files {
  return {
    read: (file) => readFile(file, 'utf8'),
    write: writeAtomically,
    list: listFolder,
    watch: watchDebounced,
    stat: statPath,
    realPath: (file) => realpath(file),
    makeFolder: async (folder) => {
      await mkdir(folder, { recursive: true });
    },
    rename: renameWithoutReplacing,
    trash: (file) => options.trashItem(file),
  };
}

async function statPath(file: string): Promise<FileStat | null> {
  try {
    return { isFolder: (await stat(file)).isDirectory() };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      return null;
    }
    throw error;
  }
}

async function renameWithoutReplacing(from: string, to: string): Promise<void> {
  if (await isAnythingAt(to)) {
    throw new Error(`${to} already exists`);
  }
  await rename(from, to);
}

// Through `lstat`, so a broken symlink counts as something there.
async function isAnythingAt(file: string): Promise<boolean> {
  try {
    await lstat(file);
    return true;
  } catch (error) {
    if (isMissingFile(error)) {
      return false;
    }
    throw error;
  }
}

async function writeAtomically(file: string, text: string): Promise<void> {
  const folder = path.dirname(file);
  const temp = path.join(
    folder,
    `.${path.basename(file)}.${randomBytes(4).toString('hex')}.tmp`,
  );
  await mkdir(folder, { recursive: true });
  try {
    await writeFile(temp, text, 'utf8');
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
  folder: string,
  onChange: (path: string) => void,
  onError?: (error: unknown) => void,
): FileWatch {
  mkdirSync(folder, { recursive: true });
  const pending = new Map<string, NodeJS.Timeout>();
  const watcher = watchFolder(folder, { recursive: true }, (_event, name) => {
    if (name === null || isWatchedFolderItself(folder, name)) {
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
  const close = () => {
    watcher.close();
    for (const timer of pending.values()) {
      clearTimeout(timer);
    }
    pending.clear();
  };
  let failed = false;
  // A listener stays attached after the first error, since an `'error'` an
  // emitter has no listener for is thrown.
  watcher.on('error', (error) => {
    if (failed) {
      return;
    }
    failed = true;
    close();
    onError?.(error);
  });
  return { close };
}

// FSEvents reports a change to the watched folder itself (its contents
// changing, or its own creation) under the folder's own name.
function isWatchedFolderItself(folder: string, name: string): boolean {
  return (
    process.platform === 'darwin' &&
    name === path.basename(folder) &&
    !existsSync(path.join(folder, name))
  );
}

function slashJoined(relative: string): string {
  return relative.split(path.sep).join('/');
}
