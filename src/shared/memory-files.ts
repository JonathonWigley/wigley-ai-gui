import type { FileEntry, Files } from '../contracts/files';
import { resolveInside } from './scoped-files';

// `Files` held in memory, the double plugin tests use. `write` and `remove`
// report each changed path to the watches over it at once, with no debounce,
// so a test drives a save by writing. A watch never fails, so it never calls
// its `onError`.
export interface MemoryFiles extends Files {
  // Deletes the file at `path`, or every file under the folder at `path`.
  remove(path: string): void;
}

interface MemoryWatch {
  folder: string;
  onChange: (path: string) => void;
}

// Folders are implied by the files' paths. A path's leading `/` is optional:
// `/a/b` and `a/b` name one file.
export function createMemoryFiles(): MemoryFiles {
  const texts = new Map<string, string>();
  const watches = new Set<MemoryWatch>();

  const report = (file: string) => {
    for (const watch of watches) {
      const relative = relativeUnder(watch.folder, file);
      if (relative !== null) {
        watch.onChange(relative);
      }
    }
  };

  return {
    read: async (path) => {
      const text = texts.get(keyOf(path));
      if (text === undefined) {
        throw new Error(`no file at ${path}`);
      }
      return text;
    },
    write: async (path, text) => {
      const file = keyOf(path);
      texts.set(file, text);
      report(file);
    },
    list: async (folder, options) =>
      listUnder(texts.keys(), keyOf(folder), options?.recursive ?? false),
    watch: (folder, onChange) => {
      const watch: MemoryWatch = { folder: keyOf(folder), onChange };
      watches.add(watch);
      return { close: () => watches.delete(watch) };
    },
    remove: (path) => {
      const target = keyOf(path);
      const removed = Array.from(texts.keys()).filter(
        (file) => file === target || relativeUnder(target, file) !== null,
      );
      for (const file of removed) {
        texts.delete(file);
        report(file);
      }
    },
  };
}

// The one spelling a path is stored under: `/`-led, normalized, or `` for the
// top folder. Throws on a path `resolveInside` refuses.
function keyOf(path: string): string {
  const key = resolveInside('', path.replace(/^\/+/, ''));
  if (key === null) {
    throw new Error(`${path} is outside /`);
  }
  return key;
}

// `file` relative to `folder`, or null when `file` is not under it.
function relativeUnder(folder: string, file: string): string | null {
  const prefix = `${folder}/`;
  return file.startsWith(prefix) ? file.slice(prefix.length) : null;
}

function listUnder(
  files: Iterable<string>,
  folder: string,
  recursive: boolean,
): FileEntry[] {
  const kinds = new Map<string, FileEntry['kind']>();
  for (const file of files) {
    const relative = relativeUnder(folder, file);
    if (relative === null) {
      continue;
    }
    const segments = relative.split('/');
    const folderDepth = recursive
      ? segments.length - 1
      : Math.min(1, segments.length - 1);
    for (let depth = 1; depth <= folderDepth; depth++) {
      kinds.set(segments.slice(0, depth).join('/'), 'folder');
    }
    if (recursive || segments.length === 1) {
      kinds.set(relative, 'file');
    }
  }
  return [...kinds].map(([path, kind]) => ({ path, kind }));
}
