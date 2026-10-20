// One entry `Files.list` returns: `path` is relative to the folder listed,
// its segments joined with `/`.
export interface FileEntry {
  path: string;
  kind: 'file' | 'folder';
}

export interface FileWatch {
  // Stops the watch and drops any change not yet reported.
  close(): void;
}

// UTF-8 text files, read and written whole.
export interface Files {
  // Rejects when the file is missing, with an error naming the path.
  read(path: string): Promise<string>;
  // Atomic: writes a temp file `.<name>.<8 hex>.tmp` beside the target and
  // renames it over the target, creating missing parent folders first.
  write(path: string, text: string): Promise<void>;
  // The entries under `folder`, every level of them when `recursive`, in no
  // set order. A missing folder lists as `[]`.
  list(folder: string, options?: { recursive?: boolean }): Promise<FileEntry[]>;
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
