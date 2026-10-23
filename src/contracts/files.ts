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

export interface FileWatch {
  // Stops the watch and drops any change not yet reported.
  close(): void;
}

// UTF-8 text files read whole or by their first bytes, any file read or
// written whole as bytes, and the folders that hold them.
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
  // Atomic: writes a temp file `.<name>.<8 hex>.tmp` beside the target and
  // renames it over the target, creating missing parent folders first.
  write(path: string, text: string): Promise<void>;
  // `write` for bytes: atomic through the same temp file, creating missing
  // parent folders first.
  writeBytes(path: string, bytes: Uint8Array): Promise<void>;
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
  // is at `to`, changing nothing; makes no parent folders of `to`. A rename
  // that only changes the case of a name on a case-insensitive volume moves
  // the entry. The Node adapter moves a file by hard link, so a file that
  // appears at `to` mid-move is never replaced; a folder, a symlink, or a file
  // on a volume without hard links is checked then renamed, and something that
  // appears at `to` between the check and the rename is replaced.
  rename(from: string, to: string): Promise<void>;
  // Moves a file or a folder to the OS Trash (under the self-test the Node
  // adapter deletes it for good).
  trash(path: string): Promise<void>;
  // Watches `folder` and every folder under it, calling `onChange` with the
  // changed path relative to `folder`, joined with `/`. The Node adapter
  // reports a burst of events for one path once, 100 ms after its last event;
  // the memory adapter reports each change at once. A temp file `write` makes
  // never reports, so a write reports only its target. Creates `folder` when it
  // is missing. When watching fails the watch closes, dropping any change not
  // yet reported, and calls `onError` once; with no `onError` it closes
  // silently. A failure to start watching, creating `folder` or starting the
  // watcher, throws from `watch` and never reaches `onError`.
  watch(
    folder: string,
    onChange: (path: string) => void,
    onError?: (error: unknown) => void,
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

// The text at `path`; null when nothing is there.
export async function readIfPresent(
  files: Files,
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
