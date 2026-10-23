# 02 — Paths as a service in both processes

Status: in progress
Type: Task
Wave: 2 · Depends on: 01, 06
Plan: [plan.md](plan.md)

Files:     modify `src/contracts/plugin.ts` · modify `src/main/main.ts` · modify `src/renderer/renderer.ts` · modify `src/shared/scoped-files.ts` · modify `src/shared/data-url.ts` · modify `src/main/data-protocol/data-protocol.ts` · modify `src/shared/memory-files.ts` · test `src/shared/data-url.test.ts` · modify `src/main/plugins/main-api.ts` · modify `src/main/drive/drive-run.ts` · test `src/shared/scoped-files.test.ts` · test `src/main/plugins/main-api.test.ts` · test `src/main/drive/drive-commands.test.ts` · modify every other test the compiler flags for the new required members
Consumes:  `Paths` in `src/contracts/paths.ts`, `posixPaths`, `windowsPaths`, and the layer entries that let `main.ts`, `renderer.ts` and the tests import them ← 01
Produces:  `paths: Paths` in `MainServices` and in `PageServices` (`src/contracts/plugin.ts`)
           `export function scopedFiles(files: Files, root: string, paths: Paths): Files` in `src/shared/scoped-files.ts`
           `export function relativeSegments(path: string): string[] | null` in `src/shared/scoped-files.ts`
           `export function dataFilePath(url: string, dataRoot: string, paths: Paths): string | null` in `src/shared/data-url.ts`
           `export function serveDataScheme(dataRoot: string, paths: Paths): void` in `src/main/data-protocol/data-protocol.ts` (called from `main.ts` line ~738)
Decisions: each composition root picks the adapter; no other module imports one (round 1) · relative paths inside a scoped `Files` stay `/`-separated on every OS, and only the join onto `root` goes through `paths.join` (design review) · `main.ts` stops using `expandHome` for `paths.expandTilde` (round 1 scope: every POSIX path user)

## Changes

- `src/contracts/plugin.ts`: `MainServices` and `PageServices` each gain a required `paths: Paths`, so the compiler
  flags every builder and fake that leaves it out. Each test fake that the compiler flags gets `posixPaths`.
- `src/main/main.ts` (the main composition root): one `const paths: Paths = process.platform === 'win32' ?
  windowsPaths : posixPaths;` near the other ambient services (`clock`, `randomHex`, `randomUuid`), passed into the
  services record `startMainParts` receives, into each `scopedFiles` call, into `startDriveRun`, and in place of
  `expandHome` for the `claude.command` setting (`paths.expandTilde(…, homeDir)`; a bare `~` now expands to the home folder, task 01). This is the one `process.platform`
  read the plan adds, and it sits in the composition root.
- `src/renderer/renderer.ts` (the page composition root): picks `config.platform === 'windows' ? windowsPaths :
  posixPaths` from the served config it already reads (line ~96 sets `dataset.platform` from it), and adds `paths` to
  the `services` record (line ~152).
- `src/shared/scoped-files.ts`: `resolveInside(root, path): string | null` is replaced by
  `export function relativeSegments(path: string): string[] | null`: the segments of a `/`-separated relative path
  with `.` and `..` folded, `[]` for an empty path, and null for the cases `resolveInside` refuses today (a leading
  `/`, a `\`, a drive prefix, a `..` above the start). It joins onto no root, so each caller joins its own way:
  - `scopedFiles` takes `paths` and resolves `paths.join(root, ...segments)` (`root` itself for `[]`).
  - `dataFilePath(url, dataRoot, paths)` in `src/shared/data-url.ts` joins with `paths.join`, keeping its rule that
    a plugin id resolving to the data root itself is refused; `src/main/data-protocol/data-protocol.ts:46` passes
    the `paths` it receives from `main.ts`.
  - `src/shared/memory-files.ts` keeps its `/`-led key spelling, joining the segments with `/`.

  `realPath` returns `paths.segmentsBelow(real, realRoot)?.join('/')` in place of `slashJoined` and
  `relativeToFolder`, and rejects `<path> is outside <root>` on null. `slashJoined` and `relativeToFolder` go.
- `src/main/plugins/main-api.ts:61`: `` `${deps.dataRoot}/${manifest.id}` `` becomes `paths.join(deps.dataRoot,
  manifest.id)` from the services it already holds.
- `src/main/drive/drive-run.ts:55`: `scopedFiles(deps.files, deps.homeDir, deps.paths)`; its deps gain `paths`.
- `src/main/claude-code/claude-launch.ts` keeps importing `expandHome` after this task; task 03 moves it and
  deletes `expand-home.ts` and its test.

GIVEN a Windows root `C:\Users\jo\AppData\Roaming\wigley-ai-gui\plugins\forms` and `windowsPaths` WHEN `scopedFiles(inner, root, windowsPaths).read('layouts/default/layout.js')` runs THEN `inner.read` receives `C:\Users\jo\AppData\Roaming\wigley-ai-gui\plugins\forms\layouts\default\layout.js`
GIVEN a scoped files over root `C:\Root` whose real path the inner files return as `c:\root` WHEN `realPath('a/b.md')` resolves to `C:\Root\a\b.md` THEN it returns `a/b.md`
GIVEN a real path outside the root's real path WHEN `realPath` runs THEN it rejects with `<path> is outside <root>`, as today

Tests:     `scoped-files.test.ts` — existing cases pass `posixPaths` and keep their assertions, except `realPath_WindowsSeparators_ReturnsSlashJoinedRelative`, which hands Windows real paths and passes `windowsPaths` · `scopedFiles_WindowsRoot_JoinsWithBackslash` (the first GIVEN) · `realPath_WindowsCaseDiffers_ReturnsSlashRelative` (the second GIVEN) · `realPath_WindowsLinkOutside_Rejects`
           `data-url.test.ts` — existing cases pass `posixPaths` and keep their values · `dataFilePath_WindowsRoot_JoinsWithBackslash`: `('wigley-data://forms/~3/layouts/a%20b/layout.js', 'C:\d', windowsPaths)` → `C:\d\forms\layouts\a b\layout.js`
           `main-api.test.ts` — its service records are casts the compiler does not flag (`{} as MainServices` at lines ~55 and ~92, `{ files } as unknown as MainServices` at ~112, ~141 and ~165): each gains `paths: posixPaths`, since `main-api.ts` now calls `paths.join` while it builds the API · the data folder of plugin `forms` under data root `/data` is `/data/forms` with `posixPaths` (assert the path the inner files receive)
Done when: `npm run typecheck` and `npm run lint` pass; the test gate runs the tests above
Commit:    one commit for the group

## Proof

