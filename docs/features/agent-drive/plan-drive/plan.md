# Agent drive run — plan

Feature: agent-drive · Implements: none · Ticket: none
Target: main (wigley-ai-gui) and main (wigley-ai-marketplace, task 04) · Written: 2026-10-22

REQUIRED SUB-SKILL: Use wigley:make to implement this plan

## Goal

The agent checks every change end to end in the running app itself. `npm run drive -- start`
launches the app offscreen as an accessory app on a fresh temp home, beside the user's own app, and
`npm run drive -- <command>` presses keys, clicks, drags, resizes, changes settings, seeds plugin
fixtures, screenshots, records video, queries the DOM and computed styles, reads the logs, restarts
and quits. The self-test stays the scripted regression suite and shares the driver's input and
capture code. The plan ends by running every reachable row of `docs/features/ui-design/live-checks.md`
through the driver and deleting that doc.

## Architecture

```
scripts/drive.mts (CLI, npm run drive)
   │ spawns electron-forge start / the packaged binary with WIGLEY_DRIVE_DIR, waits for drive.json
   │ POST http://127.0.0.1:<port>/  {command,args}  Authorization: Bearer <token>
   ▼
src/main/main.ts ── runModeOf(env) → 'live' | 'selfTest' | 'drive' ── one service set per mode
   │ drive: home = <run>/home, harness fake or Claude (real home + WIGLEY_AI_GUI_ENDPOINT_DIR)
   ▼
src/main/drive/  (no electron import)
   drive-run.ts        startDriveRun: registry + commands + server + drive.json
   drive-server.ts     HTTP adapter: token check, JSON in/out          → drive-commands.ts
   drive-commands.ts   every command, over DrivenWindow + action registry + files + recorder
   action-registry.ts  plugins' drive actions, qualified by plugin id
   frame-recorder.ts   paint frames → PNGs → ffmpeg MP4
   page-driver.ts      press, type, click, drag, waits, capture, fit check  ← src/main/selftest.ts too
   driven-window.ts    DrivenWindow interface
src/main/electron-driven-window.ts   the Electron adapter of DrivenWindow
plugins ── api.drive.add('<name>', action)  sessions.connect · forms.openRound · chat.start · docs.connectSession …
```

Systems touched: the main composition root, the self-test driver, the plugin API contract, the
sessions, forms, chat and docs main parts, the Claude Code adapter, the layer check, and
wigley-ai-marketplace's forms relay (`start_app.py`, `relay.py`).

## Preconditions

Each re-run by `wigley:make` before the first dispatch.

- The docs written ahead are on main: `git -C /Users/jonathonwigley/Documents/dev/wigley-ai-gui log --oneline -1 -- .agents/skills/drive/SKILL.md` → `e7f492b`.
- A peer session commits to this working tree (`8678e02`, follow-ups, landed during the interview): every commit in the run is pathspec-scoped.
- The self-test passes on main before the run: `npm run selftest` → `[selftest] all passed` (passed at plan time on `8678e02`).
- ffmpeg is on PATH: `command -v ffmpeg` → `/opt/homebrew/bin/ffmpeg`. The user's yes (round 1) covers running it.
- The marketplace is at 1.7.1 with the make edit landed: `grep '"version"' /Users/jonathonwigley/Documents/dev/personal/wigley-ai-marketplace/plugins/wigley/.claude-plugin/plugin.json` → `"version": "1.7.1"`; `git -C …/wigley-ai-marketplace log --oneline -1` → `4a2b58f`.
- Node is pinned: `cat .nvmrc` → `24.22.0`; commands run as `source ~/.nvm/nvm.sh && nvm use && npm run …`.
- Only four plugins test `services.selfTest` for behaviour (measured at plan time, re-verify): `grep -rn 'services.selfTest\|selfTest }' src/plugins --include=start.ts` → forms, chat, sessions, docs.

## Docs written ahead

- `AGENTS.md` § Running and testing: the drive-run bullet, the real-keyboard bullet, plugin data in a drive run — `e7f492b`; § Architecture's `src/main/drive/` line — committed with this plan
- `.agents/skills/drive/SKILL.md` and the link `.claude/skills/drive` — `e7f492b`
- `~/wigley-agents/AGENTS.md` § Checks for the user — `7b829c6` in `~/wigley-agents`
- wigley-ai-marketplace `plugins/wigley/skills/make/SKILL.md` § Verification (the lead runs every reachable runtime check) and `plugins/wigley/scripts/forms/README.md` § The relay (`WIGLEY_AI_GUI_ENDPOINT_DIR`) — `4a2b58f`

## Mandatory Reads

- `AGENTS.md` (this repo) — every task
- `DESIGN.md` — task 12
- `docs/features/agent-chat/claude-stream.md` — task 03
- `/Users/jonathonwigley/Documents/dev/personal/wigley-ai-marketplace/AGENTS.md` — task 04
- No `.claude/rules/` or `CLAUDE*.md` exists in either repo (checked at plan time).

## Design Overview

After-state, one check:

```
agent: npm run drive -- start
  CLI ── mkdir .drive/<id>/home, write .drive/current, spawn app (WIGLEY_DRIVE_DIR=<abs run dir>)
  main ── runMode 'drive' → services: temp home, fake harness (or Claude), silent alerts,
          no dialogs, no external links; relay opens on a socket of its own
       ── plugins start; each adds its drive actions through api.drive
       ── startDriveRun → server on 127.0.0.1:0, writes <run>/drive.json {port, token, pid}
  CLI ── polls drive.json, POST ready → prints the run id
agent: npm run drive -- do forms.openRound '{}'     → {sessionId}
agent: npm run drive -- key "Space k s"             → {lines:[…]} after three frames
agent: npm run drive -- screenshot sessions         → {path: .drive/<id>/screenshots/sessions.png}
agent: npm run drive -- query .session-row '{"styles":["background-color"]}'
agent: npm run drive -- quit                        → app.quit (will-quit flushes ui-state)
```

Decisions (round numbers from the interview):

- An in-app control server the agent calls through `npm run drive`, no new dependency (round 1).
- A fresh temp home with fixtures by default; real Claude (`--harness claude`) and a copy of the user's config (`--user-config`) as opt-ins (round 1).
- Plugins offer fixtures as named drive actions through `api.drive`, a separate host from `api.selfTest` (rounds 1, 2).
- Captures: window and element screenshots, page log, main output, console, DOM and style queries, fit check at any width, video through ffmpeg (round 1).
- No real OS key events: checks only a real keyboard proves stay the user's, listed in the wrap-up only, never blocking and never recorded (round 1 note).
- Instructions: a project skill in `.agents/skills/drive/` linked from `.claude/skills/drive`, and the rule in AGENTS.md (round 1, design review).
- The final verification runs every reachable row of `live-checks.md`, then deletes the doc (round 2).
- `wigley:make` runs reachable checks itself (docs written ahead) and the relay reads `WIGLEY_AI_GUI_ENDPOINT_DIR` (rounds 2, 3).
- `start --packaged` drives the packaged build (round 2).
- Design review: the command module behind a small interface with HTTP as a thin adapter (depth); `DrivenWindow` with two adapters (seam); one service set per run mode, landing the existing follow-up (locality); plugins read `services.runMode`; fixture builders shared by self-test scripts and drive actions (leverage); the Windows relay pipe is named per home, and a Unix socket path over 103 bytes falls back to a hashed `/tmp` path (cold read: a drive run's home makes it 113).
- The Claude adapter expands a profile's config folder against its own home; chat passes the folder as written (round 4).

Out of scope: real OS keyboard input, native notifications and dialogs in a drive run, a `MainApi.commands.run` for drive (the follow-ups' command lifecycle item), drive actions beyond the first set.

## File Structure

### Shared names (more than one task uses each; Produces lines match these word for word)

- `src/contracts/plugin.ts` (01):
  - `export type RunMode = 'live' | 'selfTest' | 'drive';`
  - `export interface DriveAction { description: string; args: string; run(args: unknown): Promise<unknown>; }`
  - `export interface DriveHost { add(name: string, action: DriveAction): Disposable; }`
  - `MainServices` gains `runMode: RunMode`; `MainApi` gains `drive: DriveHost | null` (null outside a drive run).
- `src/main/plugins/main-api.ts` (01): `MainApiDeps` gains `driveFor(pluginId: string): DriveHost | null`.
- `src/main/drive/driven-window.ts` (02):

  ```ts
  export interface Box { x: number; y: number; width: number; height: number; }
  export type DrivenInput =
    | { type: 'keyDown' | 'keyUp'; keyCode: string; modifiers: Modifier[] }
    | { type: 'char'; keyCode: string }
    | { type: 'mouseDown' | 'mouseUp' | 'mouseMove'; x: number; y: number; button: 'left' | 'right'; clickCount: number };
  export type Modifier = 'control' | 'alt' | 'shift' | 'meta';
  export interface ConsoleMessage { level: string; text: string; source: string; }
  export interface DrivenWindow {
    sendInput(input: DrivenInput): void;
    run<T>(script: string): Promise<T>;
    capture(box?: Box): Promise<Uint8Array | null>;   // PNG bytes; null when the capture is empty
    contentSize(): { width: number; height: number };
    minimumWidth(): number;
    setContentWidth(width: number): void;             // keeps the height
    setSize(width: number, height: number): void;
    focus(): void;
    hasPaintedSinceNavigation(): boolean;
    onFrame(listener: (png: () => Uint8Array, at: number) => void): Disposable;
    onConsole(listener: (message: ConsoleMessage) => void): Disposable;
  }
  ```
- `src/main/drive/page-driver.ts` (02): `press(window: DrivenWindow, key: string): void` · `typeText(window, text: string): Promise<void>` · `click(window, box: Box, button: 'left' | 'right', count: number): Promise<void>` · `drag(window, box: Box, dx: number, dy: number): Promise<void>` · `boxOf(window, selector: string): Promise<Box | null>` · `readLog(window): Promise<string[]>` (newest first, as the page holds it) · `waitFor(check: () => Promise<boolean>, timeoutMs?: number): Promise<boolean>` · `waitForNewLogLine(window, line: string, seen: number, timeoutMs?: number): Promise<boolean>` · `waitForRedraw(window): Promise<boolean>` · `isReadyForKeys(window): Promise<boolean>` · `readStartFailure(window): Promise<string | null>` · `capturePng(window, box?: Box): Promise<Uint8Array | string>` (a string is why it failed) · `cutOffAtWidth(window, width: number, scrollsItself: string[]): Promise<string[]>` · `STEP_TIMEOUT_MS = 5000`.
- `src/main/electron-driven-window.ts` (02): `export function electronDrivenWindow(window: BrowserWindow): DrivenWindow`.
- `src/main/drive/page-driver.ts` (02) also exports `PRIMITIVE_ELLIPSIS_SELECTORS`, `withPrimitiveEllipsis` and `SCREENSHOT_NAME`, moved from `src/main/selftest-config.ts`. Every `DrivenWindow` size is a content size.
- `src/contracts/files.ts` (05): `Files` gains `writeBytes(path: string, bytes: Uint8Array): Promise<void>`, implemented in `src/main/files/node-files.ts`, `src/shared/memory-files.ts` and `src/shared/scoped-files.ts`.
- `src/main/drive/drive-run.ts` (05): `export function startDriveRun(deps: DriveRunDeps): DriveRun` with
  `DriveRunDeps { window: DrivenWindow; runDir: string; files: Files; homeDir: string; processes: ProcessRunner; randomHex: RandomHex; configChanged(listener: () => void): Disposable; quit(): void; log: Log }` and
  `DriveRun { driveFor(pluginId: string): DriveHost; listening: Promise<number>; dispose(): Promise<void> }`. It returns before the server listens, so the composition root hands plugins their hosts while the plugins start; `listening` resolves to the port once `drive.json` is written.
- `src/main/run-mode.ts` (01): `export function runModeOf(env: NodeJS.ProcessEnv): RunMode`.

### Drive protocol (05 serves it, 09 starts it, 10 calls it)

- Env: `WIGLEY_DRIVE_DIR` — absolute run folder, selects drive mode. `WIGLEY_DRIVE_HARNESS` — `fake` (default) or `claude`. `PROOF_SELFTEST` and `WIGLEY_DRIVE_DIR` both set → `runModeOf` throws `Set PROOF_SELFTEST or WIGLEY_DRIVE_DIR, not both`.
- Run folder `.drive/<run-id>/` (run id `YYYYMMDD-HHMMSS-<4 hex>`; `.drive/current` holds the newest id): `home/` the temp home · `drive.json` `{ "port": number, "token": string, "pid": number }`, written once the server listens · `app.log` the app's stdout and stderr (the CLI redirects them) · `screenshots/<name>.png` · `videos/<name>.mp4`.
- HTTP: `POST /` on `127.0.0.1:<port>`, header `Authorization: Bearer <token>`, body `{ "command": string, "args": object }`. Reply 200 `{ "ok": true, "result": … }` or `{ "ok": false, "error": string }`; 401 `{ "ok": false, "error": "bad token" }` without the token.
- Commands (every one waits for the page to be ready for keys first, up to 30 s across a reload):

  | command | args | result |
  |---|---|---|
  | `help` | `{}` | `[{ command, args, description }]` |
  | `ready` | `{}` | `{ ready: true }` |
  | `key` | `{ keys: string[] }` | `{ lines: string[] }` |
  | `type` | `{ text: string }` | `{ lines: string[] }` |
  | `click` | `{ selector: string, button?: 'left'\|'right', count?: number }` | `{ lines: string[] }` |
  | `drag` | `{ selector: string, dx: number, dy: number }` | `{ lines: string[] }` |
  | `resize` | `{ width: number, height: number }` | `{ width, height }` (content size after) |
  | `setting` | `{ name: string, value: unknown, plugin?: string }` | `{ lines: string[], applied: boolean }` |
  | `wait-log` | `{ line: string, timeoutMs?: number }` | `{ found: boolean }` |
  | `log` | `{ since?: number }` | `{ lines: string[], next: number, reloaded: boolean }` oldest first |
  | `console` | `{ since?: number }` | `{ messages: ConsoleMessage[], next: number }` |
  | `screenshot` | `{ name: string, selector?: string }` | `{ path: string }` |
  | `query` | `{ selector: string, styles?: string[] }` | `{ matches: [{ text, classes, box, styles }] }` |
  | `fit` | `{ width?: number, scrollsItself?: string[] }` | `{ problems: string[] }` |
  | `eval` | `{ script: string }` | `{ value: unknown }` |
  | `record` | `{ action: 'start'\|'stop', name?: string }` | start `{}`; stop `{ path: string }` |
  | `actions` | `{}` | `[{ name, description, args }]` |
  | `do` | `{ name: string, args?: unknown }` | the action's result |
  | `quit` | `{}` | `{}`, then the app quits through `app.quit` |

  `lines` is every page-log line the command caused, oldest first, read after three frames.

### Existing files modified

- `src/contracts/files.ts`, `src/main/files/node-files.ts`, `src/shared/memory-files.ts`, `src/shared/scoped-files.ts` and their tests (05)
- `src/main/main.ts` (01, 09) · `src/main/selftest.ts`, `selftest-config.ts`, `selftest-config.test.ts` (02) · `src/contracts/plugin.ts` (01) · `src/contracts/agent.ts` (03)
- `src/main/plugins/main-api.ts`, `main-api.test.ts` (01)
- `src/main/claude-code/claude-launch.ts`, `claude-code-harness.ts`, their tests (03) · `src/plugins/chat/main/chat-sessions.ts`, its test (03)
- `src/plugins/sessions/main/start.ts` (01, 06, 09), `relay/endpoint.ts`, `endpoint.test.ts` (06)
- `src/plugins/forms/main/start.ts` (01, 06), `selftest-script.ts` (06)
- `src/plugins/chat/main/start.ts` (03, 07), `selftest-script.ts` (07)
- `src/plugins/docs/main/start.ts` (01, 08), `selftest-script.ts` (08)
- `scripts/check-layers.mts` (02) · `package.json`, `.gitignore` (10) · `docs/features/followups.md` (01)
- `docs/features/ui-design/live-checks.md` (deleted, 12), `docs/features/ui-design/design.md` (12)
- wigley-ai-marketplace: `plugins/wigley/scripts/forms/start_app.py`, `relay.py`, `tests/test_start_app.py`, both `plugin.json` (04)

### New files

- `src/main/run-mode.ts`, `run-mode.test.ts` (01) — the one place the env picks the mode.
- `src/main/drive/driven-window.ts`, `page-driver.ts`, `page-driver.test.ts` (02) — the input and capture code the self-test and the driver share, Electron-free so its waits are tested.
- `src/main/electron-driven-window.ts` (02) — the one Electron adapter of `DrivenWindow`.
- `src/main/drive/action-registry.ts`, `drive-commands.ts`, `drive-server.ts`, `frame-recorder.ts`, `drive-run.ts`, each with a `.test.ts` but `drive-run.ts` (05).
- `src/plugins/forms/main/fixtures.ts`, `src/plugins/chat/main/fixtures.ts` (06, 07) — fixture builders moved out of the self-test scripts, shared with the drive actions.
- `scripts/drive.mts`, `scripts/drive-args.mts`, `scripts/drive-args.test.mts` (10) — the CLI; argument parsing is pure and tested.

### Boundary rules

- `src/main/drive` imports `src/contracts`, `src/shared` and `node:` only, never `electron`; `src/main` may import `src/main/drive`; `src/main/main.ts` lists it.
- Plugins reach a drive run only through `api.drive`; no plugin imports `src/main/drive`.
- The relay change in wigley-ai-marketplace is backward-compatible: with the variable unset, the relay behaves as today.

## Tasks

> `wigley:make` ticks a box once its group is committed and proved, and sets `Status: done` in the
> task document in the same change. The run is done when every box is ticked.

### Wave 1
- [x] [Run modes and the drive host contract](01-run-modes.md)
- [x] [Page driver shared with the self-test](02-page-driver.md)
- [x] [Claude adapter resolves profile folders](03-claude-profile-home.md)
- [x] [Relay endpoint folder variable (marketplace)](04-relay-endpoint-dir.md)

### Wave 2
- [x] [Drive core: registry, commands, server, recorder](05-drive-core.md) — after 01, 02
- [x] [Sessions and forms drive actions](06-sessions-forms-actions.md) — after 01
- [x] [Chat drive actions](07-chat-actions.md) — after 01, 03
- [x] [Docs drive actions](08-docs-actions.md) — after 01

### Wave 3
- [x] [Drive mode in the composition root](09-drive-wiring.md) — after 01, 02, 03, 05, 06
- [x] [The drive CLI](10-drive-cli.md) — after 05

### Wave 4
- [x] [Doc re-read](11-doc-re-read.md) — after 01–10

### Wave 5
- [x] [Final verification](12-final-verification.md) — after 11

## Run log

Review base: 03f5a8d47ac16134c3b4f5ff4f4ef0d51e36a9de

### Groups
- 12 · fixes 56182b9, ddc7889, 9001c51, 3062c75, 2f935d9, 8783fc8; docs commit below · proved (six drive verifiers over every reachable row, failed and blocked rows re-run after the fixes; drive tests 22, drive-args 11, docs+split 218, forms 574) · concerns: the page that never loads on ~1 restart in 3 is now caught, its cause unknown (Forge/Vite suspected); `drag` releases before it returns; focus emulation is drive-only, the self-test runs without focus events
- peer note · a keymap plan run (docs/features/keymap/plan-keymap) shares this tree from b633318 on; every commit here is pathspec-scoped and the review range is this run's commit list, not `03f5a8d..HEAD`
- 11 · (doc commit below) · proved (diff read against code; other two repos unchanged) · concerns: `quit` absent from the CLI-only help
- 10 · cd49094 · proved (typecheck, 60 scripts tests, lead CLI smoke start/actions/key/screenshot/quit) · concerns: Windows .cmd shell quoting; restart's two-pid wait; inherited PROOF_SELFTEST
- 09 · 13aee03 · proved (typecheck, 26 relay tests, offscreen ready/quit check) · concerns: ffmpeg on inherited PATH; ui-state flush unobserved. Touched `endpoint.ts` and its test beyond its list (`endedDriveRunLaunch` beside `launchCommand`)
- 05 · 71a4a1c · proved (typecheck, lint, 92 tests) · concerns: Windows path separators; ffmpeg on the main process PATH; fake-timer setting test; Self-test chord wording
- 06 · 5a1efc6 · proved (typecheck, 678 sessions+forms tests) · concerns: drive-connected sessions not ended on dispose
- 07 · 461984e · proved (typecheck, 145 chat tests) · concerns: drive arg readers private to chat; askPermission args null guard
- 08 · 57ff5ac · proved (typecheck, 213 docs tests) · concerns: self-test `previous` set after activate
- 02 · 4879003 · proved (typecheck, lint, 17 tests) · concerns: "Self-test step" chord error text reaches drive; fractional capture boxes; minimumWidth is outer width; one adapter per window
- 01 · 97c24b0 · proved (typecheck clean, 10 tests) · concerns: stale node-files.ts:39-40 comment, handed to 05
- 03 · 06a4960 · proved (typecheck clean outside main.ts, 114 tests) · concerns: claude-code-harness.test.ts unchanged — no case named
- 04 · marketplace 902acbb · proved (unittest 40 OK, manifests pass) · concerns: none
### Contract changes
- `claudeLaunch(request, permissionTool, env)`: → `claudeLaunch(request, permissionTool, env, homeDir)` · why: the adapter expands `~/` against its home · consumers: none outside the adapter · group 03
- `askFixturePermission`: `(chat: ChatSessions, …): Promise<unknown>` → `(chat: Pick<ChatSessions, 'permissionToolSession'>, …): Promise<ToolResult>` · why: the self-test holds a Pick and reads a ToolResult · consumers: 07 only · group 07
- ffmpeg command: `-vsync vfr` → `-fps_mode vfr -vf pad=ceil(iw/2)*2:ceil(ih/2)*2` · why: ffmpeg 9.0.2 rejects `-vsync`; libx264 yuv420p refuses odd sizes · consumers: none · group 05
- `MemoryFiles` gains `readBytes(path): Uint8Array` (test-double inspection) · consumers: none · group 05
- `DrivenInput` mouse variant gains `modifiers: (Modifier | HeldButton)[]`, `HeldButton = 'leftbuttondown' | 'rightbuttondown'` (Electron's spelling) · why: a drag's moves carried no held button, so pointer capture ended · consumers: page driver, Electron adapter, fake · group 12 (lead ruling on 02's contract)
- `DrivenWindow` gains `emulateFocus(): Promise<void>` (DevTools `Emulation.setFocusEmulationEnabled`) · why: an offscreen page never had document focus, so `.cm-focused` and focus events never happened · consumers: drive-commands only; the self-test does not call it · group 12
- page driver `click(window, box, …)`/`drag(window, box, …)` → `(window, selector, …)`, rejecting on a covered, sizeless or off-window target · why: a covered click reported success · consumers: drive-commands · group 12
- `startDriveServer` deps gain `unqueued: readonly string[]` (drive-run passes `['quit']`) · why: a stuck `ready` held `quit` in the queue · group 12
- `Split` gains `reloadWidth()` (`src/shared/page/ui/split.ts`) · why: a session's docs tree read the stored width only when added · consumers: docs page · group 12
### Rulings
- `start_app()` keeps `ENDPOINT_DIR` as its default; both entry points pass `endpoint_dir(os.environ)` — keeps the function free of env reads — a bare `start_app()` caller would ignore the variable · group 04
- `WIGLEY_AI_GUI_ENDPOINT_DIR` is used as given, no `expanduser` — the spec says `Path(env[...])` — a literal `~/` value would be relative; 09 sets an absolute path · group 04
- `chat-sessions.test.ts:363`'s resume assertion is an expanded-folder one and now expects `~/.claude` — the `work` profile writes `~/.claude` — one test line if wrong · group 03
- main.ts picks a service set through `ModeServices { trashItem; forWindow(context) }` and `servicesByMode: Record<RunMode, () => ModeServices>`, drive mapped to `selfTestServices` — files needs `trashItem` before the window exists — 09 switches one entry · group 01
- `selfTestHome` renamed `tempHome`, still `mkdtemp`'d and removed only by the self-test until 09 points drive at `<run>/home` · group 01
- `drag` waits 30 ms before each of its ten moves; `click` sends its three events with no gap; `typeText` waits after every character, the last included — the task names no gaps — a page needing a frame between hover and press misses it · group 02
- `ConsoleMessage.source` is `<sourceId>:<lineNumber>` from Electron's details object · group 02
- docs actions await docs' start before writing; `drive-docs-<n>` counts per start and a connect does not end earlier drive sessions; a non-string `sessionId` throws · group 08
- `chat.start` makes `projectDir` with `files.makeFolder` whether defaulted or named; no profile anywhere throws `chat has no profiles` — a mistyped folder becomes an empty one · group 07
- `chat.askPermission` resolves `{ toolUseId }` at once (id from `randomUuid`) and logs the reply as `[chat] drive permission <id> answered: …`; an unknown session throws — task 12 may want the answer through an action · group 07
- `sessions.connect` rejects an id it already holds; `sessions.connect` and `forms.openRound` reject a harness outside `HARNESSES`; the defaults (project `drive`, harness `claude`, deadline null) are literals in both plugins — they can drift apart · group 06
- `forms.answers` rejects when the latest `ask_round` rejected; `sessions.end` returns `{ sessionId }`, `sessions.activate` `{ rowId }` and logs on an unknown row · group 06
- the socket limit is measured in UTF-8 bytes, `<= 103` · group 06
- `quit` skips the ready wait; a ready wait past 30 s rejects `The page was not ready for keys within 30 s` · group 05
- `wait-log` matches anywhere in the current page log, an older identical line included · group 05
- `dispose` encodes a running recording rather than dropping it; frames are kept on a failed encode · group 05
- `screenshot` with a selector rounds the box outward before capture · group 05
- the server checks the token before method and path, answers 404 for anything but `POST /`, 500 on a request failure, `result: null` for undefined · group 05
- ended-run launch: `/bin/sh -c 'echo "$0" >&2; exit 1' '<message>'` (Windows `cmd.exe /d /c exit 1 & rem <message>`), cwd the run folder's filesystem root so the spawn never fails into the `npm start` fallback — a Windows path holding `"` or `%` could garble the text · group 09
- sessions finds the run folder as `path.dirname(services.homeDir)` rather than reading `WIGLEY_DRIVE_DIR` — breaks if a drive home stops being `<run>/home` · group 09
- `WIGLEY_DRIVE_HARNESS` is checked in `driveServices().forWindow`, failing through `failStart` after the window exists; a non-absolute `WIGLEY_DRIVE_DIR` fails first in `startApp` · group 09
- `dataFolder`/`uiStateFilePath` take the home and branch on `runMode === 'live'`; `tempHome` is the self-test's alone · group 09
- a rejected `listening` calls `failStart` from a `.catch`, not awaited in the whenReady chain · group 09
- CLI flags: `--run` on every command, `--packaged`/`--harness`/`--user-config` on `start` only, `--plugin` on `setting` only; any `--` argument is a flag, so `type --x` cannot type it · group 10
- `fit` with one argument takes it as the width when numeric, else the selector list; `do` takes any JSON value, `wait-log` and the catch-all a JSON object · group 10
- `restart` does not re-copy the user config; any reply to `ready` means already running; `app.log` is appended to; the 120 s timeout leaves the app running; Linux packaged binary `out/wigley-ai-gui-linux-<arch>/wigley-ai-gui` · group 10
- the drive skill gains a run-folder layout paragraph — the task named the layout and the skill had none · group 11
- CLI: a lone `--` ends flags (supersedes group 10's "any `--` argument is a flag"); `start --user-config` fails on a missing or empty folder; `quit` is a CLI command; a dead pid in `drive.json` is not running · group 12
- `eval` runs the script in a `{…}` block (const/let scoped, var/function global); `key` rejects an empty list; `wait-log` keeps whole-line matching and says so · group 12
- focus emulation runs before every drive command but `quit`, not inside `focus()` — the self-test would otherwise gain focus events it never tested against · group 12
- rows settled as stale, no code change: S3 (forms shows the heading count on the session row, not the status bar), D13 (the Docs tab reads its index when first shown, docs-browser design.md), K1's `Esc` hint (a bind without an unbind keeps the default's hint) · group 12
- forms findings by design: a re-asked submitted round replays its answers and opens nothing (`replaysLastSubmitted`); a new round pre-fills from the newest saved round with the same content, any session (`round-store.ts`) · group 12
### Review rounds
### Test gate
