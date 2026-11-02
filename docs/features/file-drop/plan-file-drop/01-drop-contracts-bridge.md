# 01 — Drop contracts, bridge and pasted files

Status: done
Type: Task
Wave: 2 · Depends on: 02
Plan: [plan.md](plan.md)

Files:     create `src/contracts/drops.ts` · modify `src/contracts/bridge.ts` · modify `src/preload/preload.ts` ·
           create `src/shared/file-stamp.ts` · test `src/shared/file-stamp.test.ts` ·
           create `src/main/pasted-files.ts` · test `src/main/pasted-files.test.ts` · modify `src/main/main.ts`
Consumes:  `Files.writeBytes(path: string, bytes: Uint8Array): Promise<void>`, `Files.stat(path: string)` (existing,
           `src/contracts/files.ts`) · `Clock.now(): number` (existing, `src/contracts/ambient.ts`) ·
           `createMemoryFiles()` (existing, `src/shared/memory-files.ts`, test only) ·
           `Paths` (existing, `src/contracts/paths.ts`: `join`) · `posixPaths` (existing, `src/shared/paths/`, test only) ·
           `export function extensionOf(mediaType: string): string;` in `src/shared/image-types.ts` ← 02
Produces:  in `src/contracts/drops.ts`, word for word as plan.md File Structure:
           `export interface DroppedFile { readonly name: string; readonly mediaType: string; readonly path: string; bytes(): Promise<Uint8Array>; }`
           `export interface DropTarget { readonly element: HTMLElement; take(files: readonly DroppedFile[]): void; }`
           `export interface PageDrops { addTarget(target: DropTarget): Disposable; savePasted(file: DroppedFile): Promise<string>; }`
           `export const NOTHING_TAKES_FILES = 'Nothing here takes files';`
           in `src/shared/file-stamp.ts`: `export function fileStamp(epochMs: number): string`
           in `src/contracts/bridge.ts`: `Bridge.pathForFile(file: File): string;` ·
           `Bridge.savePasted(bytes: Uint8Array, mediaType: string): Promise<string>;` ·
           `BRIDGE_CHANNELS.savePasted: 'bridge:save-pasted'`
           in `src/main/pasted-files.ts`: `export interface PastedFiles { save(bytes: Uint8Array, mediaType: string): Promise<string>; }` ·
           `export function createPastedFiles(deps: { files: Files; clock: Clock; paths: Pick<Paths, 'join'>; folder: string }): PastedFiles`
Decisions:
- **`PageApi.drops` is not added here.** This task adds the `drops.ts` types only; task 04 adds `drops: PageDrops`
  to `PageApi` in `src/contracts/plugin.ts` together with its implementation in `createPageApi`, so each commit
  compiles (a `PageApi` member with no implementation breaks `src/renderer/plugins/page-api.ts`). plan.md's
  "PageApi gains `drops: PageDrops`" lands in 04.
- Comments on each `drops.ts` member carry plan.md's meaning: `name` the file's name; `mediaType` is `File.type`,
  `''` when the OS gave none (a folder); `path` the full path on disk, `''` for a pasted file; `savePasted` saves a
  file with no path under the app's `pasted/` folder and returns its full path. `Disposable` is
  `src/contracts/disposable.ts`'s.
- **`NOTHING_TAKES_FILES`** is the one copy of the no-target toast text: the core (04) and the editor-box targets (06)
  import it from `src/contracts/drops.ts`, and their tests assert against the constant; 08 names it as the core's
  toast on a rendered doc.
- **`fileStamp(epochMs)`** in `src/shared/file-stamp.ts` (importable from main and the page; task 08 names Docs
  images by it): `new Date(epochMs)` in local time as `yyyyMMdd-HHmmss`, 24-hour, every field zero-padded, the month
  1-based (`getMonth() + 1`).
- **Preload**: `pathForFile` calls Electron's `webUtils.getPathForFile(file)` (the only `webUtils` use in the app,
  per plan.md's boundary rules); it returns `''` for a file with no path on disk, passed through unchanged.
  `savePasted` invokes `BRIDGE_CHANNELS.savePasted` with `(bytes, mediaType)` and rejects with main's own error text
  through the existing `mainErrorText`, as `invoke` does.
- **The pasted folder** is a new `pastedFolder(homeDir: string): string` in `main.ts`, beside `dataFolder` and built
  the same way: a live run `path.join(app.getPath('userData'), 'pasted')` (the app instance's own user data folder,
  `<appData>/<appInstance.id>`, set in `startLiveApp`); the self-test and a drive run `path.join(homeDir, 'pasted')`,
  in the run's own home beside `plugin-data`. `StartInputs` gains `pastedFolder: string`, filled in
  `readStartInputs`. Its comment says the app never deletes the folder's files.
- **The handler**: `createWindow` builds `createPastedFiles({ files, clock, paths, folder: inputs.pastedFolder })`
  with main's existing module-level `files`, `clock` and `paths` (`const paths: Paths`, the platform's adapter), and registers `ipcMain.handle(BRIDGE_CHANNELS.savePasted, (_event, bytes:
  Uint8Array, mediaType: string) => pasted.save(bytes, mediaType))` beside `serveUiState`.
- **File name** (design § Pasted files): `<fileStamp(clock.now())>-<n>.<ext>` (`20261102-090507-1.png`). `<n>` is
  the lowest number from 1 up with no file at that exact name (`files.stat` returns null). Saves run one at a time
  in the order called, so two saves in one second take `-1` and `-2`. A rejected save (a failed `writeBytes`)
  rejects its own caller and the queue carries on: the chain holds `run.catch(() => {})`, never `run`, so one
  failed write does not stall every later paste. The path is `deps.paths.join(folder, name)` — the tree's `Paths`
  seam, not `node:path`, so the posix test rows hold on Windows too; `writeBytes` makes the folder.
- **Extension**: `<ext>` is `extensionOf(mediaType)` from `src/shared/image-types.ts` (task 02 owns that file, so
  this task follows it: wave 2).

GIVEN a screenshot pasted WHEN the page calls `savePasted(bytes, 'image/png')` at 2026-11-02 09:05:07 local THEN
main writes the bytes to `<pasted folder>/20261102-090507-1.png` and resolves with that full path
GIVEN a live run WHEN a file is saved THEN it lands under `<appData>/wigley-ai-gui/pasted/` (the dev app:
`wigley-ai-gui-dev`); in the self-test or a drive run under `<run home>/pasted/`
GIVEN a dropped file from Finder WHEN the page calls `pathForFile(file)` THEN it returns the file's full path; for a
clipboard image it returns `''`

Tests:     in `src/shared/file-stamp.test.ts`:
- `fileStamp writes local time as yyyyMMdd-HHmmss` — rows: `new Date(2026, 10, 2, 9, 5, 7).getTime()` →
  `20261102-090507` · `new Date(2026, 0, 1, 0, 0, 0).getTime()` → `20260101-000000` ·
  `new Date(2026, 11, 31, 23, 59, 59).getTime()` → `20261231-235959`
           in `src/main/pasted-files.test.ts`, over `createMemoryFiles()`, `posixPaths` and a fixed clock at
           `new Date(2026, 10, 2, 9, 5, 7).getTime()`, folder `/home/me/pasted`:
- `names a pasted file by its time and the first free number` — rows: no existing file → `/home/me/pasted/20261102-090507-1.png`;
  `20261102-090507-1.png` exists → `…-2.png`; `-1.png` and `-2.png` exist → `…-3.png`; `20261102-090507-1.jpg`
  exists, saving `image/png` → `…-1.png`
- `writes the bytes it was given` — `readBytes` of the returned path equals `[1, 2, 3]`
- `numbers two saves started in the same second apart` — rows: two `save` calls not awaited in turn resolve to
  `…-1.png` and `…-2.png`, in call order · the first save's `writeBytes` rejects `disk full` (a `files` wrapping
  `createMemoryFiles()` that rejects its first `writeBytes`) → the first `save` rejects `disk full`, the second
  still resolves to `…-1.png`

Done when: `npm run typecheck` passes; the test gate runs the tests above. The bridge round trip and the folder
           per run mode are checked live in "10 — Final verification".
Commit:    one commit for the group

## Proof

Commit d4ea7b1 · proof: diff read: every Produces present word for word; typecheck and lint pass · concerns: pastedFolder in main.ts not yet exercised live (task 10 checks it per run mode)
