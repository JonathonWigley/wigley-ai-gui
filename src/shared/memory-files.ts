import type { FileEntry, Files, FileStat } from '../contracts/files';
import { resolveInside } from './scoped-files';

// `Files` held in memory, the double plugin tests use. `write`, `rename`,
// `trash` and `remove` report each changed file's path to the watches over it
// at once, with no debounce, so a test drives a save by writing; a rename
// reports each moved file's old path and its new one. A watch never fails, so
// it never calls its `onError`. There are no links, so `realPath` returns the
// path's stored spelling. Names are case-sensitive.
export interface MemoryFiles extends Files {
  // Deletes the file at `path`, or the folder at `path` and everything under
  // it; the folder holding `path` stays.
  remove(path: string): void;
}

interface MemoryWatch {
  folder: string;
  onChange: (path: string) => void;
}

// A folder exists when `makeFolder` made it, it held a file or folder that
// `rename`, `trash` or `remove` took away, or any file or made folder lies
// under it; the top folder always exists. A path's leading `/` is optional:
// `/a/b` and `a/b` name one file. Each call that meets a file where a folder
// must be, or a folder where a file must be, rejects with the code Node's fs
// gives.
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

  const hasFileAbove = (key: string): boolean => {
    for (let above = parentOf(key); above !== ''; above = parentOf(above)) {
      if (texts.has(above)) {
        return true;
      }
    }
    return false;
  };

  // Rejects as Node's recursive `mkdir` does when a file is at `key` or above
  // it.
  const requireFolderCanBeMade = (key: string, path: string) => {
    if (texts.has(key)) {
      throw codedError(`${path} is a file`, 'EEXIST');
    }
    if (hasFileAbove(key)) {
      throw codedError(`a file lies above ${path}`, 'ENOTDIR');
    }
  };

  // Keeps the folder holding `key` once `key` goes, as a folder on disk stays
  // when its last entry leaves.
  const keepParentOf = (key: string) => {
    const parent = parentOf(key);
    if (parent !== '') {
      madeFolders.add(parent);
    }
  };

  const removeKey = (target: string) => {
    if (statKey(target) !== null) {
      keepParentOf(target);
    }
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
      requireFolderCanBeMade(parentOf(file), parentOf(file));
      if (isFolder(file)) {
        throw codedError(`${path} is a folder`, 'EISDIR');
      }
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
      requireFolderCanBeMade(key, path);
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
      if (hasFileAbove(toKey)) {
        throw codedError(`a file lies above ${to}`, 'ENOTDIR');
      }
      if (!isFolder(parentOf(toKey))) {
        throw missingError(`no folder holds ${to}`);
      }
      if (relativeUnder(fromKey, toKey) !== null) {
        throw new Error(`${from} cannot move inside itself to ${to}`);
      }
      const moved = (key: string) => toKey + key.slice(fromKey.length);
      keepParentOf(fromKey);
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
  return codedError(message, 'ENOENT');
}

// An error carrying a Node fs `code`.
function codedError(message: string, code: string): Error {
  return Object.assign(new Error(message), { code });
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
