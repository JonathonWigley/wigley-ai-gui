# 01 — Login item spike

Status: done
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

This task finds out which macOS login start works for this locally signed app: Electron's `agentService` login item
(SMAppService, plist inside the bundle) or a LaunchAgent file in `~/Library/LaunchAgents`. Task 18 reads the result
and picks the adapter. The task changes no file in the repo except the result file. Every throwaway edit stays in a
scratch worktree, and every item the task registers on the Mac is removed before the task ends.

Files:     create `<gui>/docs/features/scheduled-tasks/plan-scheduled-tasks/01-login-item-result.md` · throwaway edits
           (never committed) to `src/main/main.ts` and `forge.config.mts` in the scratch worktree only
Consumes:  `app.setLoginItemSettings({ openAtLogin, type: 'agentService', serviceName })` and
           `app.getLoginItemSettings({ type: 'agentService', serviceName })` (Electron 44.9.1, macOS 13+; the
           plist goes in `Contents/Library/LaunchAgents/<serviceName>`; `status` is `not-registered`, `enabled`,
           `requires-approval` or `not-found`) · `showMacBundleAs` in `forge.config.mts` (tree: edits Info.plist,
           then runs `codesign`) · `npm run package` (tree: `electron-forge package`)
Produces:  the result file `01-login-item-result.md` (shape below), which task 18 reads

## Scratch set-up

- `<scratch>` is the session scratchpad directory the system prompt names. The spike folder is
  `<scratch>/login-spike/`. Every scratch file goes there.
- Make the worktree with `git -C <gui> worktree add --detach <scratch>/login-spike/worktree <base sha>`. `<base sha>`
  is the Review base in plan.md § Run log (origin's `main` at preflight).
- Link the clone's packages: `ln -s <gui>/node_modules <scratch>/login-spike/worktree/node_modules`. Install nothing.
  If packaging fails because of the link, stop and report the error to the lead as a blocker.
- Package from the worktree with `source ~/.nvm/nvm.sh && nvm use && npm run package`. The bundle is under the
  worktree's `out/` folder (`wigley-ai-gui.app`). `<bundle>` below is its absolute path.

## Throwaway edits in the scratch worktree

- `main.ts`: a branch for a start whose `process.argv` holds `--login-spike=<verb>`. It sits in the dispatch at the
  bottom of `main.ts`, before `runMode === 'live'`, and the module-level `loginShellPath` read skips under the flag
  (add the flag check to its condition), as task 18's login entry does. A launchd job has ppid 1, so the read would
  otherwise spawn the login shell. The branch runs inside `app.whenReady().then(...)`: it sets
  `app.setActivationPolicy('accessory')` first, does the verb, writes its JSON to
  `<scratch>/login-spike/out-<verb>.json`, and calls `app.exit(0)` last. Reason: task 18's adapter calls
  `setLoginItemSettings` in a ready app, so the spike calls it the same way. It takes no single-instance lock, sets no
  `userData` path, opens no window and starts no plugin, so the user's stable app data is not touched. The spike
  folder path is a literal in the code, because launchd passes no environment. Verbs:
  - `register`: `setLoginItemSettings({ openAtLogin: true, type: 'agentService', serviceName: 'wigley-ai-gui.spike.plist' })`,
    then writes `getLoginItemSettings(...)` for the same type and service name.
  - `status`: writes `getLoginItemSettings(...)`.
  - `unregister`: `setLoginItemSettings({ openAtLogin: false, ... })`, then writes `getLoginItemSettings(...)`.
  - `probe-service` and `probe-agent`: writes `{ pid, ppid, at }`, spawns `/usr/bin/tail -f /dev/null` with
    `detached: true` and `stdio: 'ignore'`, calls `unref()`, adds the child pid to the JSON, then exits. The child
    stands in for the session host, which task 18 spawns the same way.
- `forge.config.mts`: in `showMacBundleAs`, before the `codesign` call, write
  `<bundle>/Contents/Library/LaunchAgents/wigley-ai-gui.spike.plist` with `Label` `wigley-ai-gui.spike`,
  `BundleProgram` `Contents/MacOS/wigley-ai-gui`, `ProgramArguments` `["wigley-ai-gui", "--login-spike=probe-service"]`,
  `RunAtLoad` true and `AbandonProcessGroup` true. The plist is then sealed into the signature like Info.plist.

## Steps

1. Record `sw_vers -productVersion` and `codesign -d -r- <bundle>` (the `designated` line: `certificate leaf` or
   `cdhash`, which means ad hoc).
2. **agentService.** Run `<bundle>/Contents/MacOS/wigley-ai-gui --login-spike=register`. Read `out-register.json`.
   - `requires-approval`: stop. Report to the lead that the user must turn on the item in System Settings > General >
     Login Items. Do not toggle it yourself. When the lead says the user approved it, run `--login-spike=status` and
     continue with that status. The user approves once only; a second `requires-approval` counts as "fails". Do not
     unregister and register again to re-trigger the job: a new registration can ask for approval again.
   - `enabled` (at once, or after the approval): wait up to 15 s, by polling, for `out-probe-service.json`. RunAtLoad
     starts the job when launchd loads it: at registration, or when the approval enables it. Record whether it
     appeared, and `launchctl print gui/$(id -u)/wigley-ai-gui.spike`. `works` needs the probe JSON: an `enabled`
     status with no probe in 15 s is `fails: probe did not run`. Reason: task 18 needs launchd to start the app
     executable, and the status alone does not show that it did.
   - `not-registered` or `not-found`: record it as "fails" with the status.
3. Run `--login-spike=unregister`. Record its status. When the probe JSON holds a child pid, check with
   `ps -p <child pid>` whether the detached child survived the unregister, then `kill <child pid>`. With no probe
   JSON, skip the `ps` and the `kill`.
4. **LaunchAgent file.** Write `~/Library/LaunchAgents/wigley-ai-gui.spike-agent.plist` with `Label`
   `wigley-ai-gui.spike-agent`, `ProgramArguments` `["<bundle>/Contents/MacOS/wigley-ai-gui", "--login-spike=probe-agent"]`,
   `RunAtLoad` true and `AbandonProcessGroup` true. Run `launchctl bootstrap gui/$(id -u) <that file>`. Wait up to
   15 s, by polling, for `out-probe-agent.json`. Run `launchctl bootout gui/$(id -u)/wigley-ai-gui.spike-agent`.
   When the probe JSON holds a child pid, check whether the child survived the bootout, then kill it; with no probe
   JSON, skip both. Delete the plist file.
5. **Clean up and check.** Each check must pass. If one fails, fix it and report what was left and what removed it.
   - `launchctl print gui/$(id -u)/wigley-ai-gui.spike` and `launchctl print gui/$(id -u)/wigley-ai-gui.spike-agent`
     each report that the service is not found.
   - `--login-spike=status` reports `not-registered`.
   - `~/Library/LaunchAgents/wigley-ai-gui.spike-agent.plist` does not exist.
   - `ps -p <pid>` finds none of the child pids the probe JSON files recorded. Check by those pids, not by a
     `pgrep -f 'tail -f /dev/null'` pattern, since that pattern also matches processes the spike did not start.
   - `git -C <gui> worktree remove --force <scratch>/login-spike/worktree`; `git -C <gui> worktree list` does not
     list it.

## Result file

`01-login-item-result.md` holds these lines, each filled. A line whose check did not run holds `n/a (<the reason>)`,
for example `child survived unregister: n/a (register failed)` or `child survived bootout: n/a (probe did not run)`.

- `macOS:` the version · `Signing:` certificate leaf or ad hoc
- `agentService:` `works`, `works after one approval` or `fails: <status or error>` · `probe ran:` yes or no ·
  `child survived unregister:` yes or no
- `LaunchAgent file:` `works` (the probe JSON appeared) or `fails: <error>` · `child survived bootout:` yes or no
- `Pick:` `agentService` when it works (with or without the approval), else `launchAgent`. When both fail, write
  `none` and report it to the lead as a blocker for task 18.
- `Registered:` every item registered (both labels, the plist file path) · `Removed:` each one and the check that
  proved it gone.

Decisions: the user approves at most once, as the settled design allows (lead's ruling) · the spike registers from
           a scratch package and unregisters at the end; step 5 and task 21 both check the items are gone (lead's
           ruling) · spike labels differ from the production label `wigley-ai-gui.session-host`, so the spike cannot
           collide with a real login start · the probe spawns a detached child and exits, the shape task 18 ships
           (the app executable starts the host detached at login), so the result also tells whether an unregister
           ends the host · the branch sets the accessory activation policy, as the self-test does, so it takes no
           foreground
GIVEN the scratch bundle with the spike plist WHEN `register` runs and the status is `enabled` THEN the probe JSON
appears within 15 s and the result reads `agentService: works`
GIVEN `register` reports `requires-approval` WHEN the user approves once, `status` reads `enabled` and the probe JSON
appears within 15 s THEN the result reads `agentService: works after one approval`
GIVEN the status reads `enabled` WHEN no probe JSON appears within 15 s THEN the result reads
`agentService: fails: probe did not run`, and `Pick:` is `launchAgent` when the LaunchAgent file works
GIVEN every step ran WHEN step 5 runs THEN no spike service, plist file, child process or worktree remains
Tests:     none: a spike. Its result is a record, and the user checks the picked adapter (task 21 § The user's checks).
Done when: the result file holds every line above · every check in step 5 passes · the reply to the lead names each
           item registered and removed
Commit:    one commit that adds `01-login-item-result.md` only

## Proof

Commit 335b4f459 · proof: result file written; every step 5 cleanup check passed · concerns: no approval was asked, possibly from an earlier grant; a clean Mac may still need it; the detached host survives unregister
