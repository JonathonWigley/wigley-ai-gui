# App update

**Contents**

- **What it is** — the title-bar button and when it shows.
- **What counts as newer** — the baked commit, the fetch, the ancestry rule.
- **The install** — the detached program, its per-OS line, the log and exit-code files.
- **States** — the status slot and what each state draws.
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
(`WIGLEY_CLONE_DIR`), or null when either is missing.

The plugin runs `git fetch` in the clone at start, every 15 minutes, and when the window gains focus
(`core.windowFocused`; a focus within 60 s of the last check is skipped). The rule is the pure
`updateStatusOf` in `main/update-decision.ts`: an update is available when `origin/main` resolves
to a different commit and the installed commit is its ancestor (`Git.resolveCommit`,
`Git.isAncestor`). A build from a commit not on `origin/main` — a local branch — never offers one.
A failed fetch is logged and the check goes on with the `origin/main` the clone already has.

## The install

The install runs detached (`ProcessRunner.startDetached`, `src/contracts/processes.ts`): its own
process group, stdout and stderr appended to a log file, unref'd, so it outlives the app it quits.
The plugin's `dispose` only stops its timers, so nothing holds the quit.

`main/install-command.ts` builds the line per OS from `services.platform.os`:

- macOS: `/bin/zsh -lc "source ~/.nvm/nvm.sh && nvm use && npm run install-app -- --ref origin/main; echo $? > '<exit file>'"`
- Windows (untested): `powershell.exe -NoProfile -NonInteractive -Command "npm.cmd run install-app -- --ref origin/main; $LASTEXITCODE | Out-File -Encoding ascii -FilePath '<exit file>'"`.
  `npm.cmd`, because PowerShell's `npm.ps1` shim drops the `--`.
- Linux: no line, so the plugin checks nothing.

The log is `install.log` and the exit code `install-exit-code`, both in the plugin's data folder
(`api.dataFolder`). Starting an install empties both; the plugin polls the exit-code file every 2 s
while installing. A status of `installing` kept through a plugin restart resumes the polling.

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
finds the update again. An install that fails after it quit the app relaunches nothing; the next
start of the old build shows Update available, not the error.

## The dev app

The dev app (`npm start`) bakes no commit, so `services.appBuild` is null: the plugin logs that it
has no build and never fetches or shows the button. `app-update.install` and `app-update.check`
(main commands with no key) log that they skipped.

## Testing

`update-decision`, `install-command`, `installer`, `updater` and the main part have Vitest tests;
`process-git` and `node-processes` test the new seams. The self-test
(`main/selftest-script.ts`) seeds a fixture build, a fixture git one commit behind, and an install
that starts no program (`app-update.seed`, also a drive action). The page command
`app-update.pressButton` clicks the drawn button, since the self-test cannot click; the script
binds a key to it, checks Updating… and the disabled second press, then writes the log and exit-code
files the real line would write to reach Update failed and the re-check.
