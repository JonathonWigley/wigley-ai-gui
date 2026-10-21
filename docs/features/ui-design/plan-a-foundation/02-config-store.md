# 02 — ConfigStore and the layered keymap

Status: done
Type: Task
Wave: 2 · Depends on: 01
Plan: [plan.md](plan.md)

Files:     create `src/main/config/config-store.ts` · create `src/main/config/user-settings.ts` ·
           create `src/main/config/user-keymap.ts` · test `src/main/config/config-store.test.ts` ·
           create `src/contracts/disposable.ts` · create `src/contracts/platform.ts` ·
           create `src/shared/keymap-checks.ts` · test `src/shared/keymap-checks.test.ts` ·
           modify `src/contracts/settings.ts` · modify `src/contracts/keymap.ts` · modify `src/contracts/bridge.ts` ·
           modify `src/contracts/plugin.ts` · modify `src/config/settings.ts` · modify `src/preload/preload.ts` ·
           modify `src/main/main.ts` · modify `src/main/keybindings.ts` · modify `src/main/plugins/main-api.ts` ·
           test `src/main/plugins/main-api.test.ts` · modify `src/main/selftest-config.ts` ·
           test `src/main/selftest-config.test.ts` · modify `src/shared/plugin-manifests.ts` ·
           test `src/shared/plugin-manifests.test.ts` · modify `src/renderer/key-sequences.ts` ·
           test `src/renderer/key-sequences.test.ts` · modify `src/renderer/editor-binds.ts` ·
           test `src/renderer/editor-binds.test.ts` · modify `src/main/claude-code/claude-code-harness.ts` ·
           test `src/main/claude-code/claude-code-harness.test.ts` · modify `src/plugins/forms/main/start.ts` ·
           modify `src/plugins/forms/main/forms-service.ts` · test `src/plugins/forms/main/forms-service.test.ts` ·
           modify `src/plugins/chat/main/start.ts` · modify `src/plugins/chat/main/chat-sessions.ts` ·
           test `src/plugins/chat/main/chat-sessions.test.ts` · modify `src/plugins/docs/main/start.ts` ·
           modify `src/plugins/docs/main/index-sources.ts` · test `src/plugins/docs/main/index-sources.test.ts` ·
           modify `scripts/check-layers.mts`
Consumes:  `resolveTheme(name: string, builtIns: readonly unknown[], userThemes: readonly ThemeFileText[], tokens: ThemeTokenRegistry): Theme`,
           `ThemeError` (`file`, `problem`), `ThemeFileText`, `ThemeTokenRegistry` ← 01 (`src/main/themes/theme-loader.ts`) ·
           `pluginThemeTokens(manifests: readonly PluginManifest[]): Record<string, TokenDecl>` ← 01 (`src/shared/plugin-manifests.ts`) ·
           `coreThemeTokens: Readonly<Record<string, TokenKind>>` ← 01 (`src/config/theme-tokens.ts`) ·
           `builtInThemes: unknown[]` ← tree (`src/config/themes/index.ts`, unchanged by 01) ·
           `Theme`, `Settings` (with `transparency`, optional `fonts`) ← 01 ·
           `ConfigProblem { file: string; message: string }`, `AppConfig.problems: ConfigProblem[]` ← 01 (01 serves `[]`; this task fills it) ·
           `PluginManifest.themeTokens` ← 01 ·
           `Files.watch`, `Files.read`, `Files.list`, `isMissingFile` ← tree (`src/contracts/files.ts`) ·
           `createMemoryFiles` ← tree (`src/shared/memory-files.ts`) · `commandInfos`, `scopeInfos`,
           `pluginSettings`, `overrideSettings`, `qualify` ← tree (`src/shared/plugin-manifests.ts`) ·
           `parseChord`, `isChordToken`, `CHORD_NOTATION_RULE` ← tree (`src/shared/chord-notation.ts`)
Produces:  `export interface Disposable { dispose(): void }` in `src/contracts/disposable.ts`
           `export type Platform = 'macos' | 'windows' | 'linux'` in `src/contracts/platform.ts`
           `AppConfig.platform: Platform` in `src/contracts/settings.ts`
           `export type KeymapUnbind`, `export interface UserKeymap` (plan.md's shapes) in `src/contracts/keymap.ts`
           `BRIDGE_CHANNELS.configChanged = 'bridge:config-changed'`,
           `Bridge.onConfig(listener: (config: AppConfig) => void): void` in `src/contracts/bridge.ts`
           `MainApi.settings(): M['settings']`,
           `MainApi.onSettingsChanged(listener: (settings: M['settings']) => void): Disposable` in `src/contracts/plugin.ts`
           `export interface ConfigStore { current(): AppConfig; onChanged(listener: (config: AppConfig) => void): Disposable }`,
           `export interface ConfigStoreDeps`, `export function loadConfigStore(deps: ConfigStoreDeps): Promise<ConfigStore>`
           in `src/main/config/config-store.ts`
           `export const optionalSettings: Readonly<Record<string, 'string' | 'number' | 'boolean'>>`,
           `export const settingChoices: Readonly<Record<string, readonly string[]>>` in `src/config/settings.ts`
           `export function dependencyOrder(manifests: readonly PluginManifest[]): PluginManifest[]`,
           `export function mergeKeymap(core: Keymap, manifests: readonly PluginManifest[], user: UserKeymap): Keymap`
           in `src/shared/plugin-manifests.ts`
           `export function requireUnambiguousKeymap(keymap: Keymap): void`, `firesIn`, `scopesOverlap`,
           `requireUnambiguousBinds`, `requireUnambiguousEditorBinds`, `requireWellFormedChords(binds: PageBind[]): void`
           in `src/shared/keymap-checks.ts`
           `export function applySelfTestConfig(config: AppConfig, selfTest: SelfTestConfig): AppConfig` in
           `src/main/selftest-config.ts`
           `export interface WindowKeybindings { setKeymap(keymap: Keymap): void }` and
           `installWindowKeybindings(window: BrowserWindow, keymap: Keymap, commands: MainCommands): WindowKeybindings`
           in `src/main/keybindings.ts`
Decisions: see the sections below; each carries its source.
Done when: compiles; `npm run typecheck`, `npm run lint` and `npm test` pass with the tests below;
           `npm run selftest` passes (its temp home holds an empty config folder, so it serves the defaults);
           `grep -n "'themes'" src/main/main.ts` finds nothing; no `chooseTheme` call is left in `main.ts`.
Commit:    one commit for the group

## ConfigStore

`loadConfigStore(deps)` starts the watch, reads the folder once, and resolves to the store; a broken
core or plugin layer (a clash or an ambiguity `requireUnambiguousKeymap` throws on), a broken
built-in theme, or a manifest id equal to a core setting key rejects, which fails the start through
`failStart` as today (plan.md, tree).

`ConfigStoreDeps` (each injected; plan.md "factory with its deps injected"):

| Member | Type | Filled by `main.ts` with |
|---|---|---|
| `files` | `Files` | the node files service |
| `folder` | `string` (absolute) | `path.join(homeDir, '.config', 'wigley-ai-gui')`; `homeDir` is the self-test's temp home under the self-test |
| `defaults` | `Settings` | `defaultSettings` |
| `optionalSettings` | as produced | `optionalSettings` |
| `settingChoices` | as produced | `settingChoices` |
| `coreKeymap` | `Keymap` | `coreKeymap` |
| `coreCommands` | `Record<CommandId, CommandDecl>` | `coreCommands` |
| `coreScopes` | `readonly ScopeInfo[]` | `coreScopes` |
| `manifests` | `readonly PluginManifest[]` | `manifests` |
| `builtInThemes` | `readonly unknown[]` | `builtInThemes` |
| `themeTokens` | `ThemeTokenRegistry` | `{ core: coreThemeTokens, plugins: pluginThemeTokens(manifests) }` |
| `resolveTheme` | `typeof resolveTheme` | task 01's `resolveTheme` |
| `platform` | `Platform` | `process.platform` mapped `darwin` → `macos`, `win32` → `windows`, anything else → `linux`, in `main.ts` |
| `log` | `Log` | a log forwarding to the window's page log once `mainWindow` exists, dropping lines before |

`resolveTheme` is injected so the store's tests drive theme choice with a stand-in, never the
shipped token registry (drafter; `wigley:writing-tests` "build the data you assert against").

Values in `src/config/settings.ts` (drafter: the type check needs a kind for keys the defaults leave
out, and one closed list per kind beside the defaults keeps core settings in one file):

| Name | Value |
|---|---|
| `optionalSettings` | `{ 'fonts.ui': 'string', 'fonts.mono': 'string', 'fonts.uiSize': 'number', 'fonts.monoSize': 'number' }` |
| `settingChoices` | `{ transparency: ['system', 'full', 'reduced'] }` |

### Reading, rebuilding and pushing

- Every rebuild reads `settings.json`, `keymap.json` and every `*.json` directly in `themes/` (sorted by
  name; `Files.list` of a missing folder is `[]`), and recomputes every slice and the whole `problems` list
  from scratch (drafter: three small files, so no per-file cache to keep true).
- The watch is `files.watch(folder, onChange, onError)`. A change rebuilds only when its relative path is
  `settings.json`, `keymap.json`, or `themes/<name>.json`; any other path (`.git/…`, swap files) is ignored.
- Rebuilds run one at a time; a change during a rebuild queues one more after it, and further changes
  while one is queued add nothing.
- `onChanged` listeners run after `current()` returns the new config, in registration order, only when
  the new `AppConfig`'s `JSON.stringify` differs from the current one's. A listener's throw is logged as
  `[config] listener failed: <errorText>` and the rest still run. `dispose` stops that listener.
- The folder: `Files.watch` creates it when missing, so the first start makes an empty
  `~/.config/wigley-ai-gui/` and writes no file in it (drafter: an empty folder is harmless in the user's
  git, and shows the user where config goes; the interview keeps the folder the user's own).
- `watch` throwing at start, or its `onError`, adds the problem `{ file: <folder, absolute>, message:
  'Cannot watch this folder, so edits apply on the next start: <errorText>' }` and the store keeps working
  without hot reload.

### Slices and the last good config

Three slices — settings (core and plugin), keymap, theme — each keep their last good value when the
file feeding them is broken, and each broken file adds one `ConfigProblem` (plan.md). At the first
read the last good value is the default (no user layer, `defaults.theme` from the built-ins). A
missing file is an empty override, never a problem. Fixing the file clears its problem at the next
rebuild, which applies the file.

`ConfigProblem.file` is the path relative to the folder, `/`-joined (`settings.json`, `keymap.json`,
`themes/dusk.json`), except the watch problem above. `problems` order: `settings.json`, `keymap.json`,
then theme files by path.

### settings.json

- The top level holds core settings by name and each plugin's settings under its plugin id
  (AGENTS.md § A setting). It deep-merges over `defaults` and `pluginSettings(manifests)`: objects merge
  key by key, arrays and scalars replace whole (lead).
- A key the defaults lack, and that `optionalSettings` does not name by its dotted path, is a problem
  (drafter: the user edits by hand, and a typo ignored in silence is a setting that never applies; this
  matches `overrideSettings`, which rejects an unknown name).
- A value whose JSON kind differs from the default's is a problem; a `null` default takes `null`, a
  number, a string or a boolean; an `optionalSettings` key takes its named kind; a `settingChoices` key
  takes only one of its strings.
- Any settings problem keeps the whole settings slice (core and plugin) at its last good value.
- A `theme` naming no built-in or user theme is the `settings.json` problem `resolveTheme` throws, which
  keeps the theme slice's last good theme; the rest of the file still applies.

### themes/

- The store reads each user file's text and hands every one to `resolveTheme` as
  `{ file: 'themes/<name>.json', text }`; task 01's loader does every check on them (JSON, `name`, a
  repeated name in the chain, a user theme replacing a built-in of the same `name`), so the store
  checks nothing itself.
- The theme slice resolves `settings.theme` (from the settings slice's good value) with
  `resolveTheme(settings.theme, deps.builtInThemes, userTexts, deps.themeTokens)`. A thrown
  `ThemeError` whose `file` is `settings.json` or one of the user files keeps the last good theme and
  adds `{ file: error.file, message: error.problem }`; any other throw (a built-in or a plugin default
  failing: a shipped bug) rejects the load at the first read, and after it keeps the last good theme
  with the problem `{ file: error.file, message: error.problem }` (drafter: a running app never stops
  on a config edit). One theme problem at most per rebuild: the loader throws on the first.
- `AppConfig.theme` is the resolved `Theme`; `AppConfig.commands` / `scopes` are `commandInfos` /
  `scopeInfos` over the core values and manifests, as `main.ts` builds them today.

### keymap.json and the layers

`UserKeymap` names commands and scopes qualified (`forms.nextItem`, `forms.review`, `any`), as help
and `keymap.page` show them (drafter: one file spans every plugin).

`mergeKeymap(core, manifests, user)` builds layers core → each plugin in `dependencyOrder` → user
(plan.md, design.md). In each layer after the first:

| List | A bind replaces an earlier layer's bind with |
|---|---|
| `page` | equal `keys` arrays and the same `scope` |
| `editor.binds` | the same keys after `withLeader` with the merged leader, the same `scope`, the same mode (absent = `normal`) |
| `editor.remaps` | the same mode and the same keys after `withLeader` |
| `app`, `global` | the same `accelerator` string |
| `intercept` | the same `key` and the same four modifier flags (absent = `false`) |

- A replacing bind takes the replaced bind's place in the list; a bind replacing nothing appends after
  every earlier layer's binds (drafter: help keeps its order when the user rebinds one key).
- Binds inside one layer never replace each other, so a clash inside a layer survives to
  `requireUnambiguousKeymap`, which throws (plan.md: only a clash inside one layer is an error).
- The user layer applies its `unbind` entries to the merged core and plugin layers first, by the same
  identities, then its binds. An `unbind` matching nothing is ignored (drafter: a plugin moving a
  default key must not break the user's file). `editor.leader` in the user file replaces the core's.
- `dependencyOrder` repeatedly takes the first manifest in list order whose `dependsOn` are all taken,
  the rule `startPlugins` follows; it throws `Plugins depend on each other in a cycle: <ids>` on a cycle.
  Today's list gives `keys, sessions, forms, chat, docs` (measured at plan time, re-verify).

The store parses the user file (`user-keymap.ts`), checks it against `AppConfig.commands` and
`scopes`, merges, then runs `requireUnambiguousKeymap` on the result. Any failure keeps the last good
keymap and adds one `keymap.json` problem (the first failure found).

`src/shared/keymap-checks.ts` takes the checks the page runs today, so main rejects a keymap the page
would throw on (drafter: main cannot import `src/renderer`): move `firesIn`, `scopesOverlap`,
`requireUnambiguousBinds` from `src/renderer/key-sequences.ts` and `requireUnambiguousEditorBinds` with
its helpers from `src/renderer/editor-binds.ts`, unchanged, with their tests; add
`requireWellFormedChords` (the two throws `createChordMatcher` makes today, which now calls it); and
`requireUnambiguousKeymap` runs the page, chord and editor checks. The renderer imports them from there.

### Problem messages

One sentence naming what is wrong and where; a JSON path in double quotes; ends with a period except
where it ends in another error's text (lead's style, pinned here):

| Case | Message |
|---|---|
| not JSON | `Not valid JSON: <SyntaxError message>` |
| read fails (not missing) | `Could not read the file: <errorText>` |
| top level not an object | `The top level must be a JSON object.` |
| unknown setting | `"window.wdth" is not a setting.` |
| wrong kind | `"window.width" must be a number, not a string.` (kinds: an object, an array, a string, a number, a boolean, null) |
| `null` default, wrong kind | `"keys.whichKeyTimeoutMs" must be a number, a string, a boolean or null, not an object.` |
| choice | `"transparency" must be one of system, full, reduced, not "glass".` |
| any theme failure, the unknown theme included | `ThemeError.problem` unchanged (task 01's text, e.g. `"theme" names "dusk", which no theme has`) |
| unknown keymap key | `"pages" is not a keymap section.` (in `editor`: `"editor.map" is not a keymap section.`) |
| unknown bind field | `"page[0].key" is not a field of a page bind.` |
| missing field | `"page[0].command" is missing.` |
| empty keys | `"page[0].keys" is empty.` |
| unknown command | `"page[0].command" names no command "keys.noSuchCommand".` |
| wrong process | `"page[0].command" names "forms.x", which runs in main; a page bind needs a page command.` (and `… which runs in the page; an app bind needs a main command.` for app, global, intercept) |
| unknown scope | `"page[0].scope" names no scope "forms.nope".` |
| editor mode | `"editor.binds[0].mode" must be one of normal, insert, not "visual".` |
| unbind shape | `"unbind[0]" must name one of page, editor, app, global, intercept.` |
| repeated accelerator in the user file | `"app[1]" binds Command+K, as "app[0]" does.` |
| repeated intercept chord in the user file | `"intercept[1]" binds the same chord as "intercept[0]".` |
| merged keymap ambiguous | the thrown check's text, unchanged |

## Composition root and main consumers

- `readStartInputs` keeps `requireListed`, the home folder and the data root; `whenReady` then awaits
  `loadConfigStore` before `createWindow(inputs, store)`. The `<userData>/themes` path goes.
- `createWindow`: the window's size and background read `store.current()` once (window size applies to
  the next window, which is the next start, since the one window hides; design.md).
- `createClaudeCodeHarness`: `ClaudeCodeHarnessDeps.command` becomes `command(): string`, read at each
  spawn; `main.ts` passes `() => expandHome(store.current().settings.claude.command, homeDir)`, so a new
  command applies to the next session (design.md).
- Main parts start against the store with no self-test layer, as today they start on their defaults
  (tree; AGENTS.md § Running and testing). `MainApiDeps.settings` becomes
  `pluginSettings(): Record<string, object>` and
  `onPluginSettingsChanged(listener: (settingsByPlugin: Record<string, object>) => void): Disposable`;
  `createMainApi`'s `settings()` reads the plugin's entry, and `onSettingsChanged` fires only when
  `JSON.stringify` of that plugin's entry differs from the last one it saw (lead: "pin the comparison").
- After `selfTest.closeHandover()`, the served config is `applySelfTestConfig(store.current(),
  selfTestConfig)`, computed at each `ipcMain.handle(BRIDGE_CHANNELS.config)` call (so a page reload after a config
  edit starts on the current config): the scripts' page binds after every bind, and their settings over the plugin
  settings through `overrideSettings` (lead: a settings layer above the user file). `ipcMain.handle(
  BRIDGE_CHANNELS.config)` returns it, and each `store.onChanged` sends
  `livePage(window)?.send(BRIDGE_CHANNELS.configChanged, served)`. Preload: `onConfig` copies `onLog`'s
  shape over `configChanged`.
- `src/main/keybindings.ts`: `installWindowKeybindings` keeps its first-call check and install, keeps one
  `before-input-event` listener reading the current intercept binds, and returns `setKeymap`, which
  rebuilds the menu and swaps the intercept binds. `registerGlobalShortcuts` calls
  `globalShortcut.unregisterAll()` before registering, so a second call replaces. On each change whose
  served `keymap` JSON differs from the last, `main.ts` builds the new menu and global shortcuts inside one
  try/catch, calling `setKeymap` and, outside the self-test once the page has finished loading,
  `registerGlobalShortcuts`. A throw keeps the previous menu and shortcuts and logs
  `[config] keys not applied: <errorText>`.
- Plugin main parts read live (call sites measured at plan time, re-verify):

| Part | Now | After |
|---|---|---|
| forms `main/start.ts` | copies `api.settings.deadlineSeconds` | `FormsServiceDeps.defaultDeadlineSeconds` becomes `() => number`, read where `forms-service.ts` reads it per session; passed `() => api.settings().deadlineSeconds` |
| chat `main/start.ts` | `profiles: api.settings.profiles` | `ChatSessionsDeps.profiles` becomes `() => readonly ChatProfile[]`, read per start; passed `() => api.settings().profiles` |
| docs `main/start.ts` | `startDocs(services, api.settings.scriptPath)` | `startDocs` and `IndexSourcesDeps.scriptPath` take `() => string`, read per index run |

- `scripts/check-layers.mts`: add `'src/main/config': { layers: ['src/contracts', 'src/shared', 'src/main/themes'], packages: ['node:'] }`, and `'src/main/config'` to `main.ts`'s layers.

## Tests

All through `loadConfigStore` with `createMemoryFiles()`, a folder `/home/.config/wigley-ai-gui`,
test-built manifests (`definePlugin`), a core keymap and command table built in the test, and a
`resolveTheme` stand-in with task 01's signature that returns a `Theme` named `name`, takes a user
text named `name` over a built-in, throws `new ThemeError('settings.json', '"theme" names "<name>", which no theme has')`
for a name nothing holds, and throws `new ThemeError(<that text's file>, 'broken')` for a selected user
text whose JSON has `"broken": true`. A test awaits the store's next `onChanged` after each write.

GIVEN no files WHEN the store loads THEN settings equal the defaults, the keymap is core then plugins, and problems are empty
GIVEN settings.json `{"window":{"width":1200}}` THEN `settings.window` is `{width:1200}` over the default height and minimums
GIVEN a plugin default `{ list: ['a','b'] }` and settings.json `{"p":{"list":["c"]}}` THEN `pluginSettings.p.list` is `['c']`
GIVEN a loaded settings.json WHEN it becomes `{"window":{"wdth":1}}` THEN settings stay and problems are `[{file:'settings.json', message:'"window.wdth" is not a setting.'}]`
GIVEN that problem WHEN the file is fixed THEN the problem is gone and the fix applies, in one `onChanged` call

Tests:     `config-store.test.ts`:
           `serves the defaults with no files` — settings deep-equal the defaults; `problems` `[]`; `platform` as passed
           `deep-merges settings.json over the defaults` — the window case above
           `replaces arrays and scalars` — the list case above
           `rejects an unknown setting` / `rejects a wrong kind` / `accepts a number over a null default` /
           `accepts an optional font setting` (`{"fonts":{"uiSize":14}}`) / `rejects a value outside its choices` — exact messages from the table
           `keeps the last good settings on invalid JSON` — message starts `Not valid JSON: `
           `clears the problem once the file is fixed` — one `onChanged`, problems `[]`, the new value served
           `replaces a plugin bind with the user's same keys and scope` — the user bind sits at the plugin bind's index
           `removes a bind the user unbinds` — `{"unbind":[{"page":["j"],"scope":"p.list"}]}` drops it
           `reports two user binds on one key in one scope` — keymap stays last good; the message is the check's text
           `reports a bind naming an unknown command` / `an unknown scope` / `a command of the other process` — table messages
           `uses a user theme over a built-in of the same name`
           `keeps the last good theme when the selected one breaks` — problem `{ file: 'themes/dusk.json', message: 'broken' }`
           `reports a theme name that names no theme` — problem `{ file: 'settings.json', message: '"theme" names "nope", which no theme has' }`; the other settings apply
           `ignores changes to other files` — a write to `notes.txt` then to `settings.json`: one `onChanged`, for the second
           `stops calling a disposed listener`
           `rejects a plugin layer with a clash inside it` — load rejects
           `plugin-manifests.test.ts`: `orders plugins by dependency, ties in list order` — `[a(dependsOn c), b, c]` gives `b, c, a`;
           `a later plugin layer replaces an earlier one's bind` — `a` depends on `b`, both bind `x` in `any`: `a`'s remains, once
           `main-api.test.ts`: `settings() reads the plugin's current settings`; `onSettingsChanged fires only when that plugin's settings change` — another plugin's change fires nothing
           `selftest-config.test.ts`: `applySelfTestConfig appends page binds and lays settings over the plugins'`
           `keymap-checks.test.ts`: the moved tests unchanged, plus `requireWellFormedChords rejects <Ctrl-h>` with `CHORD_NOTATION_RULE` in the message
           existing forms-service, chat-sessions, index-sources and claude-code-harness tests pass getters in place of values

## Proof

Proof: every Produces signature found in its file; `npm run typecheck` passes; `npm run lint` fails only on `DESIGN.md` format (pre-existing). The worker ran `npm test` (1648 pass) and `npm run selftest` (pass). Concerns and rulings in the Run log, group 02; commit sha there.
