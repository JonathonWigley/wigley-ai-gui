import type { Disposable } from './disposable';

// One entry `Files.list` returns: `path` is relative to the folder listed,
// its segments joined with `/`.
export interface FileEntry {
  path: string;
  kind: 'file' | 'folder';
}

// What `Files.stat` finds at a path.
export interface FileStat {
  // Of what the path leads to, its links followed.
  isFolder: boolean;
  // Whether the path itself is a symlink.
  isLink: boolean;
}

// `dispose` stops the watch and drops any change not yet reported; a second
// `dispose` does nothing.
export interface FileWatch extends Disposable {}

export interface WatchOptions {
  // Whether the watch covers every folder under the watched one; true when
  // left out.
  recursive?: boolean;
  // Called once when watching fails after it started.
  onError?(error: unknown): void;
  // Called when the watch may have dropped changes, so the caller compares
  // what it watches against what it last read. The Node adapter calls it on
  // macOS 100 ms after the last of a burst of other watches in the process
  // opening or closing; the memory adapter never calls it.
  onMissed?(): void;
}

// UTF-8 text files read whole or by their first or last bytes, written whole
// or appended to, any file read or written whole as bytes, and the folders that
// hold them.
export interface Files {
  // Rejects when the file is missing with an error naming the path, which
  // `isMissingFile` tells from every other failure.
  read(path: string): Promise<string>;
  // Epoch milliseconds of the file's last change. Rejects when the file is
  // missing, naming the path.
  modified(path: string): Promise<number>;
  // The file's first `maxBytes` bytes as UTF-8, a character the cut splits
  // left out; the whole file when shorter. Rejects when the file is missing,
  // naming the path.
  readStart(path: string, maxBytes: number): Promise<string>;
  // The file's last `maxBytes` bytes as UTF-8, a character the cut splits at
  // the start left out; the whole file when shorter. Rejects when the file is
  // missing, naming the path.
  readEnd(path: string, maxBytes: number): Promise<string>;
  // Atomic: writes a temp file `.<name>.<8 hex>.tmp` beside the target and
  // renames it over the target, creating missing parent folders first. The
  // Node adapter tries a rename that fails with EPERM or EBUSY (a file another
  // process holds open, as on Windows) again, up to 4 more times, 10, 20, 40
  // and 80 ms apart, then rejects with the last error.
  write(path: string, text: string): Promise<void>;
  // `write` for bytes: atomic through the same temp file, its rename tried
  // again as `write`'s is, creating missing parent folders first.
  writeBytes(path: string, bytes: Uint8Array): Promise<void>;
  // Appends `text` to the file, creating it (and its folders, as `write` does)
  // when missing. Not atomic: two appends to one file not awaited in turn may
  // interleave, so a caller orders its own appends.
  append(path: string, text: string): Promise<void>;
  // `read` for bytes: the file's bytes exactly as stored. Rejects when the
  // file is missing, naming the path.
  readBytes(path: string): Promise<Uint8Array>;
  // The entries under `folder`, every level of them when `recursive`, in no
  // set order. A missing folder lists as `[]`.
  list(folder: string, options?: { recursive?: boolean }): Promise<FileEntry[]>;
  // What is at `path`, following symlinks; null when nothing is there, as for
  // a link whose target is missing.
  stat(path: string): Promise<FileStat | null>;
  // `path` with every symlink resolved. Rejects, as `isMissingFile` tells,
  // when nothing is there.
  realPath(path: string): Promise<string>;
  // Makes the folder and any missing parents; an existing folder is no error.
  makeFolder(path: string): Promise<void>;
  // Moves a file or a folder. Rejects with `<to> already exists` when anything
  // is at `to`, changing nothing; makes no parent folders of `to`, and rejects
  // with code `ENOTDIR` when a file lies above `to`. A rename
  // that only changes the case of a name on a case-insensitive volume moves
  // the entry. The Node adapter moves a file by hard link, so a file that
  // appears at `to` mid-move is never replaced; a folder, a symlink, or a file
  // on a volume without hard links is checked then renamed, and something that
  // appears at `to` between the check and the rename is replaced.
  rename(from: string, to: string): Promise<void>;
  // Copies the file at `from` to `to` by streaming, atomic through a temp file beside `to` as `write` is, creating
  // missing parent folders of `to`. Replaces a file at `to`. Rejects when `from` is missing (isMissingFile), and with
  // code `EISDIR` for a folder at `from` or at `to`.
  copy(from: string, to: string): Promise<void>;
  // Moves a file or a folder to the OS Trash (under the self-test the Node
  // adapter deletes it for good).
  trash(path: string): Promise<void>;
  // Deletes the file at `path` for good; nothing there is no error. Rejects for a
  // folder, keeping it.
  deleteFile(path: string): Promise<void>;
  // Deletes the folder at `path` and everything in it for good, keeping the
  // folder that holds it; nothing there is no error.
  removeFolder(path: string): Promise<void>;
  // Watches `folder`, and every folder under it unless `recursive` is false,
  // calling `onChange` with the changed path relative to `folder`, joined with
  // `/`; with `recursive: false` it reports only entries directly in
  // `folder`, a change inside a subfolder reported by the subfolder's own name
  // (by the Node adapter when the OS reports one). The Node adapter reports a
  // burst of events for one path once, 100 ms after its last event; the
  // memory adapter reports each change at once. A `write` reports its target
  // and never its temp file; the Node adapter reports the target also when
  // the OS reports only the temp file's name, once the target exists. Creates
  // `folder` when it is missing. When watching fails the watch disposes
  // itself, dropping any change not yet reported, and calls the options' `onError` once; with no
  // `onError` it disposes itself silently. A failure to start watching,
  // creating `folder` or starting the watcher, throws from `watch` and never
  // reaches `onError`.
  watch(
    folder: string,
    onChange: (path: string) => void,
    options?: WatchOptions,
  ): FileWatch;
}

// Whether `error` names a missing file or folder: any error carrying Node's
// `code: 'ENOENT'`, as a Node fs call throws and as `Files.read`,
// `Files.realPath` and `Files.rename` reject with in every adapter.
export function isMissingFile(error: unknown): boolean {
  return (
    error instanceof Error && (error as { code?: unknown }).code === 'ENOENT'
  );
}

// `bytes` from its first byte that is not a UTF-8 continuation byte
// (`10xxxxxx`), so a character a cut split at the start is left out.
export function withoutLeadingContinuationBytes(bytes: Uint8Array): Uint8Array {
  let first = 0;
  while (first < bytes.length && (bytes[first] & 0xc0) === 0x80) {
    first += 1;
  }
  return bytes.subarray(first);
}

// The text at `path`; null when nothing is there.
export async function readIfPresent(
  files: Pick<Files, 'read'>,
  path: string,
): Promise<string | null> {
  try {
    return await files.read(path);
  } catch (error) {
    if (isMissingFile(error)) {
      return null;
    }
    throw error;
  }
}
