# App restart command — plan

Feature: app restart · Implements: none · Ticket: none
Target: `main` in wigley-ai-gui and in wigley-ai-marketplace · Written: 2026-11-11

REQUIRED SUB-SKILL: Use wigley:make to implement this plan

## Goal

One command puts the running wigley-ai-gui app on the current build. Today an agent kills forge and Electron by
hand with `pkill` on several name patterns, then runs `start_app.py`. A missed process leaves an old instance that
serves the old build, and the patterns also match drive runs and other checkouts.

After this plan:

- The app writes its main process id into its `endpoint.json`.
- `start_app.py --restart [--dev]` asks that one process to quit, waits for it to exit, starts the app again and
  waits for its channel.
- `start_app.py --from <folder>` does the same for the dev app, and starts it from the named checkout.

Source: the approved retro brief `~/wigley-agents/learning/briefs/gui-app-restart-script.md`. The session that
lands this plan deletes that brief and commits the deletion in `~/wigley-agents` (task 04).

## Architecture

Two repos change together, because they share the endpoint file:

- **wigley-ai-gui** — the `sessions` plugin's main part writes `endpoint.json` (`src/plugins/sessions/main/start.ts`,
  `openRelay`). The record is `RelayEndpoint` in `src/plugins/sessions/contract.ts`. Its `launch` comes from
  `api.services.platform.relay.launch`, which the composition root builds through `platformFor` in
  `src/shared/platform.ts`. The new `pid` follows the same route.
- **wigley-ai-marketplace** — `plugins/wigley/scripts/forms/start_app.py` reads `endpoint.json`, probes the
  channel, and starts the app. The relay (`relay.py`) calls `start_app.start_app`. The relay does not change.

## Preconditions

Each command runs from the named repo root. `wigley:make` runs each one again before the first dispatch.

| Claim | Command | Result at plan time |
|---|---|---|
| The endpoint file is built in `openRelay` from `platform.relay.launch` | gui: `grep -n "api.services.platform.relay.launch" src/plugins/sessions/main/start.ts` | one hit, line 127 |
| The composition root builds the platform record once, with `platformFor` | gui: `grep -n "platformFor(osPlatform" src/main/main.ts` | one hit, line 459 |
| Electron turns SIGTERM into a quit, and the live app holds the quit until every part stops | gui: `grep -n "SIGTERM Electron turns into a quit" src/main/main.ts` | one hit, line 531 |
| forge 8.0.1's Vite plugin exits the forge process when Electron exits, so the quit ends the whole `npm start` | gui: `sed -n 237,244p node_modules/@electron-forge/plugin-vite/dist/VitePlugin.js` and `grep -m1 '"version"' node_modules/@electron-forge/plugin-vite/package.json` | `child.on('exit', …) → this.exitHandler({ cleanup: true, exit: true })`; version 8.0.1 |
| install-app's graceful quit commands and its 15 s limit | gui: `sed -n 288,320p scripts/install-app.mts` and `grep -n "QUIT_TIMEOUT_MS =" scripts/install-app.mts` | osascript `quit` on macOS, `CloseMainWindow()` through PowerShell on Windows; `15_000` |
| `start_app.py` reads `endpoint.json` into the `Endpoint` NamedTuple `(channel, command, cwd)` | marketplace: `grep -n "class Endpoint" -A4 plugins/wigley/scripts/forms/start_app.py` | three fields |
| The relay does not start the app within 30 s of a channel drop | marketplace: `grep -n "30 s" plugins/wigley/scripts/forms/README.md` | the "Starting the app" bullet |
| The plugin version before this plan's code commit | marketplace: `grep -n '"version"' plugins/wigley/.claude-plugin/plugin.json plugins/wigley/.codex-plugin/plugin.json` | `2.6.6` in both (the docs-ahead series set it) |

## Docs written ahead

Each line marks the new behaviour "planned in `app-restart`, not built yet". Task 03 drops those marks.

- wigley-ai-gui `AGENTS.md` § Running and testing: the "To put the running app on a new build" bullet, and the
  Contents line. Commit: see the wigley-ai-gui commit "Plan app restart: docs ahead and plan folder" on `main`.
- wigley-ai-marketplace `plugins/wigley/scripts/forms/README.md`: the `pid` field in "Finding the app", the new
  "Restarting the app" bullet in § The relay, the § Local commands line, and the Contents lines. The series ends
  on the bump to 2.6.6. Commit: the wigley-ai-marketplace commit "forms README: the planned app restart and the
  endpoint pid" on `main`.

## Mandatory Reads

- wigley-ai-gui `AGENTS.md`: the Intent, the relay paragraph after the `src/` tree in § Architecture ("Each Claude
  Code or Codex session runs the marketplace's `relay.py`…"), "An ambient service", and § Running and testing.
  The file is past 100,000 bytes: read those parts by line range.
- wigley-ai-marketplace `AGENTS.md`, whole (§ Changing a plugin and § Done apply to task 02).
- wigley-ai-marketplace `plugins/wigley/scripts/forms/README.md` § The relay, § Local commands, § Boundary rules.
- No `CLAUDE*.md` and no `.claude/rules/` exist in either repo.

## Design Overview

```
agent ─ python3 start_app.py --restart --dev            (or --from <checkout>)
          │
          ├─ read ~/.agents/wigley-ai-gui-dev/endpoint.json → channel, launch, pid
          ├─ channel accepts?
          │     no  → start as today (with --from: recorded command, cwd = <checkout>)
          │     yes → pid recorded?  no → fail: "the running app records no process id …"
          │                          yes → ask pid to quit
          │                                  macOS/Linux: SIGTERM → Electron quits; forge's Vite plugin exits npm start
          │                                  Windows:     CloseMainWindow() through PowerShell
          │                                wait ≤ 15 s for pid to exit → else fail, start nothing
          ├─ start: recorded command (cwd = <checkout> with --from), else the installed app (default folder only)
          └─ wait ≤ 45 s for the new app's channel → print ready
relay.py in each session ─ channel drops → waits → reconnects to the new app (unchanged "Late connection")
```

Decisions:

- The app records its main process id in `endpoint.json` as `pid`; the restart signals only that process (round 1).
- `--from <folder>` starts the dev app from another checkout; the default restarts in the recorded folder (round 1).
- The restart lives in `start_app.py`. The drive launcher manages only its own temp-home runs (Decided).
- Graceful quit only, a 15 s wait, never a force-kill, as `install-app` quits. On Windows the quit is
  `install-app`'s own `CloseMainWindow()` command; on macOS and Linux it is SIGTERM to the recorded pid, which
  Electron turns into its normal quit (Decided).
- `--from` checks its folder and the recorded command before it quits anything, so a refusal leaves the running
  app alone (Decided, cold read).
- The new start begins once the Electron pid exits. forge's Vite plugin then exits within milliseconds and does
  not touch `.vite/build`, so no wait for forge is added (Decided, cold read; task 02 names the source).
- `--dev` selects `~/.agents/wigley-ai-gui-dev`. With neither `--dev` nor `--from`, the folder is the one
  `endpoint_dir(os.environ)` gives today (Decided).
- With no app on the channel, `--restart` is a plain start. The quit is asked only while the channel accepts, so a
  stale `pid` in an old file is never signalled (Decided).
- `pid` is optional when `start_app.py` reads the file. An app built before task 01 writes no `pid`, and the plugin
  can update before the user installs the new app: a required field would make every relay lose the app. Only the
  restart needs it, and it fails with a reason when it is missing (Decided, design review).
- `pid` travels on `PlatformRelay`, beside `launch`: the composition root reads `process.pid` once, as it reads
  `process.execPath` for `launch`, so the sessions plugin reads no ambient process state (Decided, design review:
  ambient service injected).
- `--from` checks that the recorded command is an npm start (last element `start`). The dev app records its
  executable when npm did not start it, and that executable would run the old checkout's build (Decided).
- The restart's `npm start` takes no `.drive/start.lock`, as the user's own `npm start` takes none (Decided).

Out of scope:

- Electron's first-run download in a fresh worktree (the brief's second occurrence). That is an install, under the
  third-party gate.
- A relay change. The relay's existing reconnect ("Late connection") already reaches the new app.
- Restarting the stable app from a script in wigley-ai-gui. `npm run install-app` already quits and restarts it.

## File Structure

wigley-ai-gui (task 01):

- modify `src/contracts/platform.ts` — `PlatformRelay.pid`
- modify `src/shared/platform.ts` — `PlatformInputs.pid`, copied into `relay`
- modify `src/main/main.ts` — pass `process.pid`
- modify `src/plugins/sessions/contract.ts` — `RelayEndpoint.pid`
- modify `src/plugins/sessions/main/start.ts` — write `pid`
- modify `src/shared/platform.test-support.ts`, `src/shared/platform.test.ts`, `src/plugins/sessions/main/start.test.ts`
- modify every other `PlatformInputs` or `RelayEndpoint` literal the compiler flags

wigley-ai-marketplace (task 02):

- modify `plugins/wigley/scripts/forms/start_app.py`
- modify `plugins/wigley/scripts/forms/tests/test_start_app.py`
- modify `plugins/wigley/.claude-plugin/plugin.json`, `plugins/wigley/.codex-plugin/plugin.json` — the next patch version

Shared names (both tasks use them; the JSON key is the contract):

- `endpoint.json` key `pid`: a JSON integer, the app's main process id (`process.pid` in Electron's main process).
- TypeScript: `PlatformRelay.pid: number`, `PlatformInputs.pid: number`, `RelayEndpoint.pid: number`.
- Python: `Endpoint.pid: int | None` — `None` for a missing key and for any value that is not a positive,
  non-bool integer.

Boundary rules: `start_app.py` stays standard library only, and holds no forms logic (README § Boundary rules).
`src/contracts/` imports nothing.

## Tasks

> `wigley:make` ticks a box once its group is committed and proved, and sets `Status: done` in the
> task document in the same change. The run is done when every box is ticked.

### Wave 1
- [x] [App writes its process id to the endpoint file](01-endpoint-pid.md)
- [x] [Restart in start_app.py](02-start-app-restart.md)

### Wave 2
- [x] [Doc re-read](03-doc-re-read.md) — after 01, 02
- [ ] [Final verification](04-final-verification.md) — after 01, 02, 03

## Run log

Review base: b341b94a

### Groups
- 01 · hard · 1d8527bb · diff read: PlatformRelay.pid, PlatformInputs.pid, RelayEndpoint.pid present and written in openRelay; npm run typecheck passes · concerns: none
- 02 · deep · marketplace 8f13bb5 · diff read: Endpoint.pid, DEV_ENDPOINT_DIR, QUIT_WAIT_SECONDS, quit_process, process_exited, restart_app, parse_args present with planned signatures; py_compile passes; version 2.6.8 in both manifests · concerns: step 4's start_app re-reads endpoint.json after the old pid exits (plan's step 4 vs its read-once line); POSIX zombie reads as running; _winapi OpenProcess winerror unchecked on Windows
- 03 · standard · gui 0fd2cdc6, marketplace aed8e25 · diff read: every planned app-restart mark dropped in both docs; check_pointers.py passes; no contradiction found · concerns: none
### Contract changes
### Rulings
- Plugin version is 2.6.7 on marketplace origin/main at preflight (a peer's bump), so task 02 bumps to 2.6.8; marketplace review base ff28c63 — the plan's stated base moved — costs nothing if wrong · lead
- RelayEndpoint.pid carries a one-line comment matching its neighbour channel — consistency — one line to drop if unwanted · group 01
- restart_app step 4 calls start_app literally, which re-reads the endpoint file after the quit — the plan's read-once reason applies only while the old app stops — a later app that deletes endpoint.json at quit would break a plain --restart · group 02 · group 02
- a ready result after a quit reports 'restarted' even when start_app found another start already running — message only · group 02 · group 02
### Review rounds
- implementation review · gui 4c3d1da7, marketplace aed8e25 · NEEDS FIXES (1 determined, 1 open, 1 lead-applied reflow: gui 59031f49, marketplace b00e4a2)
- Fix cycle 1: marketplace e64a984..404c074 (finding 1 read-once launch, finding 2 zombie check). Tier High: process lifecycle. Re-review: correctness lane.
- re-review · marketplace e64a984, 404c074 · NEEDS FIXES (4 Minor, all determined; findings 1 and 2 closed)
- Fix cycle 2: marketplace 8ad97aa (one test row and a docstring) plus lead-applied prose 136a18f. Tier Low: tests and docs only, so it closes on its commit and compile.
### Test gate
- Tier High. marketplace at 136a18f: forms unittest 98 ok (2 skipped), check_manifests x2, check_pointers, scripts unittest, claude plugin validate pass. gui: npm run typecheck clean, vitest platform.test, start.test, relay/endpoint.test 32 passed.
