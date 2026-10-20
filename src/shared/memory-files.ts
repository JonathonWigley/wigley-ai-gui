import type { FileEntry, Files, FileStat } from '../contracts/files';
import { resolveInside } from './scoped-files';

// `Files` held in memory, the double plugin tests use. `write`, `rename`,
// `trash` and `remove` report each changed file's path to the watches over it
// at once, with no debounce, so a test drives a save by writing; a rename
// reports each moved file's old path and its new one. A watch never fails, so
// it never calls its `onError`. There are no links, so `realPath` returns the
// path's stored spelling.
export interface MemoryFiles extends Files {
  // Deletes the file at `path`, or every file and made folder under the
  // folder at `path`.
  remove(path: string): void;
}

interface MemoryWatch {
  folder: string;
  onChange: (path: string) => void;
}

// A folder exists when `makeFolder` made it or any file or made folder lies
// under it; the top folder always exists. A path's leading `/` is optional:
// `/a/b` and `a/b` name one file.
export function createMemoryFiles(): MemoryFiles {
  const texts = new Map<string, string>();
  const madeFolders = new Set<string>();
  const watches = new Set<MemoryWatch>();

  const report = (file: string) => {
    for (const watch of watches) {
      const relative = relativeUnder(watch.folder, file);
      if (relative !== null) {
        watch.onChange(relative);
      }
    }
  };

  const isFolder = (key: string): boolean =>
    key === '' ||
    madeFolders.has(key) ||
    [...texts.keys(), ...madeFolders].some(
      (inside) => relativeUnder(key, inside) !== null,
    );

  const statKey = (key: string): FileStat | null => {
    if (texts.has(key)) {
      return { isFolder: false };
    }
    return isFolder(key) ? { isFolder: true } : null;
  };

  const removeKey = (target: string) => {
    for (const folder of atOrUnder(madeFolders, target)) {
      madeFolders.delete(folder);
    }
    for (const file of atOrUnder(texts.keys(), target)) {
      texts.delete(file);
      report(file);
    }
  };

  return {
    read: async (path) => {
      const text = texts.get(keyOf(path));
      if (text === undefined) {
        throw missingError(`no file at ${path}`);
      }
      return text;
    },
    write: async (path, text) => {
      const file = keyOf(path);
      texts.set(file, text);
      report(file);
    },
    list: async (folder, options) =>
      listUnder(
        texts.keys(),
        madeFolders,
        keyOf(folder),
        options?.recursive ?? false,
      ),
    watch: (folder, onChange) => {
      const watch: MemoryWatch = { folder: keyOf(folder), onChange };
      watches.add(watch);
      return { close: () => watches.delete(watch) };
    },
    stat: async (path) => statKey(keyOf(path)),
    realPath: async (path) => {
      const key = keyOf(path);
      if (statKey(key) === null) {
        throw missingError(`nothing at ${path}`);
      }
      return key === '' ? '/' : key;
    },
    makeFolder: async (path) => {
      const key = keyOf(path);
      if (texts.has(key)) {
        throw Object.assign(new Error(`${path} is a file`), {
          code: 'EEXIST',
        });
      }
      if (key !== '') {
        madeFolders.add(key);
      }
    },
    rename: async (from, to) => {
      const fromKey = keyOf(from);
      const toKey = keyOf(to);
      if (statKey(toKey) !== null) {
        throw new Error(`${to} already exists`);
      }
      if (statKey(fromKey) === null) {
        throw missingError(`nothing at ${from}`);
      }
      if (!isFolder(parentOf(toKey))) {
        throw missingError(`no folder holds ${to}`);
      }
      if (relativeUnder(fromKey, toKey) !== null) {
        throw new Error(`${from} cannot move inside itself to ${to}`);
      }
      const moved = (key: string) => toKey + key.slice(fromKey.length);
      for (const folder of atOrUnder(madeFolders, fromKey)) {
        madeFolders.delete(folder);
        madeFolders.add(moved(folder));
      }
      const movedTexts = [...texts].filter(([file]) =>
        isAtOrUnder(fromKey, file),
      );
      for (const [file, text] of movedTexts) {
        texts.delete(file);
        texts.set(moved(file), text);
        report(file);
        report(moved(file));
      }
    },
    trash: async (path) => {
      const key = keyOf(path);
      if (statKey(key) === null) {
        throw missingError(`nothing at ${path}`);
      }
      removeKey(key);
    },
    remove: (path) => removeKey(keyOf(path)),
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

// An error `isMissingFile` accepts, as a Node fs call's `ENOENT`.
function missingError(message: string): Error {
  return Object.assign(new Error(message), { code: 'ENOENT' });
}

// The folder holding `key`: `` for a key one level under the top folder.
function parentOf(key: string): string {
  return key.slice(0, key.lastIndexOf('/'));
}

// `file` relative to `folder`, or null when `file` is not under it.
function relativeUnder(folder: string, file: string): string | null {
  const prefix = `${folder}/`;
  return file.startsWith(prefix) ? file.slice(prefix.length) : null;
}

function isAtOrUnder(target: string, key: string): boolean {
  return key === target || relativeUnder(target, key) !== null;
}

// A copy of the keys at `target` or under it, so the caller may change the
// collection it came from.
function atOrUnder(keys: Iterable<string>, target: string): string[] {
  return Array.from(keys).filter((key) => isAtOrUnder(target, key));
}

function listUnder(
  files: Iterable<string>,
  madeFolders: Iterable<string>,
  folder: string,
  recursive: boolean,
): FileEntry[] {
  const kinds = new Map<string, FileEntry['kind']>();
  const addUnder = (key: string, kind: FileEntry['kind']) => {
    const relative = relativeUnder(folder, key);
    if (relative === null) {
      return;
    }
    const segments = relative.split('/');
    const enclosingDepth = recursive
      ? segments.length - 1
      : Math.min(1, segments.length - 1);
    for (let depth = 1; depth <= enclosingDepth; depth++) {
      kinds.set(segments.slice(0, depth).join('/'), 'folder');
    }
    if (recursive || segments.length === 1) {
      kinds.set(relative, kind);
    }
  };
  for (const file of files) {
    addUnder(file, 'file');
  }
  for (const made of madeFolders) {
    addUnder(made, 'folder');
  }
  return [...kinds].map(([path, kind]) => ({ path, kind }));
}
