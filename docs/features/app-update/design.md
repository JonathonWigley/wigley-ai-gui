# App update

**Contents**

- **What it is** — the title-bar button and when it shows.
- **What counts as newer** — the baked commit, the fetch, the ancestry rule.
- **The install** — the detached program, its per-OS line, the log and exit-code files, the clone's own installer.
- **States** — the status slot, what each state draws, and an earlier run's failure.
- **The dev app** — why it never checks.
- **Testing** — unit tests and the self-test's fixture.

## What it is

The `app-update` plugin shows an **Update available** button at the title bar's end, beside the
Keys button, while the installed app is behind its clone's `origin/main`. One click, with no
confirm, runs `npm run install-app -- --ref origin/main` in the clone; that script builds the app,
quits the running one and starts the new build. The button shows only while an update waits, runs
or has failed.

## What counts as newer

`install-app` bakes the commit it builds into the app as `WIGLEY_BUILD_COMMIT`, a Vite define in
`vite.main.config.mts` (empty when unset). Main's composition root hands plugins
`services.appBuild` (`src/contracts/app-instance.ts`): the baked commit and the clone folder
(`WIGLEY_CLONE_DIR`), or null when either one is missing, and null outside a live run, so a
self-test or drive run of a packaged app never fetches the user's clone.

The plugin runs `git fetch` in the clone at start, every 15 minutes, and when the window gains focus
(`core.windowFocused`; a focus within 60 s of the last check is skipped). The rule is the pure
`updateStatusOf` in `main/update-decision.ts`: an update is available when `origin/main` resolves
to a different commit and the installed commit is its ancestor (`Git.resolveCommit`,
`Git.isAncestor`). A build from a commit not on `origin/main` — a local branch — never offers one.
A failed fetch is logged and the check goes on with the `origin/main` the clone already has. A
clone git cannot read (moved, deleted, broken) makes `resolveCommit` reject, and the check logs
`check failed: …` rather than reading as up to date.

An app started from Finder fetches over ssh with the login shell's `SSH_AUTH_SOCK`, which main
takes along with its PATH (`AGENTS.md` § Dev quirks); launchd's own agent holds no key for a host
whose ssh config reads `IdentityAgent SSH_AUTH_SOCK`.

## The install

The install runs detached (`ProcessRunner.startDetached`, `src/contracts/processes.ts`): its own
process group, stdout and stderr appended to a log file, unref'd, so it outlives the app it quits.
The plugin's `dispose` only stops its timers, so nothing holds the quit.

`main/install-command.ts` builds the line per OS from `services.platform.os`:

- macOS: `/bin/zsh -lc "source ~/.nvm/nvm.sh && nvm use && npm run install-app -- --ref origin/main; echo $? > '<exit file>'"`
- Windows (untested): `powershell.exe -NoProfile -NonInteractive -Command "npm.cmd run install-app -- --ref origin/main; $(if ($null -eq $LASTEXITCODE) { 1 } else { $LASTEXITCODE }) | Out-File -Encoding ascii -FilePath '<exit file>'"`.
  `npm.cmd`, because PowerShell's `npm.ps1` shim drops the `--`; an `npm.cmd` that cannot start
  leaves `$LASTEXITCODE` null, which writes 1 rather than a blank line read as still running.
- Linux: no line, so the plugin checks nothing.

The log is `install.log`, the exit code `install-exit-code`, and the commit of the build that
started the install `install-from-commit`, all in the plugin's data folder (`api.dataFolder`).
Starting an install empties the first two and writes the third once the program runs; the plugin
polls the exit-code file every 2 s while installing. A status of `installing` kept through a plugin restart resumes the polling.

The line runs the clone's checked-out `package.json`, `scripts/install-app.mts` and `.nvmrc`, not
origin/main's: only the build is origin/main. The clone should sit on `main`, as it does under the
wigley landing rule; a clone on another branch may run an older installer, one that bakes no commit
and so leaves the new build with no button. An install that finds the clone off `main` logs a
warning and goes on.

## States

The `app-update.status` slot (`contract.ts`) is one of:

| Status | Button | Click |
|---|---|---|
| `none` | hidden | — |
| `available` (short sha) | Update available, its sha in the tooltip | starts the install |
| `installing` | Updating…, disabled | nothing |
| `failed` (error) | Update failed, danger look; the log's last 12 lines in the tooltip | retries |

A check never replaces `installing` or `failed`. A non-zero exit sets `failed`. A zero exit with
the app still running sets `none` and checks again; this build is still the old one, so the check
finds the update again.

A swap that fails after the quit starts the old build again (`install-app`'s `finally`). A slow
quit starts nothing: `install-app` waits 15 s for the app to quit and then gives up with `Nothing
was installed`, while the app's own quit holds until its tasks settle, with no cap, so the app
quits a moment later and the user is left with no app running. In both cases the error is only in
the exit-code file, so a start reads it, but only when `install-from-commit` names the running
build: a build installed another way (`npm run install-app` from a terminal) never shows an older
build's failure.

- A non-zero code, when the start's first check finds an update, shows `failed` with the log's
  tail. The file stays until the next install empties it, so each start of this build shows it
  while the update still waits.
- No code yet is the failed swap's race: `install-app` starts the old build again before its shell
  writes the code. The start shows `installing` and polls as a restart does, for up to 2 minutes
  from the start; past that with still no code it logs the cap, drops to `none` and checks.
- A zero code shows nothing.

## The dev app

The dev app (`npm start`) bakes no commit, so `services.appBuild` is null: the plugin logs that it
has no build and never fetches or shows the button. `app-update.install` and `app-update.check`
(main commands with no key) log that they skipped.

## Testing

`update-decision`, `install-command` and `updater` have Vitest tests, and the main part's tests
(`main/start.test.ts`) cover the installer through the harness's files: a stale exit code before an
install, a retry from `failed`, polling resumed after a restart, an earlier run's exit code at start (this build's or another's, and none yet, with its cap),
and the off-`main` warning. `process-git` and `node-processes` test the new seams, the latter
including the detached child's own process group. The self-test
(`main/selftest-script.ts`) seeds a fixture build, a fixture git one commit behind, and an install
that starts no program (`app-update.seed`, also a drive action). The page command
`app-update.pressButton` clicks the drawn button, since the self-test cannot click; the script
binds a key to it, checks Updating… and the disabled second press, then writes the log and exit-code
files the real line would write to reach Update failed and the re-check.
