# 01 — Core files and processes services

Status: not started
Type: Batch
Wave: 1 · Depends on: none (plan A landed, Preconditions)
Plan: [plan.md](plan.md)

Three items share one spec: the `files` service, the `processes` service, and the layer table every later task of
this plan needs.

Files:
- create `src/contracts/files.ts`, `src/contracts/processes.ts`
- modify `src/contracts/plugin.ts` (`MainServices`)
- create `src/main/files/node-files.ts` · test `src/main/files/node-files.test.ts`
- create `src/main/processes/node-processes.ts` · test `src/main/processes/node-processes.test.ts`
- create `src/shared/testing/memory-files.ts` · test `src/shared/testing/memory-files.test.ts`
- create `src/shared/testing/fake-processes.ts`
- modify `src/main/main.ts`
- modify `scripts/check-layers.mts`

Consumes:
- `Log` in `src/contracts/log.ts` (tree)
- `MainServices` in `src/contracts/plugin.ts` (tree), `isSelfTest` and the `createWindow` services literal in
  `src/main/main.ts` (tree)
- the `LAYERS` table and `TEST_PACKAGES` in `scripts/check-layers.mts` as plan A leaves them

Produces:

```ts
// src/contracts/files.ts — exactly as plan.md's File Structure
export interface FileStat { isFolder: boolean; modifiedMs: number; size: number; }
export interface FolderEntry { name: string; isFolder: boolean; }
export interface FileWatch { close(): void; }
export interface Files {
  read(path: string): Promise<string>;
  write(path: string, text: string): Promise<void>;
  stat(path: string): Promise<FileStat | null>;
  realPath(path: string): Promise<string>;
  list(folder: string): Promise<FolderEntry[]>;
  makeFolder(path: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  trash(path: string): Promise<void>;
  watch(path: string, changed: () => void): FileWatch;
}

// src/contracts/processes.ts — exactly as plan.md's File Structure
export interface ProcessResult { code: number; stdout: string; stderr: string; }
export interface ProcessRunner {
  run(command: string, args: string[], options?: { cwd?: string }): Promise<ProcessResult>;
}

// src/contracts/plugin.ts — MainServices gains
files: Files;
processes: ProcessRunner;

// src/main/files/node-files.ts
export interface NodeFilesOptions {
  // Moves a path to the OS Trash; main.ts passes Electron's shell.trashItem.
  trashItem: (path: string) => Promise<void>;
  log: Log;
}
export function createNodeFiles(options: NodeFilesOptions): Files;

// src/main/processes/node-processes.ts
export function createNodeProcesses(): ProcessRunner;

// src/shared/testing/memory-files.ts
export class MemoryFiles implements Files {
  // `files` maps absolute paths to text; every folder above a path exists.
  constructor(files?: Record<string, string>);
  // Paths `trash` removed, in call order.
  readonly trashed: string[];
  // Changes a file as another program would: sets its text and calls its watchers at once.
  change(path: string, text: string): void;
  // ...every Files member
}

// src/shared/testing/fake-processes.ts
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

- **Trash goes through an injected function, not an `electron` import in the adapter** (corrects plan.md's boundary
  rule "`src/main/files` imports `electron` (`shell.trashItem`)"). `main.ts` passes `(path) => shell.trashItem(path)`
  (Electron 44: `shell.trashItem(path): Promise<void>`, main process). The adapter then imports `node:` only, and its
  Vitest test runs without Electron. Under the self-test (`isSelfTest`), `main.ts` passes
  `(path) => rm(path, { recursive: true })` from `node:fs/promises` instead: every self-test file sits in the temp
  home folder, and the user's Trash must not collect them (the self-test never reaches the user — `silentAlerts`
  sets the same rule).
- **Write** (plan.md: "through a temp file in the same folder, then renames"): when `path` exists, the adapter
  resolves its real path first and writes beside and onto the real file, so a symlinked doc (this Mac's
  `~/.claude/CLAUDE.md` style links into `~/wigley-agents`) stays a symlink and its target gets the text. The temp
  file is `.<file name>.<8 hex from node:crypto randomBytes(4)>.tmp` in the real file's folder, so two writes never
  share a temp file. When the target exists, the temp file takes the target's permission bits (`mode & 0o777`)
  before the rename, so a script keeps its execute bit. Text is UTF-8. A failed write removes its temp file and
  rejects.
- **Stat** follows symlinks (`fs.stat`). `null` for `ENOENT` and `ENOTDIR`; any other error rejects.
- **realPath** is `fs.realpath`; it rejects when nothing is at `path` (task 06's guard resolves a new file's
  folder instead).
- **List** returns the folder's direct entries in the order the OS gives (callers sort). A symlink counts as what it
  points at: `isFolder` is true for a link to a folder. A broken symlink lists with `isFolder: false`.
- **makeFolder** is `mkdir` with `recursive: true`; an existing folder is no error.
- **Rename never replaces**: when anything is at `to`, it rejects with the message `<to> already exists` and changes
  nothing. It does not make `to`'s parent folders (the caller runs `makeFolder`). It moves folders too.
- **Watch** (design.md § Core services and seams: "a shared watcher"; plan.md: "after the file at `path` changes or
  is replaced, debounced 100 ms"): `fs.watch` on the folder of the file's real path (`fs.realpathSync`; the given
  path when nothing is there yet), keeping only events whose file name equals that real path's base name (an event
  with a `null` file name counts). Watching the folder, not the file, is what sees an atomic replace: a file watch
  follows the old inode, which a rename unlinks. Each kept event restarts a 100 ms timer; `changed` runs when it
  ends. `close()` closes the watcher and clears a waiting timer; `changed` never runs after `close()`. A missing
  folder throws from `watch` at once. A watcher `error` event logs `[files] watch <path> stopped: <error text>`
  (`errorText` from `src/shared/error-text.ts`) and closes that watch; it never reaches Node's unhandled `error` path, which would end the main process.
- **Run** uses `child_process.spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })`, no shell, the
  app's environment. It collects stdout and stderr as UTF-8 strings with no size cap (`execFile`'s 1 MB default
  `maxBuffer` is under the 4 MB `index.json` the index script prints — design.md § Docs browser). It resolves on
  `close` with the exit code; a non-zero exit is a result, not a rejection. A program ended by a signal resolves
  with `code: -1`. A spawn `error` (such as `ENOENT`) rejects with an `Error` whose message is
  `Could not run <command>: <error message>`.
- **MemoryFiles** (the second `Files` adapter, for plugin tests; `src/shared` imports no `node:` module): paths are
  absolute `/`-separated strings used as given, with a trailing `/` dropped. Folders are implied by the files under
  them plus every `makeFolder` path and its parents. `read` of a missing file rejects with
  `ENOENT: no such file: <path>`. `write` to a path whose folder does not exist rejects with `ENOENT: no such folder: <folder>`, as
  the Node adapter does. `stat`: `size` is the UTF-8 byte length (`new TextEncoder().encode(text).length`), `modifiedMs`
  a counter that goes up by 1 on each write, change and rename. `realPath` returns the path when something is
  there, else rejects as `read` does. `list` returns direct children sorted by name. `rename` follows the Node
  adapter's rules (rejects `<to> already exists`; moves a folder's whole subtree). `trash` removes the file or the
  folder's subtree and appends the path to `trashed`; a missing path rejects. Watchers run synchronously, with no
  debounce, on `write`, `change`, `rename` (both paths) and `trash` of their exact path.
- **FakeProcesses**: an unscripted run rejects with `FakeProcesses: no result scripted for <command> <args joined
  by one space>`. `runs` records every call, scripted or not, before the result.
- **Fakes only for tests**: `src/shared/testing` is its own layer, and only a `.test.ts` file may import it (below).
- **Layer table** — every entry plan B needs lands here, so no later task edits `check-layers.mts`:
  - `src/main/files`: `{ layers: ['src/contracts', 'src/shared'], packages: ['node:'] }` (`errorText`).
  - `src/main/processes`: `{ layers: ['src/contracts'], packages: ['node:'] }`.
  - `src/main/main.ts`: add `src/main/files`, `src/main/processes` to its layers.
  - `src/shared/testing`: `{ layers: ['src/contracts'], packages: [] }`. A new `TEST_LAYERS = ['src/shared/testing']`
    beside `TEST_PACKAGES`: a relative import from a `.test.ts` file into a `TEST_LAYERS` layer is allowed in any
    layer; no layer lists `src/shared/testing`, so production code importing it fails the check. The header comment
    gains that rule.
  - `src/plugins/docs/contract.ts`: `{ layers: ['src/contracts'], packages: [] }` (as the sessions and keys
    contracts).
  - `src/plugins/docs`: `{ layers: ['src/contracts', 'src/shared', 'src/plugins/docs/contract.ts',
    'src/plugins/sessions/contract.ts'], packages: [] }`.
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
- `MainServices`' comment gains: `files` and `processes` are the machine's file system and programs; under the
  self-test, `files.trash` deletes for good.

GIVEN a symlink `link.md` → `real.md` WHEN `write('link.md', 'new')` runs THEN `real.md` reads `new` and `link.md`
is still a symlink
GIVEN `b.md` exists WHEN `rename('a.md', 'b.md')` runs THEN it rejects with `<b.md path> already exists` and both
files keep their text
GIVEN a watch on `doc.md` WHEN another program writes `doc.md.tmp` and renames it onto `doc.md` THEN `changed` runs
GIVEN a program that exits 3 WHEN `run` awaits it THEN it resolves `{ code: 3, … }`, not a rejection
GIVEN no program `wigley-no-such-program` WHEN `run` starts it THEN it rejects naming `wigley-no-such-program`
GIVEN a production file in any layer WHEN it imports `src/shared/testing/memory-files` THEN `npm run lint` fails

Tests (each builds its own temp folder with `mkdtempSync(path.join(tmpdir(), 'wigley-files-'))` and removes it after,
as `round-store.test.ts` does; compare paths through `realpathSync`, since macOS's `/var` is `/private/var`):

`src/main/files/node-files.test.ts` (trash fake: an array the `trashItem` option pushes to; `log` pushes lines):
- `write then read returns the text` — `héllo\n` round-trips exactly.
- `write leaves no temp file` — after `write(<dir>/doc.md, 'a')`, `readdirSync(dir)` is `['doc.md']`.
- `write through a symlink writes its target` — `real.md` reads `new`; `lstatSync(link.md).isSymbolicLink()` is true.
- `write keeps the file's permission bits` — after `chmodSync(file, 0o755)` and a write, `statSync(file).mode & 0o777`
  is `0o755`.
- `stat returns null for a missing path` — `stat(<dir>/none)` is `null`; `stat(<dir>/a/b)` where `a` is a file is
  `null`; `stat` of a file holding `hello` has `size: 5`, `isFolder: false`; `stat(dir).isFolder` is true.
- `list marks folders and links to folders` — a folder `sub`, a file `a.md`, a symlink `link` → `sub`: the entries,
  sorted by name in the test, are `{a.md,false}`, `{link,true}`, `{sub,true}`.
- `makeFolder makes parents` — `makeFolder(<dir>/x/y/z)` then `statSync(<dir>/x/y/z).isDirectory()` is true; a second
  call resolves.
- `rename moves a file` — `a.md` (`one`) to `b.md`: `b.md` reads `one`; `a.md` is gone.
- `rename never replaces` — `a.md` (`one`), `b.md` (`two`): rejects with a message containing `already exists`;
  `a.md` reads `one`, `b.md` reads `two`.
- `watch sees an atomic replace` — watch `doc.md`; `writeFileSync(doc.md.tmp, 'x')`, `renameSync` onto `doc.md`; the
  test awaits a promise `changed` resolves (Vitest's 5 s timeout fails it otherwise).
- `watch sees a change through the link's target` — watch `link.md` → `real.md`; `writeFileSync(real.md, 'x')`;
  `changed` runs.
- `watch ignores another file in the folder` — watch `doc.md`; write `other.md`; after 300 ms `changed` has not run.
- `close stops a watch` — watch `doc.md`, `close()`, write `doc.md`; after 300 ms `changed` has not run.

`src/main/processes/node-processes.test.ts` (runs `process.execPath`, the Node running Vitest, with `-e`):
- `returns exit code and output` — script `process.stdout.write("out"); process.stderr.write("err");
  process.exit(3)`: resolves `{ code: 3, stdout: 'out', stderr: 'err' }`.
- `runs in the given folder` — script `process.stdout.write(process.cwd())` with `cwd: dir`: `stdout` equals
  `realpathSync(dir)`.
- `keeps output past one megabyte` — script `process.stdout.write("x".repeat(2000000))`: `stdout.length` is
  `2000000`.
- `rejects when the program is missing` — `run('wigley-no-such-program', [])` rejects with a message containing
  `wigley-no-such-program`.

`src/shared/testing/memory-files.test.ts`:
- `change calls the file's watchers` — `new MemoryFiles({ '/h/a.md': 'one' })`, watch `/h/a.md`, `change('/h/a.md',
  'two')`: one call; `read` gives `two`; after `close()`, a second `change` adds no call.
- `rename never replaces` — files `/h/a.md`, `/h/b.md`: `rename('/h/a.md', '/h/b.md')` rejects containing
  `already exists`; both keep their text.
- `trash removes a folder's files` — files `/h/s/SKILL.md`, `/h/s/ref.md`, `/h/x.md`: `trash('/h/s')`; `stat('/h/s')`
  and `stat('/h/s/ref.md')` are `null`; `/h/x.md` stays; `trashed` is `['/h/s']`.
- `list returns direct children` — files `/h/a.md`, `/h/s/b.md`: `list('/h')` is `[{a.md,false}, {s,true}]`.

`FakeProcesses` earns no test of its own: it is a scripted table its users' tests exercise.

Done when: `npm run typecheck`, `npm run lint` and `npm test` pass; the existing `npm run selftest` passes
(main starts with the two new services). Live checks of trash into the real Trash are in
[11-final-verification.md](11-final-verification.md).

Commit: one commit for the group — `Core services: files (atomic write, rename, trash, watch) and processes behind
contracts, with Node adapters, test fakes and plan B's layer entries`

## Proof

