# 04 — Windows per-version install folders

Status: done
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Repo: wigley-ai-gui, branch `main`. Spec: `AGENTS.md` § Running and testing, the `npm run install-app` paragraph
(already in its after-state; do not edit it), and `docs/features/session-host/design.md` § Platforms.

Files:     modify `scripts/install-steps.mts` · modify `scripts/install-app.mts` · test `scripts/install-steps.test.mts`
Consumes:  the session host's command line, from plan.md § Flow: `<app binary> <path>/session-host.js`. Task 06
           builds `session-host.js` and task 07 spawns it; this task matches only the text `session-host.js` in a
           process's command line, so it does not wait for them.
Produces:  in `scripts/install-steps.mts`:
           `InstallPaths` gains `installRoot: string | null` and `stagingDir: string`
           `export function installPaths(platform: NodeJS.Platform, arch: string, repoRoot: string, env: NodeJS.ProcessEnv, commit: string): InstallPaths`
           `export function installRootCleanup(entries: readonly string[], current: string): { olderAppFolders: string[]; leftovers: string[] }`
           `export function isStableAppProcess(platform: NodeJS.Platform, paths: InstallPaths, executable: string, commandLine: string): boolean`

## Decisions

### Paths (pure, `installPaths`)

- **The short sha** is the first 12 characters of the full commit sha that `resolveCommit` already returns
  (`git rev-parse --verify <ref>^{commit}`). It is sliced in `installPaths`, not read with `git rev-parse --short`,
  whose length changes with the repo's size. The folder name is `app-<12 chars>`.
- **Windows:** `installRoot` = `%LOCALAPPDATA%\Programs\wigley-ai-gui`; `installDir` = `<installRoot>\app-<12>`;
  `binary` = `<installDir>\wigley-ai-gui.exe`; `stagingDir` = `<installRoot>\staging`. The staging name must not
  start with `app-`, because the relay's `start_app` picks the newest `app-*` folder (task 03). The shortcut path
  does not change.
- **macOS** is unchanged: `installRoot` is null, `stagingDir` is `/Applications/wigley-ai-gui.app.new` (today's
  `${installDir}.new`). `installPaths` ignores `commit` on macOS. `stageInstall` and `swapInStagedInstall` read
  `paths.stagingDir` in place of building `${installDir}.new`.

### Which processes are the stable app (pure, `isStableAppProcess`; both OSes)

- The session host runs the app's own binary (plan.md § Flow). Today `runningStablePids` matches every process
  that runs the installed binary, so it would match the host: `quitStableApp` would then wait 15 s for a process
  that never quits and fail every install. So `isStableAppProcess` returns False for any command line that holds
  `session-host.js`. This applies on macOS too; it is the only macOS change.
- **macOS:** True when `executable` equals `paths.binary` and the command line holds no `session-host.js`.
  The lister runs `ps -axww -o pid=,args=` (`ww`: no width cut) and takes the executable as the first
  space-separated token of `args` (the installed binary path holds no space). This replaces `pgrep -f`.
- **Windows:** True when the folder holding `executable` is `installRoot` itself (today's flat install) or a folder
  directly under it whose name starts with `app-`, compared without case, and the file name is
  `wigley-ai-gui.exe`, and the command line holds no `session-host.js`. So an app of any installed version is quit,
  and a packaged drive run from `out\` is left alone, as today. The lister runs PowerShell
  `Get-CimInstance Win32_Process -Filter "Name = 'wigley-ai-gui.exe'"` and writes one line per process: the
  `ProcessId`, the `ExecutablePath` and the `CommandLine`, tab-separated. A process with no `ExecutablePath` is
  skipped. This replaces `stableProcessesScript`'s `Get-Process` match.
- `runningStablePids` becomes a lister that returns the matched rows (`pid` and `executable`). `quitStableApp`
  sends `CloseMainWindow` to the matched pids (`Get-Process -Id <pids>`) on Windows, and waits on the same filter.
  The macOS quit (`osascript … quit`) and the 15 s limit do not change.

### Windows install flow (`install-app.mts`, `main`)

1. Resolve the commit and build `installPaths(…, commit)`.
2. **Same sha already installed:** when `installDir` exists, skip the worktree checkout, `npm ci`, packaging and
   staging, and print `<ref> (<commit>) is already installed; reusing <installDir>`. A complete folder is the only
   kind that can exist under that name, since a folder reaches it only through the rename in step 5.
3. Otherwise stage: delete `stagingDir` (a failed run's leftover), then copy the packaged app to `stagingDir` while
   the stable app still runs.
4. Record the matched stable processes. **Quit only the matched rows whose executable is not inside
   `installDir`** (compared without case, as `isStableAppProcess` compares). A row inside `installDir` exists only in
   the same-sha path: the app already runs the build this run installs, so it is left running and not restarted.
   When rows remain to quit, quit them as today (no force-kill; 15 s; a timeout fails the install and leaves
   `stagingDir` for the next run to delete). Record the executable of the first quit row as the **previous
   binary**. In the path that stages, `installDir` does not exist yet, so every matched row is quit, as today.
5. When staged: `renameRetrying(stagingDir, installDir)`. A failure throws
   `Moving the staged app to <installDir> failed: <reason>`; nothing else changes, so the previous version stays
   installed.
6. Set `installDir`'s modified time to now (`utimesSync`), so it is the newest `app-*` folder the relay picks, also
   in the same-sha path.
7. Write the Start menu shortcut: target `binary`, working folder `installDir` (`writeShortcut` as today).
8. In `finally`, **only when step 4 quit a process**: start `binary` when it exists, else the previous binary (a
   failed move restarts the version that was quit, as today's failed swap does). The start stays detached, in the
   binary's folder. When step 4 quit nothing (no app ran, or it runs from `installDir`), start nothing: a second
   start would only meet the app's single-instance lock.
9. **Clean the install root** (below), after the `try`/`finally` of steps 5 to 8, so it runs only when the install
   succeeded and only after the app has started again. A cleanup failure only warns; it never throws or fails the
   run.

**Why the start comes before the cleanup.** A relay that holds a call polls the app's channel for 30 s from the
moment the app quits, then starts the app with the launch command the old app's `endpoint.json` records (task 03).
That command is the old `app-<old>\wigley-ai-gui.exe`; the new app rewrites `endpoint.json` when it starts. Deleting
older folders can take seconds, so it runs after the start, which keeps the quit-to-start gap to the quit, the
rename, the shortcut and the spawn. When the relay's start still runs first, the old exe is most often gone (its
folder was renamed and deleted), its spawn fails, and the relay falls back to the newest `app-*` folder. The one
case that starts the old build is a relay start past 30 s while a session host still holds `app-<old>`; it is
accepted, and the next `install-app` run quits that app. `install-app` does not edit `endpoint.json`: the app owns
that file.

The macOS flow keeps its order: stage, quit, swap in through `.old`, start.

### Cleaning the install root (Windows)

- `installRootCleanup(entries, current)` is pure. `entries` are the names in `installRoot`; `current` is the
  folder name of `installDir`. `olderAppFolders` holds every name that starts with `app-` other than `current`.
  `leftovers` holds every other name that does not start with `app-`. Both lists are sorted.
- **Older `app-*` folder:** first rename it to `<installRoot>\deleting-<name>` with `renameRetrying` (the quit
  app's handles release in that window). Windows refuses to rename a folder that holds a running exe, so a refused
  rename means a session host still runs from it. Then warn
  `Keeping <folder>: a running process holds it, most likely the session host of that version; the next install-app run deletes it (<reason>)`
  and leave the folder untouched. A partial `rmSync` on a held folder could delete files a running host still
  loads, so the rename is the lock check. After the rename succeeds, `rmSync` the `deleting-` folder (recursive,
  force); a failure warns, and the next run deletes it as a leftover.
- **Leftovers:** `rmSync` each one (recursive, force); a failure warns and names the path. This is the migration
  from today's flat install: the flat exe, its DLLs, `resources\`, `locales\` and every other file the flat install
  put directly in `installRoot` are leftovers, as are old `deleting-*` folders. User data is under `%APPDATA%`, not
  in `installRoot`, so nothing the user keeps is there. The quit in step 4 ended the flat app, and a flat build has
  no session host, so nothing holds those files. The first run therefore leaves only `app-<12>` in `installRoot`.
  No shim keeps the flat path (the user takes breaking changes).
- Also delete `<installRoot>.new` and `<installRoot>.old` (siblings of `installRoot`, left by the flat scheme's
  failed runs) when present.
- Print each deleted older folder's name.

## Behaviour

GIVEN a flat install in `Programs\wigley-ai-gui\` WHEN `install-app` runs on Windows THEN the root holds only
`app-<12>`, the shortcut targets the exe in it, and the app starts again when it was running.

GIVEN `app-<old>` holds a running session host WHEN `install-app` installs a new commit THEN `app-<new>` is in place,
`app-<old>` is kept with the pinned warning, and the run exits 0.

GIVEN `app-<12>` for the resolved commit exists WHEN `install-app` runs THEN it does not package, it makes that
folder the newest, writes the shortcut, and cleans the root. An app running from `app-<12>` keeps running and is not
restarted; an app running from an older folder or the flat install is quit, and `app-<12>`'s exe starts.

GIVEN a session host runs the installed binary WHEN `install-app` quits the stable app (either OS) THEN it does not
wait on the host.

## Tests

In `scripts/install-steps.test.mts`. `COMMIT` = `'0123456789abcdef0123456789abcdef01234567'`.

- `installPaths` win32 row (change): with `COMMIT`, the result equals today's values plus
  `installRoot: 'C:\\Users\\me\\AppData\\Local\\Programs\\wigley-ai-gui'`,
  `installDir: 'C:\\Users\\me\\AppData\\Local\\Programs\\wigley-ai-gui\\app-0123456789ab'`,
  `binary: 'C:\\Users\\me\\AppData\\Local\\Programs\\wigley-ai-gui\\app-0123456789ab\\wigley-ai-gui.exe'`,
  `stagingDir: 'C:\\Users\\me\\AppData\\Local\\Programs\\wigley-ai-gui\\staging'`.
- `installPaths` darwin row (change): today's values plus `installRoot: null`,
  `stagingDir: '/Applications/wigley-ai-gui.app.new'`.
- The linux and no-`LOCALAPPDATA` rows pass `COMMIT`; their messages do not change.
- `describe('installRootCleanup')`, one table test, current `app-0123456789ab`:
  | entries | olderAppFolders | leftovers |
  |---|---|---|
  | `['wigley-ai-gui.exe', 'resources', 'locales', 'app-0123456789ab']` | `[]` | `['locales', 'resources', 'wigley-ai-gui.exe']` |
  | `['app-0123456789ab', 'app-fedcba987654', 'app-111111111111', 'deleting-app-222222222222']` | `['app-111111111111', 'app-fedcba987654']` | `['deleting-app-222222222222']` |
  | `['app-0123456789ab']` | `[]` | `[]` |
- `describe('isStableAppProcess')`, one table test, paths from the win32 and darwin rows above:
  | platform | executable | commandLine | result |
  |---|---|---|---|
  | win32 | `…\Programs\wigley-ai-gui\app-fedcba987654\wigley-ai-gui.exe` | `"<that exe>"` | true |
  | win32 | `…\Programs\wigley-ai-gui\wigley-ai-gui.exe` (flat) | `"<that exe>"` | true |
  | win32 | `C:\USERS\ME\APPDATA\LOCAL\PROGRAMS\WIGLEY-AI-GUI\app-0123456789ab\wigley-ai-gui.exe` | `"<that exe>"` | true |
  | win32 | `…\app-fedcba987654\wigley-ai-gui.exe` | `"<that exe>" C:\…\resources\app.asar\.vite\build\session-host.js` | false |
  | win32 | `D:\ai-dev\.wigley-ai-gui-build\out\wigley-ai-gui-win32-x64\wigley-ai-gui.exe` | `"<that exe>"` | false |
  | darwin | `/Applications/wigley-ai-gui.app/Contents/MacOS/wigley-ai-gui` | `<that exe>` | true |
  | darwin | `/Applications/wigley-ai-gui.app/Contents/MacOS/wigley-ai-gui` | `<that exe> /Applications/wigley-ai-gui.app/Contents/Resources/app.asar/.vite/build/session-host.js` | false |
  | darwin | `/Users/me/ai-dev/wigley-ai-gui/out/wigley-ai-gui-darwin-arm64/wigley-ai-gui.app/Contents/MacOS/wigley-ai-gui` | `<that exe>` | false |
  (`…` is `C:\Users\me\AppData\Local`; write the full paths in the test.)

The I/O in `install-app.mts` (listing processes, quitting, renames, `rmSync`, `utimesSync`, the shortcut, the
start) has no unit test; its live check is the user's (see Done when).

## Done when

`npm test`, `npm run lint` and `npm run typecheck` pass, and the Produces signatures are in
`scripts/install-steps.mts`. Task 12 runs on macOS and leaves the user's stable app alone, so the live
`install-app` checks (the macOS run that must not wait on the host, and every Windows step above) are checks only
the user can run: they go in the run's wrap-up with their steps.

## Commit

One commit on `main`, for example: "install-app: install each Windows build into its own app-<short sha> folder,
move the shortcut, delete older folders no host holds, clear the flat install; never wait on the session host".

## Proof

Commit beff2ef0 · proof: diff read; typecheck clean in scripts/; install-steps tests pass; PowerShell and ps listers not run (live checks are the user's) · concerns: Windows PowerShell paths unrun on this Mac; rmSync on leftovers has no retry, so a flat migration may need a second run to clear; isStableAppProcess table has no row for a wrong file name in app-* or a deeper nested path
