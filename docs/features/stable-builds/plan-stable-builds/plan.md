# Stable builds — plan

Feature: stable-builds · Implements: none · Ticket: none
Target: main · Written: 2026-10-24

REQUIRED SUB-SKILL: Use wigley:make to implement this plan

## Goal

The user runs an installed stable build of the app, shown as **Auri**, on Windows and on the Mac, and keeps it open
while editing and testing the repo through `npm start` (**Auri Dev**). The two never fight: separate single-instance
locks, user data folders and relay endpoints, one shared user config. Agent rounds go to the stable app; the dev app
gets rounds only from the sessions it starts or from a session pointed at it. `npm run install-app` builds a committed
ref in a build-only worktree and installs it.

## Architecture

- **wigley-ai-gui main** — `src/main/main.ts` (composition root) picks the app instance from `app.isPackaged`, sets
  the user data path before the single-instance lock, names the window, gates global shortcuts, and hands the
  instance to plugins (`MainServices`) and the page (`AppConfig`).
- **sessions plugin (main)** — the relay channel and the endpoint folder follow the instance id.
- **renderer shell** — the window title and a Dev tag in the title bar.
- **packaging** — `forge.config.mts` shows Auri in the packaged app's OS metadata; `scripts/install-app.mts` builds
  and installs.
- **wigley-ai-marketplace relay** — `start_app.py` starts the installed app when no endpoint file exists.

## Preconditions

Each re-run by `wigley:make` before the first dispatch.

- The Forge makers and Squirrel startup check are gone (commit `8893ba63`):
  `git -C D:/ai-dev/wigley-ai-gui merge-base --is-ancestor 8893ba63 main` exits 0.
- The Electron 44.9.1 Windows zip is cached, so packaging downloads nothing:
  `find "$LOCALAPPDATA/electron/Cache" -name electron-v44.9.1-win32-x64.zip` prints one path.
- The build worktree path is free: `ls -d D:/ai-dev/.wigley-ai-gui-build` fails.
- No installed app yet: `ls "$LOCALAPPDATA/Programs/wigley-ai-gui"` fails.
- **Group 06 only:** `git -C D:/ai-dev/wigley-ai-marketplace status --short plugins/wigley/scripts/forms/start_app.py`
  prints nothing. At plan time it printed ` M` — a peer's uncommitted edit (a `CREATE_NO_WINDOW` change in
  `spawn_detached`). While it still prints, group 06 waits; never stash, revert or commit that edit.

## Docs written ahead

- `wigley-ai-gui/AGENTS.md` § Running and testing — "The stable app and the dev app" and `npm run install-app`
  bullets: committed with this plan folder.
- `wigley-ai-marketplace/plugins/wigley/scripts/forms/README.md` § The relay, "Starting the app" — the installed-app
  fallback: commit `590de60d`.

## Mandatory Reads

- `D:/ai-dev/wigley-ai-gui/AGENTS.md`
- `D:/ai-dev/wigley-ai-gui/DESIGN.md` (group 03: the title bar tag)
- `D:/ai-dev/wigley-ai-marketplace/AGENTS.md` (group 06)
- `D:/ai-dev/wigley-ai-marketplace/plugins/wigley/scripts/forms/README.md` § The relay (group 06)
- No `CLAUDE*.md` or `.claude/rules/*.md` exists in either repo (checked at plan time).

## Design Overview

```
 app.isPackaged ──► appInstanceOf()  (main.ts, once, at module load)
                      │
     ┌────────────────┼──────────────────────┬─────────────────────────┐
     ▼                ▼                      ▼                         ▼
 app.setPath('userData',            MainServices.appInstance     AppConfig.appInstance
   <appData>/<id>) — live only,       │                            │
   before requestSingleInstanceLock   ├─ sessions: channelPath(id) ├─ document.title = displayName
 window title = displayName           │   endpoint dir             └─ title bar: Dev tag when isDev
 global shortcuts only when           │   ~/.agents/<id>/
   ownsGlobalShortcuts                └─ drive harness: WIGLEY_AI_GUI_ENDPOINT_DIR = <run home>/.agents/<id>

 stable: { id: 'wigley-ai-gui',     displayName: 'Auri',     isDev: false }
 dev:    { id: 'wigley-ai-gui-dev', displayName: 'Auri Dev', isDev: true  }

 npm run install-app [--ref <ref>]
   ../.wigley-ai-gui-build (git worktree, detached at <ref>)
     → npm ci when package-lock.json differs from the last install's
     → electron-forge package
     → quit the running stable app → replace the install folder → shortcut (Windows) → start again if it ran
```

**Decisions**

- Stable vs dev is `app.isPackaged`, read once in `main.ts`; no other module reads it (interview, Decided).
- Agent rounds go to stable; dev gets rounds from its own Chat-tab sessions or `WIGLEY_AI_GUI_ENDPOINT_DIR` (Q1).
- The build packages a committed ref, `main` by default, in `../.wigley-ai-gui-build`; `npm ci` there is approved by
  the user (Q2).
- One command installs: `%LOCALAPPDATA%\Programs\wigley-ai-gui` plus a Start menu shortcut, or
  `/Applications/wigley-ai-gui.app`; template makers removed (Q3, landed in `8893ba63`).
- Both apps share `~/.config/wigley-ai-gui/` (Q4).
- Only stable registers global shortcuts (Q5).
- Display names Auri and Auri Dev, display only: exe, bundle, folders and paths keep `wigley-ai-gui` (Q6).
- `start_app.py` starts the installed app and drops the `npm start` fallback (Q7).
- One app-instance record crosses the seam to plugins and the page, so no module hard-codes `.agents/wigley-ai-gui`
  (design review: locality).
- User data is set explicitly to `<appData>/<id>`; stable keeps today's folder and its forms layouts, dev starts
  empty and nothing is copied (design review).
- `install-app` starts the stable app again after installing when it was running (design review).
- Drive runs keep their own homes and user data; only the drive harness's endpoint folder name follows the
  instance (design review). The self-test, which set no user data path, gets a fixed
  `<appData>/wigley-ai-gui-selftest`, so it never shares a profile with the stable app (cold reader).
- A stable app records its own exe as its launch command even when started from under `npm run` (cold reader).

**Out of scope**

- The Mac Dock label of the dev app under `npm start` stays "Electron": Electron has no API to rename an unbundled
  app's Dock label. The title bar's Dev tag marks it.
- Code signing, auto-update, installers for other people.
- Copying stable's plugin data or ui-state into the dev app.

## File Structure

**New**

- `src/contracts/app-instance.ts` — the `AppInstance` record; a contract because plugins and the page read it.
- `src/main/app-instance.ts` (+ `.test.ts`) — `appInstanceOf(isPackaged)`, the one place that maps packaged to
  stable.
- `scripts/install-app.mts` — the install CLI; `scripts/install-steps.mts` (+ `.test.mts`) — its pure parts (paths
  per platform, argument parsing, whether `npm ci` is due), matching `drive.mts` / `drive-args.mts`.

**Modified**

- `src/main/main.ts`, `src/main/window.ts`, `src/contracts/plugin.ts`, `src/contracts/settings.ts`,
  `src/main/config/config-store.ts` (01); `src/plugins/sessions/main/start.ts`,
  `src/plugins/sessions/main/relay/endpoint.ts`, `src/plugins/sessions/contract.ts` and the relay tests (02);
  `src/renderer/shell/title-bar.ts`, `src/renderer/renderer.ts`, `index.html` (03); `forge.config.mts` (04);
  `package.json` (05); `wigley-ai-marketplace/plugins/wigley/scripts/forms/start_app.py` (06).

**Shared names** (every task uses these exactly)

```ts
// src/contracts/app-instance.ts
export interface AppInstance {
  id: 'wigley-ai-gui' | 'wigley-ai-gui-dev';
  displayName: 'Auri' | 'Auri Dev';
  isDev: boolean;
}
```

- `MainServices.appInstance: AppInstance` and `AppConfig.appInstance: AppInstance` (01).
- Install paths: Windows `%LOCALAPPDATA%\Programs\wigley-ai-gui\wigley-ai-gui.exe`, macOS
  `/Applications/wigley-ai-gui.app/Contents/MacOS/wigley-ai-gui` (05 writes them, 06 launches them).

**Boundary rules**

- `src/contracts/app-instance.ts` imports nothing; the `src/contracts` layer rule in `scripts/check-layers.mts`
  already covers it.
- Only `src/main/main.ts` calls `appInstanceOf`; every other reader takes the record from services or the config.

## Tasks

> `wigley:make` ticks a box once its group is committed and proved, and sets `Status: done` in the
> task document in the same change. The run is done when every box is ticked.

### Wave 1
- [x] [App instance in main](01-app-instance-main.md)
- [x] [Packaged app shows Auri](04-packaged-metadata.md)
- [x] [install-app command](05-install-app.md)
- [x] [Relay starts the installed app](06-relay-installed-app.md) — waits on the peer's `start_app.py` edit

### Wave 2
- [x] [Relay per instance](02-relay-per-instance.md) — after 01
- [x] [Window title and Dev tag](03-title-and-dev-tag.md) — after 01
- [x] [App icon](09-app-icon.md) — after 04; added mid-run at the user's request

### Wave 3
- [x] [Doc re-read](07-doc-re-read.md) — after 01–06, 09
- [ ] [Final verification](08-final-verification.md) — after 07

## Run log

Review base: 590a7726fd2b6b5a85022515b6b2be94ee82a24d

### Groups
- 04 · 079e44ae · diff read: both options present, asar kept, name/executableName unset; worker typecheck passed; full compile at step 4 (01 mid-edit in tree) · concerns: @electron/packager 20.3.0 updatePlist overrides extendInfo CFBundleName/CFBundleDisplayName with name/executableName, so the Mac bundle likely still reads wigley-ai-gui; Windows metadata applies
- 01 · 14d9a780 · diff read: every Produces present (AppInstance, appInstanceOf, MainServices/AppConfig/ConfigStoreDeps.appInstance); typecheck passes; app-instance + config tests pass; lead ran oxfmt --write on the 3 touched test files (tooling-only) · concerns: worker sent no report after one nudge; diff is the record. No other MainServices/AppConfig fakes needed changing (typecheck clean)
- 05 · ec27018a · diff read: parseInstallArgs, InstallPaths, installPaths, isInstallDue present as planned; 10 steps in order; typecheck passes; install-steps tests pass; own files format-clean · concerns: PowerShell/shortcut/ditto/osascript steps untested until group 08; Windows rename of the install folder right after quit may hit EBUSY from lingering handles (lead)
- 06 · marketplace 30ab1331 · diff read: installed_app_command replaces npm_start_command as planned; default-folder rule in spawn_installed_app; worker ran forms unittest (only pre-existing AF_UNIX errors) and check_manifests (passed, rides 1.10.0) · concerns: Path equality treats a differently spelled default folder as non-default; start_app docstring's inserted sentence breaks the 'before then' reference and overruns the line width (lead)
- 03 · fbb31f31 · diff read: mountDevTag present as planned, document.title from appInstance, index.html title Auri; worker: own files pass oxfmt/oxlint/layers/styles; tsc clean outside group 02's in-flight endpoint.test.ts; full compile at step 4 · concerns: none
- 02 · ef896213 · diff read: channelPath(…, instanceId, tempDir?) and launchCommand(…, isDev) as planned; every 4-arg call site carries an instance id (grep); worker: typecheck, oxfmt/oxlint, endpoint + relay-server tests pass · concerns: channelPath doc comment reflow leaves a short broken line (lead)
- 09 · 217960b7 · diff read: packagerConfig.icon 'assets/icon/icon' (packager 20.3.0 adds .ico/.icns); four icon files present; lead viewed checker-1024 and 32px previews: no leak into the figure; worker: tsc, oxfmt, oxlint, layers clean · concerns: 16 px is hard to read with the head crop; pixel work is C# via Add-Type in PowerShell; no npm script for the rebuild
- 07 · 9474ec0a · diff read: every listed AGENTS.md line checked and fixed; lint passes; marketplace README left to the fix dispatch (peer edits at brief time, now clean) · concerns: Live dev app passes plain process.env to Claude (main.ts:197), so its Chat-tab sessions reach the stable app — contradicts Q1, AGENTS.md written to the bug; README Starting the app/Finding the app/failure list stale; WIGLEY_AI_GUI_ENDPOINT_DIR with ~ only expands in bash
### Contract changes
### Rulings
- Live run start split into startLiveApp(): setPath userData then requestSingleInstanceLock; self-test path chosen when runMode is not live and driveRunDir is null — self-test is the only such mode (RunMode = live|selfTest|drive) — lead · group 01
- Group 09 (app icon) added to wave 2 at the user's mid-run request; crop, shape, transparency and stable-only decided in a forms round — user — lead
- The AGENTS.md oxfmt failure, already at HEAD from the docs-ahead commit e5552191, goes to group 07, which edits that file — lint stays red until then — lead
- Empty LOCALAPPDATA/APPDATA counts as missing; packaged app checked before quitting the running app; macOS pgrep pattern anchored to the binary path — group 05 · group 05
- Default-folder rule lives in spawn_installed_app, so the recorded-command fallback shares it; tests patch start_app.ENDPOINT_DIR; launch_app(endpoint, endpoint_dir, env, spawn, installed_app) — group 06 · group 06
- No CSS change: the start track already sits inside the title bar's macOS and Windows padding — group 03 · group 03
- New tests use the file's prose it() names instead of the plan's snake_case names; existing npm-env launchCommand tests pass isDev true — group 02 · group 02
- assets/ stays outside the asar (Forge Vite plugin packs only /.vite) — group 09 · group 09
- Group 07's Q1 concern (dev Chat-tab sessions reached the stable app) fixed before review as a determined bug vs the user's decision: gui 5148782a endpointEnv for live and drive harness + AGENTS.md; marketplace 133f2011 README relay section + start_app docstring; rides plugin 1.10.0 (check_manifests passed) — lead
### Review rounds
### Test gate
- app-instance.test (added), endpoint.test + relay-server.test (channelPath/launchCommand changed), install-steps.test (added), config-store/user-config/selftest-config tests (fakes edited), marketplace tests.test_start_app (rewritten); tsc clean · vitest 7 files 135 passed 3 skipped (POSIX-only); unittest 23 OK 3 skipped · pass
