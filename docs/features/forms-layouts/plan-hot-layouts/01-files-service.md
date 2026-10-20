# 01 — Files service: read, atomic write, list, watch

Status: not started
Type: Batch
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     create `src/contracts/files.ts` · create `src/main/files/node-files.ts` · create `src/shared/memory-files.ts`
           · create `src/shared/scoped-files.ts` · modify `scripts/check-layers.mts`
           · test `src/main/files/node-files.test.ts` · test `src/shared/scoped-files.test.ts`
Consumes:  nothing
Produces:  in `src/contracts/files.ts`:
           `export interface FileEntry { path: string; kind: 'file' | 'folder' }`
           `export interface FileWatch { close(): void }`
           `export interface Files {`
           `  read(path: string): Promise<string>;`
           `  write(path: string, text: string): Promise<void>;`
           `  list(folder: string, options?: { recursive?: boolean }): Promise<FileEntry[]>;`
           `  watch(folder: string, onChange: (path: string) => void): FileWatch;`
           `}`
           `export function createNodeFiles(): Files` in `src/main/files/node-files.ts`
           `export interface MemoryFiles extends Files { remove(path: string): void }` and
           `export function createMemoryFiles(): MemoryFiles` in `src/shared/memory-files.ts`
           `export function scopedFiles(files: Files, root: string): Files` in `src/shared/scoped-files.ts`
Decisions: the AGENTS.md `files/` line names this service; plan B adds rename and trash to the same contract (round 2)
           · async, UTF-8 text only · the watch debounce lives in the Node adapter (design review, locality)
Commit:    one commit for the group

## Contract semantics (the doc comments on `Files` say these)

- `read` rejects when the file is missing, with an error naming the path.
- `write` is atomic: it writes a temp file `.<name>.<8 hex>.tmp` beside the target and renames it over the target,
  creating missing parent folders first.
- `list` returns the entries under `folder`, each `path` relative to `folder` and joined with `/`. Recursive lists
  every level. A missing folder returns `[]`. The order is unspecified.
- `watch` watches `folder` recursively and calls `onChange` with the changed path relative to `folder`. It reports a
  burst of events for one path once, after 100 ms with no further event for it (the Node adapter, since editors save
  through a rename and FSEvents repeats events). It drops paths whose last segment matches the temp-file pattern, so a write reports only its target. It creates the folder when it is missing, so a watch never fails on
  a fresh data folder. `close` stops it and drops any pending report.

## Adapters

- **Node** (`createNodeFiles`): `node:fs/promises` and `fs.watch(folder, { recursive: true })`. Electron 44 bundles
  Node 24, which watches folders recursively on macOS through FSEvents. Paths are absolute.
- **Memory** (`createMemoryFiles`): a map of path → text, with folders implied by paths. `write` calls the listeners
  of every watch whose folder contains the path at once, with no debounce, so a test drives a "save" by writing. `remove` deletes a file or a folder's
  files and reports each removed path the same way, since a user deletes layouts by hand. It is the double plugin
  tests use.
- **Scoped** (`scopedFiles(files, root)`): each path is relative to `root`, and the wrapper resolves it under `root`
  before calling `files`. A path that resolves outside `root` (`..`, an absolute path) fails with
  `Error('<path> is outside <root>')` before any I/O: `read`, `write` and `list` return a rejected promise, and
  `watch` throws. `list` and `watch` report paths relative to the folder asked
  for, as the inner service does.

## Layer check (`scripts/check-layers.mts`)

All of this plan's layer edits land here, so later tasks never share the file:

- `src/main/files`: layers `src/contracts`, packages `node:`.
- `src/main/data-protocol`: layers `src/contracts`, `src/shared`; packages `electron`, `node:`.
- `src/plugins/forms/layouts`: no layers, no packages.
- `src/main/main.ts`'s entry adds `src/main/files` and `src/main/data-protocol`.
- `src/plugins/forms/page` and `src/plugins/forms/main` entries add `src/plugins/forms/layouts`.
- The file walk checks `.js` files as well as `.ts`. `layerOf` and `layerOfImport` already take any extension.
  A specifier with a Vite query (`./x.js?raw`) is resolved without its query.

GIVEN a folder holding `a.txt` and `sub/b.txt` WHEN `list(folder, { recursive: true })` runs THEN it returns
`a.txt`, `sub` (folder) and `sub/b.txt`.

Tests (against a fresh `mkdtemp` folder, removed after each test):

- `node-files.test.ts`:
  - `write_MissingParents_CreatesThemAndWritesText`: write `x/y/z.txt`, then read it back.
  - `write_ExistingFile_LeavesNoTempFileBehind`: after two writes, the folder lists `z.txt` alone.
  - `list_MissingFolder_ReturnsEmpty`.
  - `list_Recursive_ReturnsRelativeSlashPaths`: the GIVEN/WHEN/THEN above.
  - `read_MissingFile_RejectsNamingThePath`.
  - `watch_TwoWritesInABurst_ReportsOnce`: write the same file twice within 20 ms, wait 300 ms, and expect exactly one
    report, `z.txt`. This is real time with a generous margin, the one place the adapter's own timer is the subject.
- `scoped-files.test.ts`, over `createMemoryFiles()`:
  - `read_PathInsideRoot_ReadsUnderRoot`.
  - `write_ParentEscape_RejectsBeforeWriting`: `../x` rejects, and the inner files hold nothing.
  - `write_AbsolutePath_Rejects`.
  - `watch_ParentEscape_Throws`.
  - `watch_WriteUnderFolder_ReportsRelativePath`: watching `layouts` and writing `layouts/a/layout.js` reports
    `a/layout.js`.

Done when: compiles; `npm run lint` passes; the test gate runs the tests above.

## Cold-read rulings

- `src/shared` and `src/main/plugins` may import no `node:` package, and `data-url.ts` also runs in the page. So
  `memory-files.ts`, `scoped-files.ts` and task 03's `data-url.ts` and `main-api.ts` handle paths as `/`-joined
  strings: they normalize `.` and `..` segments, and treat a leading `/` as absolute. The Node adapter alone uses
  `node:path`. `scoped-files.ts` exports `export function resolveInside(root: string, path: string): string | null`,
  the one normalizer, and `data-url.ts` reuses it.

## Proof
