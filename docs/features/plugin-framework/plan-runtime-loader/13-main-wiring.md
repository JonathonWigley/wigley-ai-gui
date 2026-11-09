# 13 — Main composition over the catalog

Status: in progress
Type: Task
Wave: 5 · Depends on: 07, 08, 09, 10, 11 (it calls task 11's `servePluginScheme` and `userPluginFolder`, so it
cannot share wave 4 with 11; task 14, which also edits `main.ts`, then follows in wave 6)
Plan: [plan.md](plan.md)

Files:
- modify `src/main/main.ts`
- modify `src/config/keymap.ts` (`coreCommands`) · test `src/config/settings.test.ts` only if it lists core commands
  (search it first; add no new test file for the declaration)
- modify `src/contracts/commands.ts` (`CORE_RELOAD_PLUGIN`)

Not touched: `src/shared/define-plugin.ts` and `requireListed`. Task 02 moves `definePlugin`'s id check into
`pluginIdProblem` in `define-plugin.ts`, so the rule already has one source. Task 08's built-in source calls
`requireListed`, so it and its tests stay in `src/shared/plugin-manifests.ts`. This task removes only `main.ts`'
call (`readStartInputs`, line 595 at plan time).

Consumes:
- `createBuiltInSource({ manifests, mainParts })`, `createUserFolderSource({ pluginsFolder, codeFolder, codeRoot, userRoot, paths, importModule, log })`,
  `startPluginCatalog({ builtIn, user, log }): Promise<PluginCatalog & Disposable>` in `src/main/plugin-catalog/` ← 08
- `importModuleFrom(filePath)` ← 01
- `writePluginTypes({ files, typesFolder, emittedFolder, paths, log }): Promise<void>` (never rejects) and
  `emittedTypesFolder({ isPackaged, appPath, resourcesPath }): string` in `src/main/plugin-catalog/plugin-types.ts` ← 07
- `servePluginScheme(codeRoot: string, paths: Paths): void` in `src/main/data-protocol/data-protocol.ts`, the scheme
  registered by `registerAppSchemes()` ← 11
- `LayoutServiceDeps.userPluginFolder(owner: string): string | null` ← 11 (task 11 edits
  `src/main/layouts/layout-service.ts`; this task passes the value)
- `startPlugins(parts, process, start, known: readonly PluginManifest[] | (() => readonly PluginManifest[]), disabled, log)` ← 03
- `ConfigStore.plugins()`, `ConfigStoreDeps.plugins`, `ConfigStoreDeps.coreThemeTokens`, the new `UserConfigDeps` ← 09
- `createPluginSwitch` deps (`catalog`, `config`, `configDisabled`, `main` with `add`/`remove`), `heldAtStart`,
  `PluginSwitch.settled()`, `addPluginSwitchActions` deps (`ids`, `reload`, `pluginSwitch`) ← 10

Produces:
- `src/contracts/commands.ts`: `export const CORE_RELOAD_PLUGIN: CommandKey<string, 'core.reloadPlugin'> = { id: 'core.reloadPlugin' };`
- `src/config/keymap.ts`: `coreCommands[CORE_RELOAD_PLUGIN.id] = { label: 'Reload plugin', group: 'plugins', runsIn: 'main', arg: 'string' }`.
  No default key (`src/plugins/keymap.ts` unchanged).

Decisions:
- **Startup order**, pinned: start inputs → plugin catalog loaded (`await startPluginCatalog`) → config store
  (`loadConfigStore` with `plugins: catalog.entries()`) → plugin types written → schemes served → window → main
  parts started → plugin switch → page. Nothing reads `catalog.entries()` for parts after the store loads: main reads
  `store.plugins()` (the admitted entries), so a user entry the config refused never starts.
- **Folders.** User plugins: `path.join(configFolder(homeDir), 'plugins')`. Types:
  `path.join(configFolder(homeDir), 'plugins', '_types')`. Code copies: `path.join(app.getPath('userData'), 'plugin-code')`
  in a live run, else `path.join(homeDir, 'plugin-code')` (a function `pluginCodeFolder(homeDir)` beside
  `dataFolder`). The user source gets `pluginsFolder: scopedFiles(files, <plugins folder>, paths)`,
  `codeFolder: scopedFiles(files, <code folder>, paths)`, both roots as absolute paths, `importModule: importModuleFrom`,
  `log: pageLog.log`.
- **`readStartInputs`** drops `requireListed(mainParts, manifests)`. `StartInputs` gains `pluginCode: string` (the code
  folder) and `pluginsFolder: string`.
- **Catalog** is built in `startApp`'s ready handler after `readStartInputs`. A rejection fails the start through
  `failStart` (only a built-in bug can reject). `onQuit(() => catalog.dispose())` and
  `onSelfTestExit('the plugin catalog', () => catalog.dispose())`.
- **Config.** `configStoreDeps` passes `plugins: catalog.entries()` and `coreThemeTokens`, and drops `manifests` and
  `themeTokens`. `loadConfig` builds the applied list as: the config's `plugins.disabled` ids that
  `store.plugins()` holds, plus `heldAtStart(store.plugins())`, each id once, in that order.
  `createUserConfig({ files, folder, store, settingInfo, applied })`.
- **Types.** After the store loads, `writePluginTypes({ files, typesFolder, emittedFolder: emittedTypesFolder({ isPackaged: app.isPackaged, appPath: app.getAppPath(), resourcesPath: process.resourcesPath }), paths, log: pageLog.log })`
  runs and is awaited, with no `catch`. The function logs its own failure under source `plugins` and never rejects
  (task 07), so the start goes on.
- **Schemes.** `servePluginScheme(inputs.pluginCode, paths)` runs beside `serveDataScheme` and `serveLayoutScheme` in
  the ready handler. `registerAppSchemes()` (line 192) is unchanged here; task 11 adds the scheme to it.
- **Layouts.** `serveLayouts` passes `userPluginFolder: (owner) => catalog.entry(owner)?.folder ?? null` to
  `createLayoutService`. `createWindow` takes the catalog as a new parameter.
- **Main parts.** `startMainParts` takes the parts as `store.plugins().flatMap((entry) => entry.main === null ? [] : [entry.main])`
  and `known` as `() => store.plugins().map((entry) => entry.manifest)`. The host's type becomes
  `PluginHost<MainStart<PluginManifest>, MainPart>`. The rest of the start callback is unchanged.
- **Switch.** `createPluginSwitch` gets `catalog`, `config: store`,
  `configDisabled: () => store.current().settings.plugins.disabled`, and no `manifests`.
- **Drive actions.** `addPluginSwitchActions` gets `ids: () => store.plugins().map((entry) => entry.manifest.id)`,
  `reload: (id) => catalog.reload(id)` and `pluginSwitch: liveSwitch`. `ids()` serves `stopPlugin`, `startPlugin`
  and `restartPlugin` only. `reloadPlugin` does not read it: `catalog.reload` rejects an unknown id itself, and it
  accepts an id whose first load failed or that the config refused (task 10).
- **Core command.** Right after the switch is made, `createWindow` registers
  `commands.registry.register(CORE_RELOAD_PLUGIN.id, handler, 'core')`. The handler awaits
  `catalog.reload(context.arg)`, then `liveSwitch.settled()`. A rejection (a built-in id, an unknown id) passes to
  the router, which reports it as any failed command does. The registration lives as long as the window.
- **Static lists.** `main.ts` keeps `import { mainParts } from '../plugins/main'` and
  `import { manifests } from '../plugins/manifests'` for `createBuiltInSource` alone. No other line of `main.ts` reads
  them. `pluginThemeTokens` and `requireListed` leave `main.ts`' imports.

GIVEN a user plugin folder with a valid manifest at start WHEN the app starts THEN its main part starts after every
built-in main part, through the switch's launch job, and its commands are served
GIVEN `core.reloadPlugin` run with `"gallery"` (built-in) THEN the command rejects with
`Plugin "gallery" is built in; it reloads only with a rebuild`
GIVEN the types folder cannot be written THEN the app starts and the log holds `[plugins] plugin types not written: <error>`

Tests: no unit test (`main.ts` is the composition root, which no test imports). The `coreCommands` entry is covered by
`npm run typecheck`. Every runtime claim above is a live check of
[16-final-verification.md](16-final-verification.md): checks 1, 2 and 9 (start and types), 3 (reload), 7 and 8
(replace and delete). Run `npm run selftest -- --plugin settings` to prove the start order still serves the page.

Done when: compiles; `npm run typecheck` and `npm run lint` pass (the layer check included);
`grep -n "requireListed\|pluginThemeTokens" src/main/main.ts` prints nothing; `grep -n "manifests\b\|mainParts" src/main/main.ts`
shows only the imports and the `createBuiltInSource` call.
Commit:    one commit for the group.

## Proof
