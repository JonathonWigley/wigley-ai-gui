# 05 — Drive core: registry, commands, server, recorder

Status: not started
Type: Batch
Wave: 2 · Depends on: 01, 02
Plan: [plan.md](plan.md)

Files:     modify `src/contracts/files.ts` · modify `src/main/files/node-files.ts` · modify `src/shared/memory-files.ts` · modify `src/shared/scoped-files.ts` · test `src/main/files/node-files.test.ts` · test `src/shared/memory-files.test.ts` · create `src/main/drive/action-registry.ts` · test `src/main/drive/action-registry.test.ts` · create `src/main/drive/drive-commands.ts` · test `src/main/drive/drive-commands.test.ts` · create `src/main/drive/drive-server.ts` · test `src/main/drive/drive-server.test.ts` · create `src/main/drive/frame-recorder.ts` · test `src/main/drive/frame-recorder.test.ts` · create `src/main/drive/drive-run.ts`
Consumes:  `DriveAction`, `DriveHost` ← 01 · `DrivenWindow`, `Box`, `ConsoleMessage` and every page-driver function ← 02 · `Files`, `ProcessRunner`, `RandomHex`, `Log` (exist in `src/contracts`)
Produces:  `export function startDriveRun(deps: DriveRunDeps): DriveRun` in `src/main/drive/drive-run.ts`, with `DriveRunDeps` and `DriveRun` exactly as plan.md § Shared names writes them
           the HTTP protocol and the command table of plan.md § Drive protocol
           `writeBytes(path: string, bytes: Uint8Array): Promise<void>` on `Files` in `src/contracts/files.ts`
Decisions: the command module behind a small interface, HTTP a thin adapter (design review) · 127.0.0.1 and a token (round 2) · commands wait for the page to settle and return the lines they caused (round 2) · clicks through the real input pipeline (round 2) · settings through the temp home's `settings.json` (round 2) · video from paint frames through ffmpeg (round 2)

## Modules

- **Files.writeBytes** — writes bytes atomically as `write` writes text (Node: the same temp-and-rename path), creating parent folders; the scoped adapter refuses a path outside its root as `write` does; the in-memory adapter keeps the bytes. Screenshots and the recorder write through it.
- **action-registry.ts** — `createActionRegistry()` returns `{ hostFor(pluginId): DriveHost; list(): { name; description; args }[]; run(name, args): Promise<unknown> }`. `add` throws `Drive action <qualified> is already added` on a duplicate; the `Disposable` removes only that action; `run` of an unknown name rejects `No drive action <name>; \`actions\` lists them`. `list` is sorted by name.
- **drive-commands.ts** — `createDriveCommands(deps)` returns `{ run(command: string, args: unknown): Promise<unknown> }` over `{ window: DrivenWindow, actions (the registry's list/run), homeFiles: Files, runDir: string, files: Files, recorder: FrameRecorder, quit(): void }`. Each command per plan.md § Drive protocol:
  - every command first waits up to 30 s for `isReadyForKeys`, so a Vite reload between commands is waited out; a start failure (`readStartFailure`) rejects with its text
  - `key`, `type`, `click` and `drag` call `window.focus()` after the ready wait (a reload drops focus), act, `waitForRedraw`, and return the lines they caused, oldest first (the page log is newest first); `key` leaves 30 ms between keys, as the self-test's steps do
  - `setting` takes a top-level setting name only (nested settings pass an object `value`, which the config merges deep over the defaults); it reads `.config/wigley-ai-gui/settings.json` under the temp home (absent → `{}`), sets `name` at the top level or under `plugin`, writes it back whole, waits up to `STEP_TIMEOUT_MS` for the next `deps.configChanged` call (the watcher's quiet period comes first), then a redraw, and returns `{ lines, applied }` — `applied` false on the timeout, not an error, since a write that changes nothing publishes nothing
  - `click` and `drag` find the box with `boxOf` and reject `No element matches <selector>` when it is null
  - `log` and `console` keep a cursor: `since` is the index the previous call's `next` returned; console messages collect from `window.onConsole` from the start. The page log starts empty after a reload, so when it holds fewer lines than `since`, `log` returns every line from 0 with `reloaded: true`
  - `screenshot` writes `screenshots/<name>.png` under `runDir` through `writeBytes`; a name failing `SCREENSHOT_NAME` rejects `Screenshot name "<name>" is not lowercase letters and digits in words joined by -`; with `selector`, it captures that element's box
  - `query` runs one script returning, for every match, `textContent` trimmed, `classList`, the bounding box and `getComputedStyle(node).getPropertyValue(name)` for each of `styles`, so custom properties (`--wg-…`) read too
  - `fit` runs `cutOffAtWidth` at `width`, default `window.minimumWidth()`, with `withPrimitiveEllipsis(scrollsItself ?? [])`; the plugins' own `scrollsItself` lists live in their self-test scripts, which the drive layer cannot see, so the caller passes them
  - `eval` returns `window.run(script)`
  - `quit` replies, then calls `deps.quit()` on the next tick
  - `help` lists every command with its args and one-line description; the unknown command error names `help`
- **drive-server.ts** — `startDriveServer({ token, run }): Promise<{ port: number; close(): Promise<void> }>` on `127.0.0.1` port 0 with `node:http`: only `POST /`; a missing or wrong `Authorization: Bearer <token>` → 401 `{ ok: false, error: 'bad token' }`; a body that is not `{ command: string, args?: object }` JSON → 400 with the reason; a command that rejects → 200 `{ ok: false, error: <errorText> }`. Commands run one at a time in arrival order.
- **frame-recorder.ts** — `createFrameRecorder({ window, files, processes, runDir })` returns `{ start(name): void; stop(): Promise<string> }`. `start` subscribes to `window.onFrame` and writes each frame through `writeBytes` to `videos/<name>-frames/<n>.png` with its time; a second `start` before `stop` throws. `stop` writes an ffmpeg concat list where each frame lasts until the next (the last 100 ms), runs `ffmpeg -y -f concat -safe 0 -i <list> -vsync vfr -pix_fmt yuv420p videos/<name>.mp4`, removes the frames folder, and returns the MP4 path. ffmpeg missing → rejects `ffmpeg is not on PATH; install it to record video`; ffmpeg failing → rejects with its stderr's last line. A recording with no frames rejects `No frames painted while recording`. Default name `recording-<n>`.
- **drive-run.ts** — `startDriveRun` builds the registry, recorder and commands at once (the commands get `homeFiles = scopedFiles(deps.files, deps.homeDir)` and `deps.files` for the run folder), generates the token with `randomHex` (four calls joined, 32 hex), starts the server, and returns `{ driveFor: registry.hostFor, listening, dispose }` without waiting. `listening` writes `drive.json` `{ port, token, pid: process.pid }` to `runDir`, logs `drive run listening on <port>` under source `main`, and resolves to the port; `dispose` stops a recording and closes the server.

GIVEN two actions added as `forms.openRound` and `docs.connectSession` WHEN `list` runs THEN both show, sorted
GIVEN an added action whose Disposable was disposed WHEN `run('forms.openRound')` runs THEN it rejects naming `actions`
GIVEN a fake window whose log gains two lines after a key WHEN `run('key', { keys: ['j'] })` runs THEN the result's `lines` hold both, oldest first
GIVEN a temp home whose settings.json holds `{ "transparency": "full" }` WHEN `run('setting', { plugin: 'keys', name: 'whichKeyTimeoutMs', value: 50 })` runs and the config changes THEN the file holds both settings and `applied` is true
GIVEN a config that never changes WHEN `run('setting', …)` runs THEN it resolves with `applied` false after the step timeout
GIVEN a page log of 2 lines and `since` 5 WHEN `run('log', { since: 5 })` runs THEN both lines return with `reloaded` true
GIVEN `Files.writeBytes` of bytes `[0, 255, 137]` WHEN the node adapter writes them THEN `node:fs` reads the same three bytes back (and the in-memory adapter holds the same bytes)
GIVEN no element matches WHEN `run('click', { selector: '.missing' })` runs THEN it rejects naming the selector
GIVEN a server WHEN a request carries no token THEN it answers 401 and runs no command
GIVEN a recorder that saw frames at 0, 40 and 100 ms WHEN `stop` runs THEN the concat list gives durations 0.04, 0.06 and 0.1 and ffmpeg is run once with that list

Tests:     one test per GIVEN above, named as its sentence, over a fake `DrivenWindow`, an in-memory `Files` (`src/shared/memory-files.ts`) and `src/shared/fake-processes.ts`; the server test sends real requests to its port 0 listener
Done when: typecheck, lint and the tests pass
Commit:    one commit for the group

## Proof
