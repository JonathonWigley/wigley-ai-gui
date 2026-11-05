# 03 — Window plugin

Status: not started
Type: Task
Wave: 2 · Depends on: 01
Plan: [plan.md](plan.md)

This task also takes the forms self-test's `process.platform` read from task 01. Task 01 cannot edit `src/plugins/forms/main/start.ts`, since task 02 edits it in the same wave. That move has its own section below.

Files:

- create `src/plugins/window/manifest.ts`
- create `src/plugins/window/main/start.ts`
- create `src/plugins/window/main/start.test.ts`
- modify `src/plugins/manifests.ts`
- modify `src/plugins/main.ts`
- modify `src/plugins/keymap.ts`
- modify `src/config/keymap.ts`
- modify `src/contracts/plugin.ts`
- modify `src/main/window.ts`
- modify `src/main/main.ts`
- modify `AGENTS.md` (the `src/plugins/` source tree)
- modify `src/plugins/forms/main/selftest-script.ts`
- modify `src/plugins/forms/main/start.ts`
- test `src/main/window.test.ts`
- test `src/shared/plugin-part-harness.test-support.ts`

Consumes:

- `Platform.os` and `OsName` in `src/contracts/platform.ts` ← 01. Only the forms self-test move uses them.
- `MainStart.commands`, in the tree: `Record<CommandsRunIn<M, 'main'>, (chord: string) => void>`.

Produces:

- `src/plugins/window/manifest.ts`: `export const windowManifest = definePlugin({ id: 'window', ... })`.
- `src/plugins/window/main/start.ts`: `export const windowMainPart: MainPart<typeof windowManifest>`.
- `src/contracts/plugin.ts`: `MainServices.window` gains `summon(): boolean`. It returns whether the window came forward.
- `src/main/window.ts`: `windowService` and `offscreenWindowService` implement `summon`.
- `src/plugins/forms/main/selftest-script.ts`: `formsSelfTestScript(sessions, userConfig, os: OsName)`.

Removed: `registerWindowCommands` in `src/main/window.ts`.

Pinned values:

- Plugin id: `window`.
- `dependsOn`: `{ main: [], page: [] }`.
- The command keeps its id `window.summon`, as `qualify('window', 'summon')`.
- Its declaration moves unchanged from `coreCommands`: `{ label: 'show the app', group: 'window', runsIn: 'main' }`.
- The default key stays `Control+Alt+Command+W`, in the `global` list of `src/plugins/keymap.ts`.
- The log text stays `${chord} summoned the window`.
- `settings`, `settingInfo`, `scopes` and `themeTokens` are `{}`.

Decisions:

- **The plugin cannot use `services.window.show`.** `show` calls `window.show()` and `window.focus()`. Summon calls `app.show()`, `window.show()` and `app.focus({ steal: true })`, because a hidden app stays inactive behind the frontmost app otherwise. A plugin cannot import Electron, so summon moves to the service.
- **`windowService.summon`** holds the body of today's handler, without the log line. It returns `false` for a destroyed window and `true` after the calls.
- **`offscreenWindowService.summon`** logs `window not summoned in ${runName}` under `main` and returns `false`, as its `show` does. It takes no foreground from the user.
- **The handler** is `(chord) => { if (services.window.summon()) { services.log(`${chord} summoned the window`); } }`.
- **The line now shows under `[window]`.** `services.log` is scoped to the plugin, so `[global]` changes to `[window]`. No self-test `expect` line names it (checked at plan time; re-verify with `grep -rn 'summoned the window' src`).
- **The manifest has no page part and no `contract.ts`,** as `auto-compact` has none. `scripts/layer-rules.mts` reads the plugin folders, so it needs no edit.
- **List position.**
  - In `mainParts` and `builtInManifests`, `window` goes last. No plugin depends on it, and its command does not run before the keys are installed.
  - `installWindowKeybindings` in `main.ts` runs after `startMainParts`, so `requireMainCommandsRegistered` still finds the command.
- **`BuiltInMainCommand` in `src/plugins/keymap.ts` loses `'window.summon'`.** The manifest now gives the type.
- **`coreCommands` loses the entry.** `commandInfos` throws on a command declared twice.
- **`main.ts`** loses the import at line 137 and the call at line 854. It keeps `const commands`.
- **Test fixtures that name `window.summon` keep it.** `src/shared/plugin-manifests.test.ts`, `src/main/config/user-config.test.ts` and `src/main/config/config-store.test.ts` build their own manifests and core commands.
- **A user can now disable the plugin.** `withMainStartList` then drops its `global` bind through `withoutPluginBinds`, so summon goes away with no error. This is how every plugin behaves.
- **The settings keymap view moves the row.** `src/plugins/settings/page/keymap-rows.ts` groups rows by `CommandInfo.plugin`, so "show the app" moves from the Core group to a new Window group. This follows from the move. The report to the user names it.
- **`AGENTS.md`:** add a `window/` entry to the `src/plugins/` tree, in the shape of the `auto-compact/` entry: `manifest.ts` and `main/` only, and the `window.summon` command.

Forms self-test move:

- `src/plugins/forms/main/selftest-script.ts:63-67`: remove `IS_WINDOWS` and the three module-level chip consts. Add a local function `chipPaths(os: OsName)` that returns `{ one, two, oneToggled }` with the same four literals by OS.
- `FILE_CHIPS_STEPS` at line 361 uses the paths, so it becomes `fileChipsSteps(chips)`. `formsSelfTestScript` builds `chips` once and passes it to that function and to the check at line 1110.
- `src/plugins/forms/main/start.ts:209`: pass `api.services.platform.os` as the third argument.
- This move also closes the follow-up **Forms self-test platform from services**.

GIVEN the live window WHEN `window.summon` runs from its global key THEN the app shows, the window shows, the app takes focus and the log says `[window] <chord> summoned the window`.

GIVEN a destroyed window WHEN `window.summon` runs THEN no Electron call runs and no line is logged.

GIVEN a self-test or drive run WHEN `summon` runs THEN no Electron call runs and the app keeps the user's foreground.

GIVEN a user's `keymap.json` that binds `window.summon` WHEN the config loads THEN the bind still resolves, since the id does not change.

GIVEN `window` in `plugins.disabled` WHEN main starts THEN the served keymap has no `window.summon` bind and no config problem names it.

GIVEN a self-test on Windows WHEN the forms script types its chips THEN it uses the `C:\chips` paths from the platform the app chose.

Tests:

- `src/plugins/window/main/start.test.ts`, `summon_WindowComesForward_LogsTheChord`: `startMainPart` with a fake `window` whose `summon` returns `true`. Run the part's `summon` handler with `'Alt+Space'`. Assert one `summon` call and the logged line `Alt+Space summoned the window`. Catches: the command running nothing, or its log text changing.
- `src/plugins/window/main/start.test.ts`, `summon_WindowDestroyed_LogsNothing`: the fake returns `false`. Assert no line. Catches: a line saying the window came forward when it did not.
- `src/main/window.test.ts`: move `summon_DestroyedWindow_DoesNothing` from `describe('registerWindowCommands')` into the `windowService` tests. It calls `windowService(window).summon()` and asserts `false`, `shown` empty and `electron.app.show` not called. Remove the `describe('registerWindowCommands')` block and its imports.
- `src/main/window.test.ts`, add `summon_LiveWindow_ShowsAndStealsFocus`: assert `app.show`, `window.show`, then `app.focus` with `{ steal: true }`, and the result `true`. Catches: summon falling back to `show`, which leaves a hidden app behind the frontmost app.
- `src/main/window.test.ts`, add `summon_Offscreen_LogsAndStaysBack`: assert `false`, no `app.show` and the line `window not summoned in <runName>`. Catches: a self-test taking the user's foreground.
- `src/shared/plugin-part-harness.test-support.ts:~696`: the fake `window` gains `summon: () => false`.

The `manifests_DefaultDisabled_BreaksNoDependency` and `manifests_SettingInfo_DeclaresEveryLeafSetting` rows in `src/plugins/manifests.test.ts` already cover the new manifest. Add no row. The compile checks that the global bind names a command the new manifest declares.

The forms self-test move has no new test. The filtered self-test for `forms` covers it, and runtime checks collect in [Final verification](16-final-verification.md).

Done when:

- `npm run typecheck` and `npm run lint` pass.
- `grep -rn 'registerWindowCommands' src` prints nothing.
- `grep -n "window.summon" src/config/keymap.ts` prints nothing.
- `grep -rn 'process\.platform' src --include='*.ts' | grep -v '\.test\.'` prints exactly two lines: one in `src/main/main.ts` and one in `src/session-host/session-host.ts`.
- The test gate runs the tests above.

Commit: one commit for the group.

## Proof

