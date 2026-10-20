# 01 — Core files and processes services

Status: not started
Type: Batch
Wave: 1 · Depends on: none (plan A landed, Preconditions)
Plan: [plan.md](plan.md)

Three items share one spec: the `files` seam extended in place, the new `processes` service, and the layer table every
later task of this plan needs.

`src/contracts/files.ts` already exists (commit `191f4d7`, the forms layouts run): `read`, an atomic `write`, a
`list` of `{ path, kind }` entries, and a folder `watch`, with `MainServices.files` filled by `main.ts`. This task adds
`stat`, `realPath`, `makeFolder`, `rename` and `trash` to it and to every `Files` implementation in the tree, and
keeps `read`, `write`, `list` and `watch` as they are (plan.md Run log § Rulings, Files seam).

Files:
- modify `src/contracts/files.ts`
- create `src/contracts/processes.ts`
- modify `src/contracts/plugin.ts` (`MainServices`)
- modify `src/main/files/node-files.ts` · test `src/main/files/node-files.test.ts` (modify)
- create `src/main/processes/node-processes.ts` · test `src/main/processes/node-processes.test.ts`
- modify `src/shared/memory-files.ts` · test `src/shared/memory-files.test.ts` (create)
- modify `src/shared/scoped-files.ts` · test `src/shared/scoped-files.test.ts` (modify)
- modify `src/shared/layouts/layout-registry.test.ts` (its two hand-built `Files` wrappers)
- create `src/shared/fake-processes.ts`
- modify `src/main/main.ts`
- modify `scripts/check-layers.mts`

Consumes:
- `Files`, `FileEntry`, `FileWatch`, `isMissingFile` in `src/contracts/files.ts` (tree)
- `createNodeFiles()` in `src/main/files/node-files.ts`, `createMemoryFiles()` and `MemoryFiles` in
  `src/shared/memory-files.ts`, `scopedFiles` and `resolveInside` in `src/shared/scoped-files.ts` (tree)
- `MainServices` in `src/contracts/plugin.ts` (tree, already holding `files: Files`), `isSelfTest`, the module-level
  `const files = createNodeFiles()` and the `createWindow` services literal in `src/main/main.ts` (tree)
- the `LAYERS` table in `scripts/check-layers.mts` (tree)

Produces:

```ts
// src/contracts/files.ts — added beside the existing members, each with a comment in the file's style
export interface FileStat { isFolder: boolean; }
// Files gains:
  // What is at `path`, following symlinks; null when nothing is there.
  stat(path: string): Promise<FileStat | null>;
  // `path` with every symlink resolved. Rejects, as `isMissingFile` tells, when nothing is there.
  realPath(path: string): Promise<string>;
  // Makes the folder and any missing parents; an existing folder is no error.
  makeFolder(path: string): Promise<void>;
  // Moves a file or a folder. Rejects with `<to> already exists` when anything is at `to`, changing nothing;
  // makes no parent folders of `to`.
  rename(from: string, to: string): Promise<void>;
  // Moves a file or a folder to the OS Trash (under the self-test the Node adapter deletes it for good).
  trash(path: string): Promise<void>;

// src/contracts/processes.ts — exactly as plan.md's File Structure
export interface ProcessResult { code: number; stdout: string; stderr: string; }
export interface ProcessRunner {
  run(command: string, args: string[], options?: { cwd?: string }): Promise<ProcessResult>;
}

// src/contracts/plugin.ts — MainServices gains
processes: ProcessRunner;

// src/main/files/node-files.ts — the signature changes; main.ts and node-files.test.ts are its callers
export interface NodeFilesOptions {
  // Moves a path to the OS Trash; main.ts passes Electron's shell.trashItem.
  trashItem: (path: string) => Promise<void>;
}
export function createNodeFiles(options: NodeFilesOptions): Files;

// src/main/processes/node-processes.ts
export function createNodeProcesses(): ProcessRunner;

// src/shared/memory-files.ts — `MemoryFiles` and `createMemoryFiles()` keep their names and `remove`; the object
// implements the five new members (Decisions)

// src/shared/scoped-files.ts — `scopedFiles(files, root): Files` implements the five new members (Decisions)

// src/shared/fake-processes.ts
export interface FakeRun { command: string; args: string[]; cwd: string | undefined; }
export class FakeProcesses implements ProcessRunner {
  // Every run, in call order.
  readonly runs: FakeRun[];
  // The result of each later run whose command and args equal these. An Error rejects the run;
  // a Promise holds the run open until the test settles it. A later script for the same
  // command and args replaces the earlier one.
  script(command: string, args: string[], result: ProcessResult | Error | Promise<ProcessResult>): void;
  run(command: string, args: string[], options?: { cwd?: string }): Promise<ProcessResult>;
}
```

Decisions:

- **`FileStat` holds `isFolder` only**: it is the one field task 06 reads (the script locator's "a file, not a
  folder", `list`'s "a missing path or a file → `[]`"). Agent-chat plan B adds its own fields later; this task plans
  none of them.
- **`read`, `write`, `list` and `watch` stay as the tree has them.** Task 06 maps `list` entries to `{ name, isFolder }`
  and watches a doc's folder, filtering on the file's name. `write` already writes a temp file beside the target and
  renames it over, creating parents; it replaces a symlink at `path` with a plain file, so task 06 writes to the
  doc's real path.
- **Trash goes through an injected function, not an `electron` import in the adapter**. `main.ts` builds `files` at
  module level as today, now `createNodeFiles({ trashItem })` with `trashItem` `(path) => shell.trashItem(path)`
  (Electron 44: `shell.trashItem(path): Promise<void>`, main process), or, when `isSelfTest`,
  `(path) => rm(path, { recursive: true })` from `node:fs/promises`: every self-test file sits in the temp home
  folder, and the user's Trash must not collect them (the self-test never reaches the user — `silentAlerts` sets the
  same rule). The adapter then imports `node:` only, and its Vitest test runs without Electron.
- **Stat** follows symlinks (`fs.stat`). `null` for `ENOENT` and `ENOTDIR`; any other error rejects.
- **realPath** is `fs.realpath`; it rejects when nothing is at `path` (task 06's guard resolves a new file's
  nearest existing folder instead).
- **makeFolder** is `mkdir` with `recursive: true`.
- **Rename never replaces**: `fs.lstat(to)` succeeding rejects with `Error('<to> already exists')` before any move
  (`lstat`, so a broken symlink at `to` counts). It moves folders too. A missing `from`, or a missing parent of `to`,
  rejects with Node's `ENOENT` error.
- **Trash** calls `options.trashItem(path)` and passes its result through.
- **Run** uses `child_process.spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })`, no shell, the
  app's environment. It collects stdout and stderr as UTF-8 strings with no size cap (`execFile`'s 1 MB default
  `maxBuffer` is under the 4 MB `index.json` the index script prints — design.md § Docs browser). It resolves on
  `close` with the exit code; a non-zero exit is a result, not a rejection. A program ended by a signal resolves
  with `code: -1`. A spawn `error` (such as `ENOENT`) rejects with an `Error` whose message is
  `Could not run <command>: <error message>`.
- **MemoryFiles** (`src/shared/memory-files.ts`, the double plugin tests already use; its path rules stay: a leading
  `/` optional, every path stored under `keyOf`'s `/`-led spelling). It gains a set of made folders beside the
  file texts:
  - A folder exists when `makeFolder` made it or any file or made folder lies under it; the top folder always exists.
  - `stat`: a file → `{ isFolder: false }`; an existing folder → `{ isFolder: true }`; else `null`.
  - `realPath`: the stored spelling when `stat` finds something there (`/` for the top folder), else rejects with an
    `ENOENT` error as `read` does. There are no links in memory.
  - `makeFolder` adds the path to the made folders; a file at the path rejects.
  - `rename` follows the Node adapter's rules: anything at `to` rejects with `<to> already exists`; a missing `from`,
    or a `to` whose parent folder does not exist, rejects with an `ENOENT` error; a folder moves its whole subtree,
    made folders included. Each moved file reports its old and its new path to the watches over them.
  - `trash` removes what `remove` removes, and also the made folders at and under the path; a missing path rejects
    with an `ENOENT` error.
  - `list` also lists made folders; `remove` also drops the made folders at and under its path.
  - The comment above `MemoryFiles` names `rename` and `trash` among the calls that report at once.
- **scopedFiles** (`src/shared/scoped-files.ts`) wraps every `Files` a plugin's `MainApi.data` gets, so it gains the
  five members under its existing rule (a refused path fails with `<path> is outside <root>` before any I/O):
  `stat`, `makeFolder`, `trash` resolve their path; `rename` resolves both; `realPath` resolves its path, takes the
  inner `realPath` of it and of `root`, and returns the first relative to the second (`` for `root` itself), and
  rejects `<path> is outside <root>` when a link leads out of `root`. Its header comment names the new members.
- **layout-registry.test.ts**: `withHeldReports` and `withFailingWatch` build `Files` by hand, so they spread
  `...inner` and override only `watch` (they would fail typecheck otherwise).
- **FakeProcesses** lives in `src/shared/fake-processes.ts`, beside `memory-files.ts` and `fake-agent-harness.ts`:
  the tree keeps its doubles in `src/shared`, named for what they are, with no test-only layer (main.ts runs the
  fake agent harness in the self-test). An unscripted run rejects with `FakeProcesses: no result scripted for
  <command> <args joined by one space>`. `runs` records every call, scripted or not, before the result.
- **Layer table** — every entry plan B needs lands here, so no later task edits `check-layers.mts`:
  - `src/main/files` stays `{ layers: ['src/contracts'], packages: ['node:'] }`.
  - `src/main/processes`: `{ layers: ['src/contracts'], packages: ['node:'] }`.
  - `src/main/main.ts`: add `src/main/processes` to its layers (`src/main/files` is listed already).
  - `src/plugins/docs/contract.ts`: `{ layers: ['src/contracts'], packages: [] }` (as the sessions and keys
    contracts).
  - `src/plugins/docs`: `{ layers: ['src/contracts', 'src/shared', 'src/plugins/docs/contract.ts',
    'src/plugins/sessions/contract.ts'], packages: [] }`. Task 04's files sit under `src/plugins` today and import
    only `src/contracts`, `src/shared` and their own folder; the check confirms they stay clean under the new entry.
  - `src/plugins/docs/main`: `{ layers: ['src/contracts', 'src/shared', 'src/plugins/docs',
    'src/plugins/docs/contract.ts', 'src/plugins/sessions/contract.ts'], packages: ['node:'] }`.
  - `src/plugins/docs/page`: `{ layers: ['src/contracts', 'src/shared', 'src/shared/page', 'src/plugins/docs',
    'src/plugins/docs/contract.ts', 'src/plugins/keys/contract.ts', 'src/plugins/sessions/contract.ts'],
    packages: [] }`.
  - `src/plugins/main.ts`: add `src/plugins/docs`, `src/plugins/docs/main`. `src/plugins/manifests.ts`: add
    `src/plugins/docs`. `src/plugins/page.ts`: add `src/plugins/docs`, `src/plugins/docs/page`.
  - `src/renderer/codemirror-vim` packages: add `@codemirror/lang-markdown`, `@codemirror/language-data`,
    `@codemirror/language`, `@codemirror/state`, `@codemirror/view`, `@lezer/highlight` (tasks 02 and 05 import
    them; the last four are installed under `codemirror` 6.0.2 today, `@codemirror/language` 6.13.1,
    `@codemirror/state` 6.7.6, `@codemirror/view` 6.43.14, `@lezer/highlight` 1.2.5 — measured at plan time,
    re-verify).
- `MainServices`' comment gains: `processes` runs the machine's programs; under the self-test, `files.trash` deletes
  for good.

GIVEN `b.md` exists WHEN `rename('a.md', 'b.md')` runs THEN it rejects with `<b.md path> already exists` and both
files keep their text
GIVEN the Node adapter WHEN `trash(path)` runs THEN `trashItem` receives `path`
GIVEN a scoped `Files` WHEN `rename('a', '../x')` runs THEN it rejects with `../x is outside <root>` and moves nothing
GIVEN a program that exits 3 WHEN `run` awaits it THEN it resolves `{ code: 3, … }`, not a rejection
GIVEN no program `wigley-no-such-program` WHEN `run` starts it THEN it rejects naming `wigley-no-such-program`

Tests (the Node tests use the existing file's temp `root` from `mkdtempSync(path.join(tmpdir(), 'wigley-node-files-'))`,
removed after each; compare paths through `realpathSync`, since macOS's `/var` is `/private/var`; names follow the
file's `method_Case_Result` style):

`src/main/files/node-files.test.ts` (the module-level `files` becomes `createNodeFiles({ trashItem })`, its
`trashItem` pushing each path to an array the tests read; the existing tests stay):
- `stat_MissingPath_Null` — `stat(<root>/none)` is `null`; `stat(<root>/a/b)` where `a` is a file is `null`.
- `stat_FileAndFolder_IsFolder` — a file gives `{ isFolder: false }`; `stat(root)` gives `{ isFolder: true }`; a
  symlink to a folder gives `{ isFolder: true }`.
- `realPath_Symlink_ReturnsTarget` — `link.md` → `real.md`: `realPath(link.md)` equals `realpathSync(real.md)`; a
  missing path rejects with an error `isMissingFile` accepts.
- `makeFolder_MissingParents_MakesThem` — `makeFolder(<root>/x/y/z)` then `statSync(<root>/x/y/z).isDirectory()` is
  true; a second call resolves.
- `rename_File_Moves` — `a.md` (`one`) to `b.md`: `b.md` reads `one`; `a.md` is gone.
- `rename_Folder_MovesItsFiles` — `s/ref.md` under folder `s`, renamed to `t`: `t/ref.md` reads its text.
- `rename_DestinationExists_RejectsAndKeepsBoth` — `a.md` (`one`), `b.md` (`two`): rejects with a message containing
  `already exists`; `a.md` reads `one`, `b.md` reads `two`.
- `trash_Path_HandsItToTrashItem` — `trash(<root>/a.md)`: the array is `[<root>/a.md]`.

`src/main/processes/node-processes.test.ts` (runs `process.execPath`, the Node running Vitest, with `-e`):
- `run_ExitThree_ReturnsCodeAndOutput` — script `process.stdout.write("out"); process.stderr.write("err");
  process.exit(3)`: resolves `{ code: 3, stdout: 'out', stderr: 'err' }`.
- `run_Cwd_RunsInTheFolder` — script `process.stdout.write(process.cwd())` with `cwd: dir`: `stdout` equals
  `realpathSync(dir)`.
- `run_LargeOutput_KeepsPastOneMegabyte` — script `process.stdout.write("x".repeat(2000000))`: `stdout.length` is
  `2000000`.
- `run_MissingProgram_RejectsNamingIt` — `run('wigley-no-such-program', [])` rejects with a message containing
  `wigley-no-such-program`.

`src/shared/memory-files.test.ts`:
- `rename_DestinationExists_RejectsAndKeepsBoth` — files `/h/a.md`, `/h/b.md`: `rename('/h/a.md', '/h/b.md')` rejects
  containing `already exists`; both keep their text.
- `rename_Folder_MovesSubtreeAndReports` — files `/h/s/SKILL.md`, `/h/s/ref.md`, a watch on `/h`:
  `rename('/h/s', '/h/t')`; `/h/t/ref.md` reads its text, `stat('/h/s')` is `null`, the watch got `s/SKILL.md`,
  `t/SKILL.md`, `s/ref.md`, `t/ref.md` in some order.
- `trash_Folder_RemovesItsFiles` — files `/h/s/SKILL.md`, `/h/s/ref.md`, `/h/x.md`: `trash('/h/s')`; `stat('/h/s')`
  and `stat('/h/s/ref.md')` are `null`; `/h/x.md` stays; `trash('/h/none')` rejects.
- `makeFolder_EmptyFolder_StatsAndLists` — `makeFolder('/h/e')`: `stat('/h/e')` is `{ isFolder: true }`;
  `list('/h')` is `[{ path: 'e', kind: 'folder' }]`.

`src/shared/scoped-files.test.ts`:
- `rename_DestinationOutsideRoot_RejectsBeforeMoving` — `rename('a.md', '../x')` rejects `../x is outside <ROOT>`;
  `a.md` still reads its text.
- `realPath_PathInsideRoot_ReturnsRelative` — a file `<ROOT>/a/b.md`: `realPath('a/./b.md')` is `a/b.md`.

`FakeProcesses` earns no test of its own: it is a scripted table its users' tests exercise.

Done when: `npm run typecheck`, `npm run lint` and `npm test` pass; the existing `npm run selftest` passes
(main starts with the new members and service). Live checks of trash into the real Trash are in
[11-final-verification.md](11-final-verification.md).

Commit: one commit for the group — `Core services: the files seam gains stat, realPath, makeFolder, rename and trash
in every adapter; a processes service behind its contract with a Node adapter and a fake; plan B's layer entries`

## Proof

