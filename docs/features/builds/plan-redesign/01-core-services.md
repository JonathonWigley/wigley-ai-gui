# 01 — Files copy, Downloads folder and reveal

Status: not started
Type: Batch
Rung: hard · adds `Files.copy` and two `MainServices` members that 04 and 05 consume
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:
- modify `src/contracts/files.ts`
- modify `src/main/files/node-files.ts`
- modify `src/shared/memory-files.ts`
- modify `src/shared/scoped-files.ts`
- test `src/shared/scoped-files.test.ts`
- test `src/shared/files-contract.test-support.ts`
- modify `src/contracts/plugin.ts`
- modify `src/main/main.ts`
- modify `src/shared/plugin-part-harness.test-support.ts`
- modify `AGENTS.md`

Consumes:  nothing

Produces:
- On `Files` in `src/contracts/files.ts`, with this comment above it:
  ```ts
  // Copies the file at `from` to `to` by streaming, atomic through a temp file beside `to` as `write` is, creating
  // missing parent folders of `to`. Replaces a file at `to`. Rejects when `from` is missing (isMissingFile) and for a
  // folder at `from`.
  copy(from: string, to: string): Promise<void>;
  ```
- On `MainServices` in `src/contracts/plugin.ts`:
  ```ts
  downloadsDir: string;          // the OS Downloads folder; `<homeDir>/Downloads` in the self-test and a drive run
  revealPath(path: string): void; // shows the file in Finder or Explorer; logs and does nothing in the self-test and a drive run
  ```

Decisions:
- **Node adapter** (`createNodeFiles` in `node-files.ts`): `copy` makes the parent folders of `to`, copies `from`
  to the same temp file name `write` uses (`.<name>.<8 hex>.tmp` beside `to`) with `node:fs/promises` `copyFile`,
  then renames the temp file over `to` through the same retry `writeAtomically` uses (EPERM or EBUSY, waits
  `RENAME_RETRY_DELAYS_MS`). Reuse that rename-with-retry code: extract it from `writeAtomically` into one helper both
  call. A failed copy or rename deletes the temp file and rejects with the original error. Before the copy, `stat`
  `from`: a folder rejects with an error naming `from` and code `EISDIR`, and nothing is written. A missing `from`
  rejects with Node's own ENOENT error, which names the path, so `isMissingFile` is true.
- `copyFile` reads through the OS, so a Google Drive for desktop file that is not yet on disk is fetched as it is
  read. `copy` takes no timeout.
- **Memory adapter** (`createMemoryFiles` in `memory-files.ts`): `copy` reads the bytes of `from` and writes them to
  `to` as `writeBytes` does, so a watch on `to`'s folder reports `to`. A missing `from` rejects with the adapter's
  `missingError` naming `from`; a folder at `from` rejects with `codedError(<message naming from>, 'EISDIR')`.
- **Scoped view** (`scopedFiles` in `scoped-files.ts`): `copy` maps both paths through `inside`, as `rename` does.
  Update the comment above `scopedFiles` that lists every method to name `copy` (either path).
- `trackedFiles` in `src/shared/plugin-service-views.ts` spreads `files`, so it passes `copy` through unchanged: do
  not edit it.
- **Main wiring** (`main.ts`): add `'downloadsDir' | 'revealPath'` to the `Pick<MainServices, …>` that
  `ModeServices.forWindow` returns.
  - `liveServices().forWindow`: `downloadsDir: app.getPath('downloads')`,
    `revealPath: (file) => shell.showItemInFolder(file)`.
  - `offscreenRunServices(...).forWindow` (the self-test and a drive run):
    `downloadsDir: path.join(context.homeDir, 'Downloads')`, and `revealPath` calls
    `context.log('main', `path not revealed in ${runName}: ${file}`)`, the same form as the link line above it.
  - The `...windowServices` spread at the services object (about line 1346) carries both to every plugin. `main.ts`
    already imports `app` and `shell` from `electron` and `path` from `node:path`.
- **Part harness** (`plugin-part-harness.test-support.ts`, the main services object at about line 1062): add
  `downloadsDir: '/home/Downloads'` and `revealPath() {}`. A test that checks a reveal passes its own `revealPath`
  through `services`, which the `...replaced` spread already lets it do.
- `src/plugins/claude-code/main/start.test.ts` passes a partial `services` to the harness: no edit.
- **`AGENTS.md`** § Architecture, the "An ambient service" bullet (line 1080): add "the Downloads folder and showing a
  file in Finder or Explorer (`downloadsDir` and `revealPath`, main only)" to the list of services, before "how the
  app was started".
- Every other object that types itself `Files` or `MainServices` fails to compile until it has the new members: fix
  each one the compiler names. The tree holds these today: the `Files` literal in `scoped-files.test.ts` (about line
  200, the recording fake), `createNodeFiles`, `createMemoryFiles`, `scopedFiles`; and the `MainServices` objects in
  `main.ts` and the part harness.

GIVEN a file at `from` and nothing at `to`'s folder WHEN `copy(from, to)` runs THEN `to` holds the same bytes, its
parent folders exist, and `from` is unchanged.
GIVEN a file at `to` WHEN `copy(from, to)` runs THEN `to` holds `from`'s bytes.
GIVEN no file at `from` WHEN `copy` runs THEN it rejects, `isMissingFile` is true, the message names `from`, and
nothing is at `to`.
GIVEN a folder at `from` WHEN `copy` runs THEN it rejects and nothing is at `to`.
GIVEN a scoped view WHEN `copy` names a path outside its root THEN it rejects `<path> is outside <root>` before any
I/O.

Tests:
- In `describeFilesContract` (`files-contract.test-support.ts`), which the Node and memory adapters both run:
  - add a row to the `'$method of a missing file rejects as a missing file naming it'` table:
    `{ method: 'copy', call: (files, file) => files.copy(file, `${file}.copy`) }`.
  - `copy_File_CopiesBytesAndMakesParents` — writes bytes `[0, 255, 137]` to `a/one.bin`, copies to `b/c/two.bin`;
    `readBytes` of `b/c/two.bin` is `[0, 255, 137]`, `readBytes` of `a/one.bin` is still `[0, 255, 137]`, and
    `list(at('b/c'))` is `[{ path: 'two.bin', kind: 'file' }]` (no temp file is left).
  - `copy_OntoExistingFile_ReplacesIt` — `a.txt` holds `new`, `b.txt` holds `old`; after `copy(a, b)`, `read(b)` is
    `new`.
  - `copy_Folder_RejectsAndWritesNothing` — `makeFolder(at('top/f'))`; `copy(at('top/f'), at('out/x'))` rejects;
    `stat(at('out'))` is null.
- In `scoped-files.test.ts`, add a row for `copy` to the table of calls that reject outside the root (the table that
  holds `scoped.readEnd('../e', 4)` at about line 63): `scoped.copy('../e', 'in.txt')`.
- No test for the `main.ts` wiring: it is Electron glue that task 11 sees in the live run.

Done when: compiles (`npm run typecheck`); the test gate runs `src/shared/memory-files.test.ts`,
`src/main/files/node-files.test.ts` and `src/shared/scoped-files.test.ts`.
Commit:    one commit for the group

## Proof

