# 02 — userConfig service

Status: not started
Type: Task
Wave: 2 · Depends on: 01
Plan: [plan.md](plan.md)

Files:     create `src/main/config/config-checks.ts` · `src/main/config/user-config.ts` ·
           modify `src/main/config/config-store.ts` · `src/main/main.ts` · `src/contracts/plugin.ts` ·
           test `src/main/config/user-config.test.ts` (`config-store.test.ts` stays green unchanged apart from 01's
           `settingInfo: {}`)
Consumes:  `UserConfig`, `UserConfigSchema`, `UserConfigRead`, `ConfigWriteResult`, `SettingLeaf`,
           `SettingControl` ← 01 · `settingInfo` (core) ← 01 · `pluginSettingInfo(manifests)` ← 01
Produces:  `MainServices.userConfig: UserConfig` in `src/contracts/plugin.ts`
           in `src/main/config/config-checks.ts`:
           `export interface ConfigCheckDeps` — the `ConfigStoreDeps` members the checks read
           `export interface ConfigSchema` — today's `Fixed` in `config-store.ts`, renamed and exported
           `export function configSchema(deps: ConfigCheckDeps): ConfigSchema`
           `export function checkSettingsText(text: string, deps: ConfigCheckDeps, schema: ConfigSchema): UserSettings`
           `export function checkKeymapText(text: string, deps: ConfigCheckDeps, schema: ConfigSchema): Keymap`
           `export async function readUserThemes(files: Files, folder: string): Promise<{ texts: ThemeFileText[]; problems: ConfigProblem[] }>`
           in `src/main/config/user-config.ts`:
           `export interface UserConfigDeps extends ConfigCheckDeps { files: Files; folder: string; store: ConfigStore; settingInfo: Readonly<Record<string, SettingInfo>> }`
           `export function createUserConfig(deps: UserConfigDeps): UserConfig`
           in `src/main/main.ts`: `services.userConfig` filled for every run mode
Decisions: one check per file shared by the ConfigStore and userConfig (round 2, locality) · whole-layer writes
           against expected text, refusing `changedOnDisk` (Decided, docs' `writeDoc` shape) · minimal 2-space JSON,
           atomic (Decided) · a broken file is reported, never overwritten by a read (Decided)
Done when: compiles; lint passes; the tests below and `config-store.test.ts` pass under the test gate
Commit:    one commit for the group

## The move

`config-store.ts`'s `Fixed`, its `settingsSlice` and `keymapSlice` check bodies (the `mergeUserSettings` call and the
`parseUserKeymap` → `mergeKeymap` → `requireUnambiguousKeymap` chain) and `readThemeFiles` move to
`config-checks.ts`; the store calls them and keeps its slice fallbacks, problem order and theme handling exactly as
today. `ConfigStoreDeps extends ConfigCheckDeps`. A rename is prose: no behaviour of the store changes.

## createUserConfig

- **schema** is built once, at create, and `createUserConfig` throws on what `pluginSettingInfo` throws on. Sections:
  core from `deps.settingInfo`, then each manifest with a declaration, in `deps.manifests` order. Leaves follow
  their declaration's key order. Each leaf's `control` follows the rule in task 01; `fallback` is `{ value }` when
  the defaults hold the path (`null` included), and `null` when only `optionalSettings` names it (`fonts.ui`).
  `defaultBinds` is `deps.defaultKeymap.binds` then each manifest's `keys?.binds` with command and scope qualified as
  `mergeKeymap` qualifies them; `defaultAccelerators` takes the same two layers' `app`, `global` and `intercept`
  lists. `commands`, `scopes` and `defaultLeader` come from `ConfigSchema`.
- **read** reads both files fresh (a missing file is `{ state: 'ok', layer: null, text: null }`, an unreadable one
  `broken` with `Could not read the file: <error>`):
  - `settings.json` is `ok` when `checkSettingsText` passes and the theme its merge names resolves; otherwise
    `broken` with the error's message. A theme error counts against `settings.json` only when it names
    `settings.json` (`ThemeError.file`), as the ConfigStore judges it.
  - `keymap.json` is `ok` when `checkKeymapText` passes, `broken` otherwise.
  - `layer` is the parsed JSON object.
  - `themes` lists each built-in theme's `name`, then each readable user theme file's `name` (sorted), with no name
    twice.
- **writeSettings / writeKeymap**:
  1. Read the file's text, with null for a missing file. When it is not `expectedText`, return `{ type: 'changedOnDisk' }`.
  2. Build the text `JSON.stringify(layer, null, 2) + '\n'`.
  3. Check it with `checkSettingsText` and then resolve the named theme against `readUserThemes`, or with
     `checkKeymapText`. Any throw returns `{ type: 'refused', problem }`, where `problem` is the message the
     ConfigStore would show (`errorText`, or `ThemeError.problem`). A theme error refuses the write only when it
     names `settings.json` (an unknown theme name), as read and the ConfigStore judge it: a broken user theme file
     is that file's problem, and the ConfigStore keeps the last good theme over it, so a form edit and a hand edit
     pass or fail alike.
  4. Otherwise `files.write(<folder>/<file>, text)` (atomic, creating the folder) and return `{ type: 'written' }`.
     An empty layer writes `{}\n`.
- **onChanged** wraps `deps.store.onChanged` with a listener that takes no argument. The store publishes only when the
  served config changes, so a text-only hand edit or an unused new theme file sends no signal; the page reads again
  whenever it opens a box or picker (task 05), which covers both.

## main.ts

Build `userConfig` once after `loadConfig`, from the same deps object `loadConfigStore` takes (factor
`loadConfig`'s object into a named const so both read one list), plus `store` and the core `settingInfo`. It joins
the services object handed to `startMainParts`, in every run mode; the self-test and a drive run write into their
temp home's config folder, since `folder` already sits under `inputs.homeDir`.

## Tests

`user-config.test.ts` on `createMemoryFiles()` (`src/shared/memory-files.ts`), with a small manifest list and theme
set built in the test, as `config-store.test.ts` builds its own:

- `read_NoFiles_BothOkWithNullLayers` — both `ok`, layers and texts null; `themes` lists the test's built-ins.
- `writeSettings_ValidLayer_WritesTwoSpaceJson` — `{ keySequenceTimeoutMs: 500 }` against null writes exactly
  `{\n  "keySequenceTimeoutMs": 500\n}\n` and returns `written`.
- `writeSettings_WrongKind_RefusedFileUntouched` — `{ keySequenceTimeoutMs: 'a' }` returns
  `refused` with `"keySequenceTimeoutMs" must be a number, not a string.`, and the file still holds its old text.
- `writeSettings_UnknownTheme_Refused` — `{ theme: 'nope' }` returns `refused` with `"theme" names "nope", which no
  theme has`.
- `writeSettings_TextChanged_ChangedOnDisk` — the file holds `{}` and `expectedText` is null: `changedOnDisk`,
  nothing written.
- `writeKeymap_SameKeysTwiceInOneLayer_Refused` — two user binds on `x` in one scope: `refused`, problem as
  `checkKeymapText` throws it.
- `read_BrokenSettings_Broken` — the file holds `{"nope": 1}`: `broken` with `"nope" is not a setting.`, `text` the
  file's text.
- `schema_Controls` — the test's defaults hold a choice path, a number, a null default with a `number` kind, an
  array, a `theme` path and an unset optional string; each leaf has the control and `fallback` the rule gives (the
  unset one `fallback: null`).
- `schema_PluginWithoutSettings_HasNoSection` — a manifest with `settings: {}` adds no section.
- `onChanged_StoreServesNewConfig_ListenerRuns` — a hand edit of the settings file reaches the listener (drive the
  store's watch as `config-store.test.ts` does).

## Proof
