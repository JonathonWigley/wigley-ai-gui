import type { Clock } from '../contracts/ambient';
import type { FileEntry, Files, FileStat } from '../contracts/files';
import { relativeSegments } from './scoped-files';

// `Files` held in memory, the double plugin tests use. `write`, `writeBytes`,
// `append`, `rename`, `trash` and `remove` report each changed file's path to
// the watches over it at once, with no debounce, so a test drives a save by
// writing; a rename reports each moved file's old path and its new one. A
// watch with `recursive: false` reports a change under a subfolder as the
// subfolder's name, once per call. A watch never fails, so it never calls its
// `onError`. There are no links, so `stat` reports none and `realPath` returns
// the path's stored spelling. Names are case-sensitive.
export interface MemoryFiles extends Files {
  // Deletes the file at `path`, or the folder at `path` and everything under
  // it; the folder holding `path` stays.
  remove(path: string): void;
  // The file's bytes as `writeBytes` stored them, or its text as UTF-8.
  // Throws, as `isMissingFile` tells, when the file is missing.
  bytesOf(path: string): Uint8Array;
}

interface MemoryWatch {
  folder: string;
  onChange: (path: string) => void;
  recursive: boolean;
}

// A folder exists when `makeFolder` made it, it held a file or folder that
// `rename`, `trash` or `remove` took away, or any file or made folder lies
// under it; the top folder always exists. A path's leading `/` is optional:
// `/a/b` and `a/b` name one file. Each call that meets a file where a folder
// must be, or a folder where a file must be, rejects with the code Node's fs
// gives. Each `write`, `writeBytes` and `append` stamps the file's `modified`
// time with `clock.now()`, or `0` with no clock; `rename` carries a file's
// stamp to its new path.
export function createMemoryFiles(clock?: Clock): MemoryFiles {
  const contents = new Map<string, string | Uint8Array>();
  const modifiedTimes = new Map<string, number>();
  const madeFolders = new Set<string>();
  const watches = new Set<MemoryWatch>();

  // Reports the files one change touched to each watch over them, each path
  // once; a watch that is not recursive hears a change under a subfolder as
  // the subfolder's name, as Node's non-recursive `fs.watch` reports it.
  const report = (files: string[]) => {
    for (const watch of watches) {
      const reported = new Set<string>();
      for (const file of files) {
        const relative = relativeUnder(watch.folder, file);
        if (relative !== null) {
          reported.add(watch.recursive ? relative : relative.split('/')[0]);
        }
      }
      for (const changed of reported) {
        watch.onChange(changed);
      }
    }
  };

  const isFolder = (key: string): boolean =>
    key === '' ||
    madeFolders.has(key) ||
    [...contents.keys(), ...madeFolders].some(
      (inside) => relativeUnder(key, inside) !== null,
    );

  const statKey = (key: string): FileStat | null => {
    if (contents.has(key)) {
      return { isFolder: false, isLink: false };
    }
    return isFolder(key) ? { isFolder: true, isLink: false } : null;
  };

  const hasFileAbove = (key: string): boolean => {
    for (let above = parentOf(key); above !== ''; above = parentOf(above)) {
      if (contents.has(above)) {
        return true;
      }
    }
    return false;
  };

  // Rejects as Node's recursive `mkdir` does when a file is at `key` or above
  // it.
  const requireFolderCanBeMade = (key: string, path: string) => {
    if (contents.has(key)) {
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
    const removed = atOrUnder(contents.keys(), target);
    for (const file of removed) {
      contents.delete(file);
      modifiedTimes.delete(file);
    }
    report(removed);
  };

  const contentOf = (path: string): string | Uint8Array => {
    const content = contents.get(keyOf(path));
    if (content === undefined) {
      throw missingError(`no file at ${path}`);
    }
    return content;
  };

  // A copy, so the caller may change it without changing the stored file.
  const bytesOf = (path: string): Uint8Array => {
    const content = contentOf(path);
    return typeof content === 'string'
      ? new TextEncoder().encode(content)
      : content.slice();
  };

  const textOf = (path: string): string => {
    const content = contentOf(path);
    return typeof content === 'string'
      ? content
      : new TextDecoder('utf-8').decode(content);
  };

  // Stores `content` at `path` and reports it, as `write`, `writeBytes` and
  // `append` all do.
  const store = (path: string, content: string | Uint8Array) => {
    const file = keyOf(path);
    requireFolderCanBeMade(parentOf(file), parentOf(file));
    if (isFolder(file)) {
      throw codedError(`${path} is a folder`, 'EISDIR');
    }
    contents.set(file, content);
    modifiedTimes.set(file, clock?.now() ?? 0);
    report([file]);
  };

  return {
    read: async (path) => textOf(path),
    modified: async (path) => {
      textOf(path);
      return modifiedTimes.get(keyOf(path)) ?? 0;
    },
    readStart: async (path, maxBytes) => {
      const bytes = new TextEncoder().encode(textOf(path)).slice(0, maxBytes);
      // `stream` holds back a multi-byte character the cut splits instead of
      // emitting U+FFFD.
      return new TextDecoder('utf-8').decode(bytes, { stream: true });
    },
    write: async (path, text) => store(path, text),
    // A copy, so the caller may reuse its buffer.
    writeBytes: async (path, bytes) => store(path, bytes.slice()),
    append: async (path, text) => {
      const before = contents.has(keyOf(path)) ? textOf(path) : '';
      store(path, before + text);
    },
    readBytes: async (path) => bytesOf(path),
    list: async (folder, options) =>
      listUnder(
        contents.keys(),
        madeFolders,
        keyOf(folder),
        options?.recursive ?? false,
      ),
    watch: (folder, onChange, options) => {
      const watch: MemoryWatch = {
        folder: keyOf(folder),
        onChange,
        recursive: options?.recursive ?? true,
      };
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
      const movedContents = [...contents].filter(([file]) =>
        isAtOrUnder(fromKey, file),
      );
      for (const [file, content] of movedContents) {
        contents.delete(file);
        contents.set(moved(file), content);
        modifiedTimes.set(moved(file), modifiedTimes.get(file) ?? 0);
        modifiedTimes.delete(file);
      }
      report(movedContents.flatMap(([file]) => [file, moved(file)]));
    },
    trash: async (path) => {
      const key = keyOf(path);
      if (statKey(key) === null) {
        throw missingError(`nothing at ${path}`);
      }
      removeKey(key);
    },
    remove: (path) => removeKey(keyOf(path)),
    bytesOf,
  };
}

// The one spelling a path is stored under: `/`-led, normalized, or `` for the
// top folder. Throws on a path `relativeSegments` refuses.
function keyOf(path: string): string {
  const segments = relativeSegments(path.replace(/^\/+/, ''));
  if (segments === null) {
    throw new Error(`${path} is outside /`);
  }
  return segments.length === 0 ? '' : `/${segments.join('/')}`;
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
