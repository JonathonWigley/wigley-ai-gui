# 06 — The served config follows the applied list

Status: in progress
Type: Task
Wave: 4 · Depends on: 05
Plan: [plan.md](plan.md)

Files:
- create `src/main/plugins/applied-plugins.ts` · test `src/main/plugins/applied-plugins.test.ts`
- modify `src/main/main.ts` (`loadConfig`, `createWindow`, `served`) · `src/main/selftest-config.ts` · test `src/main/selftest-config.test.ts`
- modify `src/main/config/user-config.ts` · test `src/main/config/user-config.test.ts`
- modify `src/renderer/started-config.ts` · test `src/renderer/started-config.test.ts` · modify `src/renderer/renderer.ts`
- `src/main/config/config-store.ts` stays unchanged. See "The seam" below.

Consumes:
- `const pageHost = startPlugins(…)` in `src/renderer/renderer.ts` ← 05. This task changes only the `disabled` argument of that call.
- `startPlugins(parts, process, start, known, disabled, log)`, unchanged ← 02.
- `withoutPluginBinds(keymap, commands, pluginIds, side)` and `withoutUnhandledRuntimeBinds` in `src/shared/plugin-manifests.ts` (in the tree).
- `mainStartList(isSelfTest, disabled)` and `applySelfTestConfig` in `src/main/selftest-config.ts` (in the tree).

Produces, in `src/main/plugins/applied-plugins.ts`:
- As plan.md gives it:
  ```ts
  export interface AppliedPlugins {
    disabled(): readonly string[];
    set(disabled: readonly string[]): void;
  }
  export function createAppliedPlugins(initial: readonly string[]): AppliedPlugins;
  ```
  `disabled()` returns the last list `set` gave, or `initial` before any `set`. `set` keeps its own copy, so a caller that changes its array later changes nothing here. Nothing listens: task 08 pushes the served config after it sets.
- **Added beyond plan.md:** `export function withAppliedList(config: AppConfig, disabled: readonly string[]): AppConfig`. It replaces `withMainStartList`, which goes from `selftest-config.ts`. It returns `config` with:
  1. `settings.plugins.disabled` set to `[...disabled]`, exactly, in its order. The user's own list from `settings.json` is not joined in.
  2. The main binds (`app`, `intercept`, `global`) and the page binds (`editor.binds`, `page`) whose command belongs to a plugin in `disabled` removed, through `withoutPluginBinds` for `'main'` and then `'page'`, each judged against `config.commands` as it was.
  3. Then `commands` without each entry whose `plugin` is in `disabled`.
  4. Every other field as it was: `scopes`, `pluginSettings`, `problems`, `theme`.
- **Added beyond plan.md:** `export function appliedCommands(commands: Readonly<Record<CommandId, CommandInfo>>, disabled: readonly string[]): Record<CommandId, CommandInfo>`: step 3 alone. `withAppliedList` calls it, and so does `userConfig`.
- **Added beyond plan.md:** `UserConfigDeps.applied: Pick<AppliedPlugins, 'disabled'>` in `src/main/config/user-config.ts`.
- **Changed signature:** `startedPluginsConfig(config: AppConfig, notStarted: readonly string[], has: (id: CommandId) => boolean): AppConfig` in `src/renderer/started-config.ts`. `loadList` becomes `notStarted`: the plugins whose page part the page host has not started. The page passes `[]` in this task, since main strips the binds of every plugin that is off; task 08 passes the page parts its host has not started yet, during a live start.

Decisions:

**The seam.** The brief points at the store's `commandInfos` call. The store is the wrong seam, for three reasons:
- Task 08 compares the user's `settings.json` list with the applied list, and reads the user's list from `store.current().settings.plugins.disabled`. So the store must keep serving the user's list.
- A bind names its command, and `withoutPluginBinds` finds the bind's plugin through `commands`. So the binds must leave before the commands do. One function that does both, in that order, is the safe shape.
- The store's commands reach two readers that the user sees: `served()` in `main.ts` (help, which-key, the page's anchors and router), and `userConfig.schema()` (`withRuntime` in `user-config.ts` reads `deps.store.current().commands`), which is Settings' keymap section.

So the store serves every plugin, as today. `AppliedPlugins` holds the list in one place. Both readers filter through `withAppliedList` and `appliedCommands`. Main's own router (`served: () => store.current().commands`, measured at `main.ts` line 936) stays unfiltered: it routes runs, and shows no list.

**Where the list is made.** `loadConfig` in `main.ts` (measured at line 635) makes it, after the store and before `userConfig`:
```ts
const applied = createAppliedPlugins(
  mainStartList(runMode === 'selfTest', store.current().settings.plugins.disabled),
);
```
It passes `applied` to `createUserConfig({ ...deps, store, settingInfo, applied })`, and returns `{ store, userConfig, applied }`. `createWindow` gains an `applied: AppliedPlugins` parameter after `userConfig`; the call at `whenReady` (measured at line 1177) passes it.

**`main.ts` inside `createWindow`.**
- The `startList` const and its comment `Read once: a changed list reaches main's parts on the next app start.` (measured at lines 917-921) go.
- `startMainParts(…)` receives `applied.disabled()` where it took `startList`.
- `served` (measured at lines 1006-1012) becomes `withAppliedList(applySelfTestConfig(store.current(), selfTestConfig), applied.disabled())`. Its comment stays: `Read at each request, so a page reload after a config edit starts on the current config.`
- The import of `withMainStartList` goes.

**`selftest-config.ts`.** `mainStartList` stays, unchanged, with its self-test rule: under the self-test it returns `[]`, so main starts every plugin; else it returns `disabled`. Its comment changes its last sentence to: `` `applySelfTestConfig` is the page's half of the same rule, and `createAppliedPlugins` holds the result. `` `withMainStartList` and its comment go.

**`user-config.ts`.** `withRuntime` sets `commands: appliedCommands(deps.store.current().commands, deps.applied.disabled())`. `defaultBindLayers` and `defaultAccelerators` stay: Settings draws a keymap row only for a command in `schema.commands`, so a switched-off plugin's binds draw no row.

**The page.**
- `renderer.ts`: the `pageLoadList` const and its comment `Read once at page load: a changed list reaches the page parts on the next load.` (measured at lines 121-124) go. `startedPluginsConfig(served, [], hasHandler)` builds the first config. `startPlugins(…)` takes `served.settings.plugins.disabled` as its `disabled` argument, with the comment `` // Main serves the applied list in `plugins.disabled`, and no command or bind of those plugins. `` `applyPush` becomes `(next) => applyStartedPush(startedPluginsConfig(next, [], hasHandler))`.
- plan.md says the page "reads the applied list from each push". Each push does carry it in `settings.plugins.disabled`. The page needs no per-push step for it, because main already removed those plugins' page binds. Task 08 starts and stops page parts through main's requests, not from the push.
- `started-config.ts`: `startedPluginsConfig` keeps its body, with `loadList` renamed `notStarted`. Its comment becomes: `` `config` as the page runs it: without the page and editor binds of the plugins in `notStarted` and of the runtime commands `has` finds no handler for, every other field as it was. Main has already removed the binds of the plugins that are off. ``

**What the user sees change (the user's settled answer: a switched-off plugin's commands and keys leave the served config).**
- Help, which-key and Settings' keymap section no longer list a command of a plugin in `plugins.disabled`. Today they list it, with no key.
- A run of such a command from the page (a layout's `kit.command`, a stale anchor) throws `No command is registered as "<id>"` at the page's router. Today a main command was routed to main and refused there. The page's `exists` check in the shell kit now reads false for it.
- **A concern, report it:** a hand edit of `plugins.disabled` while the app runs no longer reaches the page at its next reload. Today `withMainStartList` joined the edited list in, so a reload stopped those page parts while their main parts ran on. Now both processes run the applied list, which does not change until task 08 applies edits live.
- A switched-off plugin's settings section stays in Settings, so the user can set it before switching it on. Out of scope here.

**Self-test.** `applySelfTestConfig` sets `plugins.disabled` to `[]`, and `mainStartList` gives `[]`. So the served list under the self-test is `[]`, as today.

GIVEN `plugins.disabled` is `["agent-lines", "usage-tab-line"]` at start WHEN the page loads THEN neither plugin's part starts in either process, help and which-key list none of their commands, and Settings' keymap section shows none of their rows.
GIVEN the self-test WHEN it starts THEN every plugin starts and the served `plugins.disabled` is `[]`.
GIVEN the user edits `settings.json` while the app runs WHEN the push reaches the page THEN the served `plugins.disabled` is still the start list.

Tests:
- `applied-plugins.test.ts` (new, owns the rule `withMainStartList` owned): the `withMainStartList` table moves here from `selftest-config.test.ts` as `withAppliedList_$case`, rebuilt for the new rule. Its config holds plugins `p` and `q`, each with one app bind (`Ctrl+P` → `p.go`, `Ctrl+Q` → `q.go`), one page bind (`g` → `p.page`, `h` → `q.page`) and those four commands, and `settings.plugins.disabled` of `['p']` (the user's list, which must not leak through). Each row asserts `{ disabled, app, page, commands: Object.keys(commands) }`:

  | Case | `disabled` | `disabled` served | `app` | `page` | command ids |
  |---|---|---|---|---|---|
  | `NoneOff_ServesEmptyAndKeepsEverything` | `[]` | `[]` | `[pApp, qApp]` | `[pPage, qPage]` | `['p.go', 'q.go', 'p.page', 'q.page']` |
  | `OneOff_DropsItsBindsAndCommands` | `['q']` | `['q']` | `[pApp]` | `[pPage]` | `['p.go', 'p.page']` |
  | `BothOff_KeepsTheListOrderAndDropsAll` | `['q', 'p']` | `['q', 'p']` | `[]` | `[]` | `[]` |

  The `OneOff` row catches commands dropped before the binds (the page bind `qPage` would stay), and the `NoneOff` row catches the user's list joined in (it would serve `['p']`).
- `applied-plugins.test.ts`: `createAppliedPlugins_Set_KeepsItsOwnCopy`: `set(list)`, then `list.push('x')`; `disabled()` equals the list before the push. It catches an aliased array.
- `selftest-config.test.ts`: the `withMainStartList` describe goes (moved above). The `mainStartList` table stays as it is: `SelfTest_StartsEvery` → `[]`, `NotSelfTest_KeepsTheList` → `['a']`.
- `started-config.test.ts`: the `startedPluginsConfig_$case` table (`UnstartedPlugin_DropsItsBinds`, `NoneUnstarted_KeepsTheKeymap`) stays, its list argument passed as `notStarted`. `startedPluginsConfig_RuntimeBindWithNoHandler_Dropped` stays, called with `[]`.
- `user-config.test.ts`: new `schema_AppliedPluginCommands_AreNotListed`, beside `schema_RuntimeCommands_AreListed` (measured at line 809). The `create` helper (line 127) gains an `applied` argument, default `{ disabled: () => [] }`. With manifests `p` and `q` each declaring a command and `applied.disabled()` returning `['p']`, `schema().commands` has no key starting `p.` and holds `q`'s command. It catches Settings left reading the store's unfiltered commands.
- `config-store.test.ts`: no change, since the store does not change.

Done when: `grep -rn 'withMainStartList\|pageLoadList\|startList' src` prints nothing; `grep -n 'createAppliedPlugins' src/main/main.ts` prints one line; compiles; the test gate runs the tests above. The filtered self-test runs `npm run selftest -- --plugin settings`. The live check (a plugin in `plugins.disabled` at start has no row in help, which-key or Settings' keymap section) is in [13](13-final-verification.md).
Commit: one commit for the group.

## Proof
