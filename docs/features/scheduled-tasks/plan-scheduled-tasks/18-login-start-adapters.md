# 18 — Login-start adapters

Status: done
Type: Task
Wave: 4 · Depends on: 01, 06, 08, 13
Plan: [plan.md](plan.md)

This task builds the two macOS login-start adapters, the app's login entry that starts the session host, and the
pick in `main.ts`. Read `01-login-item-result.md` first: its `Pick:` line decides which adapter `main.ts` uses and
whether `forge.config.mts` changes. If the file is missing or reads `Pick: none`, stop and report a blocker to the
lead.

Both login starts run the same thing: the app executable with the flag `--start-session-host`. The app's login
entry in `main.ts` then starts the session host detached, exactly as the session host client would start it, and
exits. So the host's folder and channel are computed in one place, `main.ts`, and no plist holds a per-user path.

Files:     create `src/main/login-start/agent-service-login-start.ts` · create
           `src/main/login-start/launch-agent-login-start.ts` · test
           `src/main/login-start/launch-agent-login-start.test.ts` · test
           `src/main/login-start/agent-service-login-start.test.ts` · modify `src/contracts/login-start.ts` ·
           modify `src/main/main.ts` · modify `scripts/check-layers.mts` (only if a rule below needs it) · modify
           `forge.config.mts` (only when `Pick: agentService`)
Consumes:  `LoginStart`, `LoginStartStatus`, `LoginStartState` ← 06 · `MainServices.loginStart` ← 06 ·
           `createNoLoginStart()` ← 06 · `sessionHostLaunch(deps)` ← 13 · `APP_ENDPOINT_ENV` ← 08 · the result
           file `01-login-item-result.md` ← 01 · `SessionHostClientDeps` and `sessionHostChannel(platform, home,
           username, instanceId)` (tree, `src/main/session-host/`) · `appInstanceOf` (tree) · `Files.read`,
           `Files.stat`, `Files.write`, `Files.makeFolder`, `Files.deleteFile` (deletes for good; nothing there is no
           error; rejects for a folder), `Files.modified` (tests) (tree) · `createMemoryFiles` (tree, `src/shared/`)
Produces:  in `src/contracts/login-start.ts`:
           `export const LOGIN_START_FLAG = '--start-session-host';`
           `export const LOGIN_START_LABEL = 'wigley-ai-gui.session-host';`
           in `src/main/login-start/agent-service-login-start.ts`:
           `export interface LoginItems { setLoginItemSettings(settings: { openAtLogin: boolean; type: 'agentService'; serviceName: string }): void; getLoginItemSettings(options: { type: 'agentService'; serviceName: string }): { status?: string } }`
           `export function createAgentServiceLoginStart(loginItems: LoginItems): LoginStart`
           in `src/main/login-start/launch-agent-login-start.ts`:
           `export function createLaunchAgentLoginStart(deps: { files: Files; homeDir: string; programArguments: readonly string[] }): LoginStart`

## The app's login entry (`main.ts`)

- A start whose `process.argv` holds `LOGIN_START_FLAG` runs the login entry and nothing else of the app. The
  dispatch at the bottom of `main.ts` checks the flag before `runMode === 'live'`. The `loginShellEnv` read at the
  top (`main.ts` ~233) is skipped under the flag: add `!process.argv.includes(LOGIN_START_FLAG)` to its condition
  (`shouldReadLoginShellEnv({ isLive: …, parentPid: … })`), since the entry spawns no agent.
- The entry calls `app.setActivationPolicy('accessory')` first, so it takes no foreground and shows no Dock icon,
  as the self-test does. It takes no single-instance lock, opens no window and starts no plugin. The flag check sits
  before `startLiveApp`, which calls `app.requestSingleInstanceLock()` (`main.ts`, around line 1568, inside `startLiveApp`; the dispatch `if (runMode === 'live')` is at ~1577). Reason: a
  login start that reached the lock while the app runs would raise the running app's `second-instance` handler,
  which shows its window, and the login entry would then quit without starting the host.
- It builds the launch with `sessionHostLaunch` from the stable instance's values, the same values `startApp`
  gives `createSessionHostClient` in a live run:
  - `folder`: `path.join(app.getPath('appData'), appInstance.id, 'session-host')`. This equals
    `sessionHostFolder` of a live run, whose `userData` is `<appData>/<appInstance.id>`.
  - `channel`: `sessionHostChannel(platform.os, os.homedir(), platform.relay.username, appInstance.id)`.
  - `hostScript`: `path.join(__dirname, 'session-host.js')`; `execPath`: `process.execPath`.
- It spawns the launch's `command` and `args` with `detached: true`, `stdio: 'ignore'` and
  `env: { ...process.env, ...launch.env }`. It then waits for the child's first event: on `'spawn'` it calls
  `unref()`, then `app.exit(0)`; on `'error'` it writes the error to stderr and calls `app.exit(1)`. Reason: Node
  reports a spawn failure (ENOENT) as an `'error'` event after `spawn` returns, so an exit right after `spawn` would
  never see it. Node emits one of the two events for every child, so the entry needs no timeout. A host that finds
  its channel owned exits 0 by itself (`startSessionHost`), so a login start while a host already runs is harmless.
- Reason for detached: the launchd job's own process is the short-lived app executable, so neither an unregister
  nor launchd's process-group cleanup ends the host or its sessions. `AbandonProcessGroup` in both plists is the
  second guard.

## `createAgentServiceLoginStart`

- The service name is `${LOGIN_START_LABEL}.plist`, the plist in `Contents/Library/LaunchAgents/`.
- `set(true)`: reads the status. When it is not `enabled`, calls `setLoginItemSettings({ openAtLogin: true, ... })`,
  then reads the status again. `set(false)`: calls `setLoginItemSettings({ openAtLogin: false, ... })` when the
  status is not `not-registered`, then reads it again.
- Status after the call, to `LoginStartStatus` (pinned copy, shown in Schedules mode):

  | `status` | `on` asked | state | `detail` |
  |---|---|---|---|
  | `enabled` | either | `on` | null |
  | `requires-approval` | either | `needsApproval` | `Turn on Auri in System Settings > General > Login Items.` |
  | `not-registered` | true | `off` | `The login item did not register.` |
  | `not-registered` | false | `off` | null |
  | `not-found` | either | `off` | `This build has no session host login item.` |
  | anything else, or a thrown error | either | `off` | `Login start failed: <status or error text>` |

- The adapter imports nothing from `electron`. `main.ts` passes Electron's `app`, which fits `LoginItems`
  structurally. So the adapter tests run with a fake `LoginItems` and no Electron.

## `createLaunchAgentLoginStart`

- The file is `` `${homeDir}/Library/LaunchAgents/${LOGIN_START_LABEL}.plist` ``, a plain string join with no path
  module (`main.ts` passes `os.homedir()`, which ends in no `/`). Its text comes from a pure builder in the same file
  (not exported). The builder writes exactly this text, tab-indented, with a trailing newline. Each `<arg>` line is
  one program argument, XML-escaped (`&` → `&amp;`, `<` → `&lt;`, `>` → `&gt;`), in the given order:

  ```xml
  <?xml version="1.0" encoding="UTF-8"?>
  <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
  <plist version="1.0">
  <dict>
  	<key>Label</key>
  	<string>wigley-ai-gui.session-host</string>
  	<key>ProgramArguments</key>
  	<array>
  		<string><arg></string>
  	</array>
  	<key>RunAtLoad</key>
  	<true/>
  	<key>AbandonProcessGroup</key>
  	<true/>
  </dict>
  </plist>
  ```

  The `Label` string is `LOGIN_START_LABEL`. Reason: `set(true)` rewrites the file when its text differs, so the text
  must be one fixed form.
- `set(true)`: makes the `LaunchAgents` folder, reads the file when it exists, and writes the builder's text when
  the file is missing or its text differs. Resolves to `on`.
- `set(false)`: when the file exists, calls `files.deleteFile(file)`. Resolves to `off` with `detail` null. A
  rejection resolves to `off` with `Login start failed: <error text>`, since the plist may still be there.
- It runs no `launchctl`. launchd loads the file at the next login. A `bootout` would end a host launchd started,
  and every session in it; a `bootstrap` now is not needed, since the app that calls `set` has a host running.
- A failed read, write or delete resolves to `off` with `Login start failed: <error text>`. It never rejects.

## The pick in `main.ts`

- `loginStart` in the services literal: when `runMode === 'live'`, `!appInstance.isDev` and
  `platform.os === 'macos'`, the adapter the result's `Pick:` names; else `createNoLoginStart()`. For
  `launchAgent`: `programArguments` `[process.execPath, LOGIN_START_FLAG]`, `files` and `homeDir`
  from main's own values. For `agentService`: `createAgentServiceLoginStart(app)`.
- The adapter not picked stays in the tree, unused by `main.ts`, for a Mac where it works (plan.md § Decisions).
  Its tests keep it checked.
- `endpointEnv` sets `[APP_ENDPOINT_ENV]` in place of the literal `WIGLEY_AI_GUI_ENDPOINT_DIR`, imported from
  `src/shared/app-endpoint-dir.ts` beside `appEndpointDir`.

## `forge.config.mts` (only when `Pick: agentService`)

- In `showMacBundleAs`, before the `codesign` call, write `Contents/Library/LaunchAgents/wigley-ai-gui.session-host.plist`
  into the app bundle: `Label` `wigley-ai-gui.session-host`, `BundleProgram` `Contents/MacOS/wigley-ai-gui`,
  `ProgramArguments` `["wigley-ai-gui", "--start-session-host"]`, `RunAtLoad` true, `AbandonProcessGroup` true.
  The literals sit beside a comment naming `LOGIN_START_LABEL` and `LOGIN_START_FLAG` in
  `src/contracts/login-start.ts`, since the forge config does not import from `src/`. Task 01's spike wrote its
  plist at the same place in the same way.
- When `Pick: launchAgent`, leave `forge.config.mts` unchanged.

## Layers

`src/main/login-start` keeps the rule task 06 wrote (`src/contracts`, `src/shared`, no package): no adapter imports
`electron` or `node:`. The two test files import `src/shared` fakes, which that rule allows. Edit
`check-layers.mts` only if `npm run lint` shows a rule a file here breaks, and report the edit.

Decisions: try `agentService` first, fall back to a LaunchAgent file, both built, the pick from task 01's result
           (settled design, rounds 4–6; plan.md § Decisions) · label `wigley-ai-gui.session-host` and path
           `~/Library/LaunchAgents/wigley-ai-gui.session-host.plist` (plan.md § Shared names) · both plists run the
           app executable with `--start-session-host`, not the host itself, so the host's folder and channel come
           from `main.ts` at run time and a bundle plist holds no per-user path · the host spawns detached and the
           plists set `AbandonProcessGroup`, so switching login start off never ends a running session · only the
           live stable app on macOS gets a real adapter: the dev app never fires (settled design, round 3), and the
           self-test and drive runs must not register login items on the user's Mac · Windows login start is out of
           scope (plan.md § Out of scope)
GIVEN no LaunchAgent file WHEN `set(true)` runs THEN the file holds the builder's plist with the given program
arguments and the status is `{ state: 'on', detail: null }`
GIVEN the file with the same text WHEN `set(true)` runs THEN nothing is written
GIVEN the file with other text WHEN `set(true)` runs THEN it is rewritten
GIVEN the file WHEN `set(false)` runs THEN the file is gone and the status is `off` with `detail` null
GIVEN the file and a `deleteFile` that rejects WHEN `set(false)` runs THEN the status is `off` with
`Login start failed: <error>`
GIVEN a write that fails WHEN `set(true)` runs THEN it resolves to `off` with `Login start failed: <error>` and does
not reject
GIVEN `getLoginItemSettings` answers `requires-approval` WHEN `set(true)` runs THEN the status is `needsApproval` with
the pinned detail
GIVEN the app executable started with `--start-session-host` WHEN it runs THEN it starts the session host detached and
exits 0, with no window, lock or plugin (live check in task 21)
Tests:     `launch-agent-login-start.test.ts`, one `describe` for `createLaunchAgentLoginStart` over
           `createMemoryFiles({ now: () => now })` over a `let now` the test moves (as `plan-watch.test.ts` does)
           (wrap its `deleteFile` where a row needs it to reject). The test advances the clock before each `set`, so
           `files.modified(file)` shows a write:
           `it.each` over { the file before, `on` } → { the file after, the delete call, the status }: missing/true
           (the text equals the literal above with the arguments substituted), same text/true (`modified` unchanged),
           other text/true (`modified` moved), present/false, present/false with `deleteFile` rejecting (the
           pinned detail), missing/false (no delete call, or a no-op, since `deleteFile` on a missing file is no error) · `it('resolves to off with the reason when the write fails')` ·
           `it('escapes XML in a program argument')`, an argument holding `a&b<c>` lands as `a&amp;b&lt;c&gt;`.
           `agent-service-login-start.test.ts`, one `describe` for `createAgentServiceLoginStart` over a fake
           `LoginItems` that records each `setLoginItemSettings` call and answers a status per call:
           `it.each` over the status table above, both `on` values, each row's state and pinned detail ·
           `it('registers only when the status is not enabled')` · `it('resolves to off when the call throws')`.
           The login entry spawns a real process and exits the app: task 21 checks it live.
Done when: `npm run typecheck`, `npm run lint` and `npm test` exit 0 · `forge.config.mts` matches the result's
           `Pick:` · the reply to the lead states that this task registers nothing on the Mac: `set` first runs
           in the stable app once the user installs a build holding this change
Commit:    one commit for the group

## Proof

Commit aea7ed142 · proof: diff read: Produces present; wave 4 typecheck and lint pass after a2e4f76f4; app fits LoginItems type · concerns: login entry exits before ready: task 21 checks exit 0 and no Dock icon
