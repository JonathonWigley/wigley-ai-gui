# 01 — Platform record

Status: done
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

**Contents**

- **Files** — every path this task creates, modifies or tests.
- **Consumes and Produces** — the exact types, factories and alert adapters.
- **Decisions** — what the record holds and what stays out.
- **Moves** — each read this task replaces.
- **GIVEN/WHEN/THEN** — the behaviour to keep.
- **Tests** — new tests, moved tests and changed rows.
- **Done when and Commit** — the finish line.
- **Proof** — written by `wigley:make`.

## Files

Create:

- `src/shared/platform.ts`
- `src/shared/platform.test.ts`
- `src/shared/platform.test-support.ts`
- `src/main/alerts/mac-alerts.ts`
- `src/main/alerts/mac-alerts.test.ts`
- `src/main/alerts/windows-alerts.ts`
- `src/main/alerts/windows-alerts.test.ts` (takes the Windows rows of `electron-alerts.test.ts`)
- `src/config/settings.test.ts`

Modify, core:

- `src/contracts/platform.ts`
- `src/shared/os-platform.ts`
- `src/config/settings.ts`
- `src/main/main.ts`
- `src/main/alerts/electron-alerts.ts`
- `src/main/files/node-files.ts`
- `src/main/temp-folders.ts`
- `src/main/session-host/session-host-channel.ts`
- `src/session-host/session-host.ts`
- `src/session-host/os-processes.ts`
- `src/renderer/renderer.ts`
- `src/shared/local-channel/channel-path.ts`
- `src/shared/key-hints.ts`
- `src/shared/page/layout-host/base-kit.ts`
- `src/shared/page/ui/key-prompt.ts`
- `src/shared/page/ui/kbd.ts`

Modify, plugins that read the record:

- `src/plugins/sessions/contract.ts`
- `src/plugins/sessions/main/start.ts`
- `src/plugins/sessions/main/relay/endpoint.ts`
- `src/plugins/unity-pool/main/start.ts`
- `src/plugins/keys/page/start.ts`
- The 16 page files that read `api.platform` (measured at plan time, re-verify with `grep -rln '\bapi\.platform\b' src`). Each file is `src/plugins/<name>/page/start.ts`, for these names: `agent-lines`, `agent-skills`, `agent-strip`, `backlog`, `chat`, `docs`, `forms`, `gallery`, `notes`, `primer`, `sessions`, `settings`, `unity-pool`, `usage`, `visual`, `workflow`.

Modify, type import only (`Platform` becomes `OsName`):

- `src/plugins/settings/page/settings-view.ts`
- `src/plugins/primer/page/primer-view.ts`
- `src/plugins/forms/page/forms-view.ts`
- `src/plugins/forms/page/round-view.ts`
- `src/plugins/forms/page/kinds/item-format.ts`
- `src/plugins/forms/page/layout/layout-panes.ts`
- `src/plugins/backlog/page/backlog-view.ts`
- `src/plugins/gallery/page/gallery-view.ts`
- `src/plugins/notes/page/popup.ts`
- `src/plugins/keys/page/help-sections.ts`
- `src/plugins/keys/page/keys-for.ts`
- `src/plugins/keys/page/which-key.ts`
- `src/plugins/keys/page/anchors.ts`

Modify, docs:

- `AGENTS.md` (the `alerts/` entry of the source tree, the "ambient service" entry and the "A path" entry)
- `docs/features/ui-design/design.md` (the Kbd entry)

Test:

- `src/main/alerts/electron-alerts.test.ts`
- `src/shared/plugin-part-harness.test-support.ts`
- `src/plugins/manifests.test.ts`
- `src/plugins/sessions/main/relay/endpoint.test.ts`
- `src/plugins/sessions/main/start.test.ts`
- `src/plugins/unity-pool/main/start.test.ts`
- `src/main/config/config-store.test.ts`
- `src/main/config/user-config.test.ts`
- `src/main/selftest-config.test.ts`
- `src/main/files/node-files.test.ts`
- `src/renderer/plugins/page-api.test.ts`
- `src/session-host/host-children.test.ts`

The compiler finds any other reader. 38 non-test files under `src` read `.platform` (measured at plan time, re-verify with `grep -rln '\.platform\b' src --include='*.ts' | grep -v '\.test\.\|test-support' | wc -l`). That grep misses the destructure in `src/plugins/keys/page/start.ts:46`.

Do not change `scripts/*.mts`. They are CLIs outside the app, and they have no composition root.

## Consumes

Nothing from another task. The tree holds `MainServices.platform`, `PageApi.platform` and `AppConfig.platform`. Their member names stay. Their type `Platform` now means the record.

## Produces

`src/contracts/platform.ts`:

```ts
export type OsName = 'macos' | 'windows' | 'linux';

export interface PlatformLifecycle {
  readonly closeHidesWindow: boolean;          // closing the window hides it until the app quits
  readonly toastsNeedAppUserModelId: boolean;  // the OS shows a toast only for an app with an AppUserModelID
  readonly hidesFromDockBesideApp: boolean;    // a self-test or drive run stays out of the Dock
}
export interface PlatformPrograms {
  readonly claude: string;   // the default of the `claude.command` setting
}
export interface PlatformRelay {
  readonly username: string;  // the user part of the relay's channel path
  readonly launch: { readonly command: readonly string[]; readonly cwd: string };  // how a relay starts this app
}
export interface Platform {
  readonly os: OsName;
  readonly lifecycle: PlatformLifecycle;
  readonly programs: PlatformPrograms;
  readonly relay: PlatformRelay;
}
```

`src/shared/platform.ts`:

```ts
export interface PlatformInputs {
  username: string;
  env: NodeJS.ProcessEnv;
  execPath: string;
  cwd: string;
  isDev: boolean;
}
export function launchCommand(env: NodeJS.ProcessEnv, execPath: string, cwd: string, isDev: boolean): PlatformRelay['launch'];
export function createMacPlatform(inputs: PlatformInputs): Platform;
export function createWindowsPlatform(inputs: PlatformInputs): Platform;
export function createLinuxPlatform(inputs: PlatformInputs): Platform;
export function platformFor(os: OsName, inputs: PlatformInputs): Platform;
```

`src/shared/platform.test-support.ts`: `fakePlatform(os: OsName): Platform`. It calls `platformFor` with these inputs: username `'tester'`, env `{}`, execPath `'/app/exe'`, cwd `'/app'`, isDev `false`.

`src/shared/os-platform.ts`: `osPlatform(nodePlatform: NodeJS.Platform): OsName`.

`src/config/settings.ts`: `defaultSettingsFor(programs: PlatformPrograms): Settings` replaces the const `defaultSettings`. Its `claude.command` is `programs.claude`.

`src/main/alerts/electron-alerts.ts`:

```ts
export interface AttentionAndBadge {
  drawAttention(): void;
  showOpenCount(total: number): void;
}
export function createElectronAlerts(attention: AttentionAndBadge, log: Log): Alerts;
export function createPlainAlerts(log: Log): Alerts;  // Linux: notifications, no attention, no badge
```

`src/main/alerts/mac-alerts.ts`: `createMacAlerts(log: Log): Alerts`.

`src/main/alerts/windows-alerts.ts`: `createWindowsAlerts(window: BrowserWindow, log: Log): Alerts`.

`src/session-host/os-processes.ts`: `createOsProcesses(os: OsName): OsProcesses`.

`src/main/files/node-files.ts`: `NodeFilesOptions` gains `os: OsName`.

`src/plugins/sessions/contract.ts`: `RelayEndpoint.launch` becomes `{ command: readonly string[]; cwd: string }`.

## Pinned values

| Member | macOS | Windows | Linux |
|---|---|---|---|
| `os` | `'macos'` | `'windows'` | `'linux'` |
| `lifecycle.closeHidesWindow` | `true` | `false` | `false` |
| `lifecycle.toastsNeedAppUserModelId` | `false` | `true` | `false` |
| `lifecycle.hidesFromDockBesideApp` | `true` | `false` | `false` |
| `programs.claude` | `'~/.local/bin/claude'` | `'~/.local/bin/claude'` | `'~/.local/bin/claude'` |

## Decisions

- **The record is JSON.** Main serves it in `AppConfig.platform`, so the page reads the same record as `api.platform`. The record holds no function.
- **Member names stay** (`plan.md`). Main reads `services.platform.os`. The page reads `api.platform.os`. The follow-up writes `services.platform` for both sides. `plan.md` wins, so the page member stays on `api`.
- **Attention and badge are not record members.** They are behaviour and they need the window, so they cannot cross as JSON. They are the `Alerts` variants. The composition root picks a variant by `platform.os`.
- **A view keeps its `platform` dep as the OS string.** Its type becomes `OsName`. Each `start.ts` passes `api.platform.os`. No view, kit or key-hint function takes the record.
- **Linux gets a factory.** `osPlatform` names every other OS `linux`, and the follow-up names only Mac and Windows. Linux keeps what it does today: notifications, no attention and no badge.
- **`programs` holds only `claude`.** It is the one default program path the core owns. These stay out:
  - The `~/.local/bin/unity-pool` default in `resolveScriptPath` stays in the unity-pool plugin. A core list of plugin programs is a closed list a new plugin would edit. The plugin reads `services.platform.os`.
  - The `python3` in `docs/main/index-sources.ts` and the `claude` PATH lookup belong to the follow-up **Per-platform program lookup and spawning**.
- **`defaultSettings` becomes a function** so one literal holds the default. Main calls `defaultSettingsFor(platform.programs)`.
- **`launchCommand` moves** from `src/plugins/sessions/main/relay/endpoint.ts` to `src/shared/platform.ts`, since main builds the record. `endedDriveRunLaunch` stays in the plugin and takes `OsName`. It depends on the run's home.
- **`channelPath` stays in the plugin's call.** The record cannot hold the channel. The home folder and the app id are the plugin's inputs, and main does not know the home folder when it builds the record.
- **Each process reads `process.platform` once.** Main reads it in its composition root. The session host is its own Node process, and it reads it once in `session-host.ts` through `osPlatform`. An extra argument from main is not worth it, since a host outlives the app that started it.
- **The forms self-test read does not move in this task.** `src/plugins/forms/main/start.ts` must change to pass the OS, and task 02 changes that file in this wave. Task 03 does this move, after 01.
- **`platform` stays below `modeServices` in `main.ts`.** Line 318 runs `liveServices()` while the module loads, and that call only returns the `forWindow` closure. `forWindow` runs at line 878, after the module loads, so its read of the module-level `platform` finds the const. Read `platform` for `alertsFor` inside `forWindow` only. A read that runs during module load, above the `platform` line, throws a temporal-dead-zone error, and no test covers this wiring.

## Moves

`src/main/main.ts`:

| Line now | After |
|---|---|
| 324 | `platformFor(osPlatform(process.platform), { username: os.userInfo().username, env: process.env, execPath: process.execPath, cwd: process.cwd(), isDev: appInstance.isDev })`, moved between `modeServices` at 318 and `createNodeFiles` at 319 |
| 323 | the comment above `platform` names the record: `The platform record main runs on, as the served config and every plugin's services hold it.` |
| 319 | `createNodeFiles({ trashItem: modeServices.trashItem, os: platform.os })` |
| 245 | `alertsFor(platform.os, window, log)`, called inside `forWindow`. `alertsFor` is a new function at module level in `main.ts`. It picks `createMacAlerts`, `createWindowsAlerts` or `createPlainAlerts` |
| 325, 452, 528, 534, 784, 1057 | read `platform.os` |
| 572 | `defaults: defaultSettingsFor(platform.programs)` |
| 586, 873 | pass the record, as they do now |
| 975 | `platform.lifecycle.closeHidesWindow && !isQuitting` |
| 1005 | `platform.lifecycle.toastsNeedAppUserModelId` |
| 1009 | `runMode !== 'live' && platform.lifecycle.hidesFromDockBesideApp` |
| 1059 | `platform.relay.username` |
| 1083 | `!platform.lifecycle.closeHidesWindow && runMode !== 'selfTest'` |

Other files:

- `src/main/alerts/electron-alerts.ts`: keep the notification path, its `shown` set and its log line. Remove every `process.platform` read. The `failed` and not-supported paths call `attention.drawAttention()`. `setOpenCount` sums through `createOpenCounts` and calls `attention.showOpenCount(total)`.
- `src/main/alerts/mac-alerts.ts`: `drawAttention` calls `app.dock?.bounce('informational')`. `showOpenCount` calls `app.setBadgeCount(total)`.
- `src/main/alerts/windows-alerts.ts`: move `overlayDot`, the live-window check, `flashFrame`, the focus listener and the overlay description text here. The description text does not change.
- `src/main/files/node-files.ts:281`: read `os === 'macos'`, passed down from `createNodeFiles`.
- `src/session-host/session-host.ts:23`: `createOsProcesses(osPlatform(process.platform))`.
- `src/session-host/os-processes.ts:83`: `os === 'windows'`.
- `src/plugins/sessions/main/start.ts` (`openRelay`):
  - `channelPath` takes `api.services.platform.os` and `api.services.platform.relay.username`.
  - The live launch is `api.services.platform.relay.launch`.
  - `endedDriveRunLaunch` takes `api.services.platform.os`.
  - Remove the `node:os` import when nothing else uses it.
  - No read of `process.env`, `process.execPath` or `process.cwd()` stays in this file.
- `src/plugins/unity-pool/main/start.ts:49`: `services.platform.os === 'windows'`.
- `src/plugins/keys/page/start.ts:46`: destructure `keys` and `services`, and set `const platform = api.platform.os`.
- `src/renderer/renderer.ts:129,144,206`: read `config.platform.os`.
- `src/shared/plugin-part-harness.test-support.ts:689,1040`: `fakePlatform('macos')`.
- `src/config/settings.ts:15`: the comment names `defaultSettingsFor` in place of `defaultSettings`.
- `src/shared/os-platform.ts`: the comment names `OsName` in place of `Platform`, since the return type changes.

Docs:

- `AGENTS.md`, "An ambient service": `platform` is the `Platform` record, `platform.os` is the OS string, and the page reads the same record as `api.platform`.
- `AGENTS.md`, "A path": the page picks by the served `platform.os`.
- `AGENTS.md`, `alerts/` entry: name the Mac and Windows variants.
- `docs/features/ui-design/design.md`, Kbd: the page reads `platform.os` from the served config. Remove "the full Platform record stays a follow-up".

## Behaviour

GIVEN macOS WHEN the user closes the live window THEN the window hides until the app quits.

GIVEN Windows or Linux WHEN the last window closes in a live run THEN the app quits.

GIVEN Windows WHEN the app starts THEN it sets its AppUserModelID to `process.execPath`.

GIVEN macOS and a self-test or drive run WHEN the app starts THEN the activation policy is `accessory`.

GIVEN macOS WHEN a notification cannot show THEN the Dock bounces, and `setOpenCount` sets the badge count to the sum over sources.

GIVEN Windows and a destroyed window WHEN an alert call arrives THEN nothing throws and no window call runs.

GIVEN Linux WHEN a notification cannot show THEN nothing happens, and `setOpenCount` draws nothing.

GIVEN a live run WHEN sessions opens its relay THEN `endpoint.json` holds `platform.relay.launch` and the channel path holds `platform.relay.username`.

GIVEN a drive run WHEN sessions opens its relay THEN the launch is still `endedDriveRunLaunch` for the run's home.

GIVEN the dev app started by npm WHEN main builds the record THEN `relay.launch` is `[node, npm, 'start']` in `INIT_CWD`, as `launchCommand` gives today.

GIVEN no `claude.command` in the user's settings WHEN the config loads THEN the setting is `~/.local/bin/claude`.

## Tests

Create:

- `src/shared/platform.test.ts`, `platformFor_EachOs_HoldsItsQuirks`: one table row per OS, with the Pinned values table above. Catches: a quirk on the wrong OS, such as macOS closing the app with its window.
- `src/shared/platform.test.ts`, `launchCommand` rows: move the `describe('launchCommand')` block of `endpoint.test.ts` here unchanged. Its rows own the rule. Add `platformFor_Inputs_LaunchIsLaunchCommand`: `relay.launch` equals `launchCommand` of the same inputs, and `relay.username` equals `inputs.username`. Catches: a factory that drops an input.
- `src/main/alerts/mac-alerts.test.ts`, `announce_NotificationUnsupported_BouncesTheDock`: with `Notification.isSupported` false, `dock.bounce` runs with `'informational'`. Catches: attention lost in the split.
- `src/main/alerts/mac-alerts.test.ts`, `setOpenCount_TwoSources_BadgesTheSum`: counts 2 and 3 from two sources give `setBadgeCount(5)`. Catches: the badge showing one source.
- `src/main/alerts/windows-alerts.test.ts`: move `destroyedWindow_AnswersWithoutThrowing` and `liveWindow_UsesTheWindow` from `electron-alerts.test.ts`. Remove the `process.platform` stub.
- `src/config/settings.test.ts`, `defaultSettingsFor_Programs_SetsClaudeCommand`: `defaultSettingsFor({ claude: '/x/claude' }).claude.command` is `'/x/claude'`. Catches: a `defaultSettingsFor` that keeps the literal. `programs.claude` has the same value on all three OSes, so only a different value shows this break.

Change rows:

- `src/main/alerts/electron-alerts.test.ts`: the file stays, and it holds the rows of `electron-alerts.ts` only. Its `electron` mock has `app.dock.bounce` and `app.setBadgeCount` spies, and a `Notification` whose `isSupported` each row sets and whose `failed` listener a row can fire.
  - `createPlainAlerts_NotificationUnsupported_CallsNothing`: `announce` does not throw, and no spy runs. Catches: a Linux run that bounces or badges through a wrongly wired variant.
  - `createPlainAlerts_SetOpenCount_DrawsNothing`: `setOpenCount('forms', 2)` does not throw, and no spy runs. Catches: the same break on the count path.
  - `createElectronAlerts_NotificationFails_LogsAndDrawsAttention`: fire `failed` on a shown notification, with a fake `AttentionAndBadge`. Assert one `drawAttention` call and the `notification failed` log line. Catches: the shared `failed` path losing its attention call in the split.
- `src/plugins/sessions/main/start.test.ts`: the row that reads `endpoint.json` (near line 524) also asserts `launch` equals `platform.relay.launch`. Catches: `openRelay` going back to `process.env` and `process.execPath`. Set `platform` at line 246 to `fakePlatform(osPlatform(process.platform))`, and pass `platform.os` and `platform.relay.username` to the test's `channelPath` calls.
- `src/main/config/config-store.test.ts:152,244`: serve `fakePlatform('windows')`, and assert `config.platform` equals it. Catches: the store serving a partial record.
- `src/plugins/unity-pool/main/start.test.ts:16`: the parameter is an `OsName`, and the harness gets `fakePlatform(os)`. Its table rows stay.
- `src/plugins/manifests.test.ts`: read `plugins.disabled` from `defaultSettingsFor(fakePlatform('macos').programs)`.
- `src/main/files/node-files.test.ts`: pass `os: osPlatform(process.platform)`.
- `src/session-host/host-children.test.ts:124`: `createOsProcesses(osPlatform(process.platform))`.
- `src/main/selftest-config.test.ts:131`, `src/main/config/user-config.test.ts:112,591,659,689`, `src/renderer/plugins/page-api.test.ts:110`: `fakePlatform('macos')`.

No test covers the `main.ts` lifecycle wiring, since `main.ts` runs only in the app. Runtime checks collect in [Final verification](16-final-verification.md).

## Done when

- `npm run typecheck` and `npm run lint` pass.
- `grep -rn 'process\.platform' src --include='*.ts' | grep -v '\.test\.'` prints exactly three lines: one in `src/main/main.ts`, one in `src/session-host/session-host.ts`, and `src/plugins/forms/main/selftest-script.ts:63`, which task 03 removes.
- `grep -n 'os\.userInfo\|process\.env\|process\.execPath\|process\.cwd' src/plugins/sessions/main/start.ts` prints nothing.
- `grep -rn '\bdefaultSettings\b' src` prints nothing. This also catches a stale comment.
- The test gate runs the tests above.

## Commit

One commit for the group.

## Proof

Commit 1bcd3195 · proof: Diff read; every Produces signature present; typecheck and lint clean; process.platform grep prints the 3 expected lines; start.ts and defaultSettings greps print nothing. · concerns: main.ts lifecycle and alertsFor wiring untested until task 16; os.userInfo, cwd and env now read at module load in every run mode; the served config now carries username and launch to the page; contracts/plugin.ts comment and sessions start.test.ts changed beyond the task's Files.
