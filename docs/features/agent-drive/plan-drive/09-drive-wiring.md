# 09 — Drive mode in the composition root

Status: done
Type: Task
Wave: 3 · Depends on: 01, 02, 03, 05, 06
Plan: [plan.md](plan.md)

Files:     modify `src/main/main.ts` · modify `src/plugins/sessions/main/start.ts` (the drive run's endpoint launch)
Consumes:  `runModeOf`, the per-mode service sets and `driveFor` dep ← 01 · `electronDrivenWindow(window: BrowserWindow): DrivenWindow` ← 02 · the Claude adapter expanding profile folders against its `homeDir` ← 03 · `startDriveRun(deps: DriveRunDeps): DriveRun` ← 05
Produces:  the `'drive'` run mode of plan.md § Drive protocol (env `WIGLEY_DRIVE_DIR`, `WIGLEY_DRIVE_HARNESS`; `<run>/home`; `drive.json`)
Decisions: temp home with fixtures by default, real Claude as an opt-in (round 1) · real Claude keeps the user's home for its config and sets `WIGLEY_AI_GUI_ENDPOINT_DIR` (rounds 3, 4) · offscreen accessory window, no lock (round 2)

## What changes

- **Home** — in a drive run the home is `<WIGLEY_DRIVE_DIR>/home`, created if missing and kept on exit, so `restart` finds the same ui-state, plugin data and config. `WIGLEY_DRIVE_DIR` that is not absolute fails the start with `WIGLEY_DRIVE_DIR must be an absolute path`. Plugin data and the ui-state file sit inside it, as in the self-test. The self-test's temp home and its clean-up are unchanged.
- **Service set** `driveServices(...)`: files whose trash deletes for good (every file is inside the run folder); silent alerts; window service with `chooseFolder` resolving null; `openExternal` logging `external link not opened in a drive run: <url>`; harnesses per `WIGLEY_DRIVE_HARNESS`:
  - `fake` or unset → `createFakeAgentHarness()`
  - `claude` → `createClaudeCodeHarness` built with `homeDir: os.homedir()` (the command expands against it too) and `env: { ...process.env, WIGLEY_AI_GUI_ENDPOINT_DIR: <home>/.agents/wigley-ai-gui }`, so its sessions log in as the user and their relays reach this run
  - any other value fails the start naming the two allowed values
- **Chromium profile** — before `app.whenReady`, a drive run calls `app.setPath('userData', <run>/user-data)`, so its Chromium profile and caches never share the user's app's or another run's.
- **Endpoint launch** — the sessions plugin writes `endpoint.json`'s `launch` from `launchCommand(process.env, …)`; under `npm run drive` that would start the user's live app when a relay finds the drive run gone. A drive run writes a launch command that exits 1 with `The drive run <run dir> has ended` instead (read `launchCommand` and the relay's `start_app` for the shape it takes; a sessions-side change, made here because main decides the run mode, passed through the sessions part's `api.services.runMode`).
- **Driver** — before `startMainParts`, `const driveRun = startDriveRun({ window: electronDrivenWindow(window), runDir, files, homeDir: home, processes, randomHex, configChanged: (listener) => store.onChanged(listener), quit: () => app.quit(), log })`; `driveFor` becomes `(pluginId) => driveRun.driveFor(pluginId)`; `will-quit` calls `driveRun.dispose()`; a rejected `listening` fails the start.
- **Failure** — `failStart` in a drive run writes `wigley-ai-gui could not start: <error>` to stderr and exits 1 (no dialog: the window is offscreen); the CLI shows `app.log`.
- `quit` goes through `app.quit()`, so `will-quit` flushes the ui-state file and disposes the parts; a drive run returns before the close-hides-the-window handler, as the self-test does.

GIVEN `WIGLEY_DRIVE_DIR` names a run folder WHEN the app starts THEN `<run>/drive.json` appears holding a port that answers `ready`

Tests:     none: the composition root is proved live in task 12
Done when: typecheck and lint pass; `npm run selftest` passes; `WIGLEY_DRIVE_DIR=<scratch run dir> npm start` writes `drive.json` and a `curl` to its port with the token answers `{"ok":true,"result":{"ready":true}}` to `ready`, then `quit` ends it (the worker runs this offscreen check; it takes no foreground)
Commit:    one commit for the group

## Proof
`13aee03` · proved: diff read against the spec; typecheck clean; relay tests 26 passed; the worker's offscreen check wrote `drive.json`, answered `ready` with `{"ok":true,"result":{"ready":true}}`, ran `do sessions.connect`, wrote the ended-run launch into the run home's `endpoint.json`, and `quit` ended the app within 1 s leaving `home/` and `user-data/` · concerns: ffmpeg is found only on the inherited PATH (true from a terminal's `npm run drive`); the will-quit ui-state flush was not observed (nothing changed it)
