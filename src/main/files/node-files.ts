import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, watch as watchFolder } from 'node:fs';
import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import type { FileEntry, Files, FileWatch } from '../../contracts/files';

// Editors save through a rename and FSEvents repeats events, so one save
// arrives as several events for one path.
const WATCH_QUIET_MS = 100;

// The temp file `write` renames over its target: `.<name>.<8 hex>.tmp`.
const TEMP_FILE = /^\..+\.[0-9a-f]{8}\.tmp$/;

// `Files` over the disk, through `node:fs`. Paths are absolute.
export function createNodeFiles(): Files {
  return {
    read: (file) => readFile(file, 'utf8'),
    write: writeAtomically,
    list: listFolder,
    watch: watchDebounced,
  };
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
  return {
    close: () => {
      watcher.close();
      for (const timer of pending.values()) {
        clearTimeout(timer);
      }
      pending.clear();
    },
  };
}

// FSEvents reports a change to the watched folder itself (its contents
// changing, or its own creation) under the folder's own name.
function isWatchedFolderItself(folder: string, name: string): boolean {
  return name === path.basename(folder) && !existsSync(path.join(folder, name));
}

function slashJoined(relative: string): string {
  return relative.split(path.sep).join('/');
}
