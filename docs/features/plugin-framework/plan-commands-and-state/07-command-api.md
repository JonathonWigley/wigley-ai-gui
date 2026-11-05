# 07 — Runtime command API, with one argument per command and routing across processes

Status: not started
Type: Task
Wave: 6 · Depends on: 06
Plan: [plan.md](plan.md)

All paths are under `src/` unless a line says otherwise.

## Files

**Contracts**

- modify `contracts/commands.ts`, `contracts/plugin.ts`, `contracts/keymap.ts`, `contracts/bridge.ts`, `contracts/core-state.ts`

**Shared core**

- create `shared/command-args.ts` · test `shared/command-args.test.ts`
- create `shared/command-router.ts` · test `shared/command-router.test.ts`
- modify `shared/command-registry.ts` · test `shared/command-registry.test.ts`
- modify `shared/define-plugin.ts` · test `shared/define-plugin.test-d.ts`
- modify `shared/plugin-manifests.ts` · test `shared/plugin-manifests.test.ts`
- modify `shared/plugin-part-harness.test-support.ts`

**Main**

- modify `main/main.ts`, `main/keybindings.ts` · test `main/keybindings.test.ts` when task 04 created it, else create it
- create `main/page-commands.ts` · test `main/page-commands.test.ts`
- modify `main/config/user-keymap.ts` · test `main/config/user-keymap.test.ts`
- modify `main/config/config-checks.ts`, `main/config/user-config.ts`
- modify `main/config/config-store.ts` · test `main/config/config-store.test.ts`
- modify `main/plugins/main-api.ts` · test `main/plugins/main-api.test.ts`
- modify the window plugin's main part from task 03 (`plugins/window/main/start.ts`)

**Page and preload**

- modify `preload/preload.ts` · test `preload/preload.test.ts`
- modify `renderer/renderer.ts`, `renderer/editor-binds.ts`
- modify `renderer/page-keys.ts` · test `renderer/page-keys.test.ts`
- modify `renderer/started-config.ts` · test `renderer/started-config.test.ts`
- modify `renderer/plugins/page-api.ts` · test `renderer/plugins/page-api.test.ts`

**Forms and keys**

- modify `plugins/forms/manifest.ts`, `plugins/forms/contract.ts`, `plugins/forms/ids.ts`, `plugins/keymap.ts`
- modify `plugins/forms/page/forms-commands.ts` · test `plugins/forms/page/forms-commands.test.ts`
- modify `plugins/forms/page/kinds/card-parts.ts`, and each file that builds a `PartAnchor` · test `plugins/forms/page/layout/card-kit.test.ts`
- modify `plugins/keys/contract.ts`
- modify `plugins/keys/page/keys-for.ts` · test `plugins/keys/page/keys-for.test.ts`
- modify `plugins/keys/page/anchors.ts` · test `plugins/keys/page/anchors.test.ts`
- modify `plugins/keys/page/unplaced.ts` · test `plugins/keys/page/unplaced.test.ts`
- modify `plugins/settings/page/keymap-rows.ts`, `plugins/settings/page/keymap-view.ts` · test `plugins/settings/page/keymap-rows.test.ts`
- modify `shared/page/layout-host/kit.d.ts` (the comment that names `choose1`)

**Docs**

- modify `docs/keymap.md` (repo root): the bind format gains `arg`. This file is not in the docs written ahead.

## Consumes

- `SlotKey`, `SlotWriter`, `SlotStore`, `createSlotHolder` with `holder.store` and `holder.applyPageWrite`, and `createPageState` ← 05
- `src/contracts/core-state.ts`, and the core's route to write a `core.*` slot: `store.publish(key)` directly on its process's `SlotStore` ← 06
- `plugins/window/main/start.ts` with the `summon` handler ← 03
- `commandInfos`, `mergeKeymap`, `defaultKeyLayers`, `withoutPluginBinds`, `expandBind`, `store.onChanged`, `livePage`: already in the tree

## Produces

`contracts/commands.ts`, with the plan's `CommandArgShape`, `ArgOf` and `CommandKey`, and:

```ts
export type CommandArg = number | string | { readonly [field: string]: number | string };
export interface CommandRunContext { readonly id: CommandId; readonly arg: unknown; }
```

`contracts/plugin.ts`:

```ts
// CommandDecl gains: arg?: CommandArgShape
// CommandInfo gains: runtime?: true
export interface PageCommandContext<A = undefined> { editor?: TextEditor; arg: A; }
export interface MainCommandContext<A = undefined> { chord?: string; arg: A; }
export type CommandHandler<Context = PageCommandContext<any> | MainCommandContext<any>> =
  (context: Context) => void | Promise<void>;
```

- `PageStart.commands` and `MainStart.commands` map each command to `CommandHandler<…Context<ArgOf<decl.arg>>>`.
- `PluginKeys`' `app`, `global` and `intercept` entries gain `arg?: CommandArg`. `binds` takes it from `KeyBind`.
- `PageApi.commands` and `MainApi.commands` are the plan's `commands` block. `MainApi` gains `commands` and `keys`.
- `PageApi.keys` gains `bind(bind: RuntimeBind<'page'>): Disposable`. `MainApi.keys` is `{ bind(bind: RuntimeBind<'main'>): Disposable }`.

`contracts/keymap.ts`:

```ts
// KeyBind, PageBind, EditorBind, AcceleratorBind and InterceptBind each gain: arg?: CommandArg
export type RuntimeBind<P extends ProcessName = ProcessName> = P extends 'page'
  ? KeyBind
  : { kind: 'app'; bind: AcceleratorBind } | { kind: 'intercept'; bind: InterceptBind };
```

`contracts/core-state.ts`:

```ts
export interface RuntimeCatalog {
  readonly commands: readonly CommandInfo[];
  readonly binds: { readonly binds: readonly KeyBind[]; readonly app: readonly AcceleratorBind[]; readonly intercept: readonly InterceptBind[] };
  readonly started: boolean;
}
export const coreRuntimeMainSlot: SlotKey<RuntimeCatalog, 'main', 'core'> = { id: 'core.runtimeMain', process: 'main', kind: 'value' };
export const coreRuntimePageSlot: SlotKey<RuntimeCatalog, 'page', 'core'> = { id: 'core.runtimePage', process: 'page', kind: 'value' };
```

`contracts/bridge.ts`:

```ts
// BRIDGE_CHANNELS gains commandRun: 'bridge:command-run', commandRunInPage: 'bridge:command-run-in-page', commandRunDone: 'bridge:command-run-done'
runCommand(id: CommandId, arg: unknown): Promise<void>;
onRunCommand(listener: (id: CommandId, arg: unknown) => Promise<void>): void;
```

`shared/command-args.ts`, the plan's `checkCommandArg`, and:

```ts
export function checkCommandArg(id: CommandId, shape: CommandArgShape | undefined, arg: unknown): string | null;
// `id` with no arg, else `id` + one space + the arg as JSON: `forms.choose 3`.
export function commandTarget(id: CommandId, arg: unknown): string;
```

`shared/command-registry.ts`:

```ts
export class CommandRegistry<Context extends { arg: unknown }> {
  constructor(log: Log);
  register(id: CommandId, handler: CommandHandler<Context>, owner: string): Disposable;
  has(id: CommandId): boolean;
  run(id: CommandId, context: Context): Promise<void>;
  intercept(id: CommandId, wrap: (next: () => Promise<void>, context: CommandRunContext) => void | Promise<void>, owner: string): Disposable;
  onDidRun(listener: (id: CommandId, arg: unknown) => void, owner: string): Disposable;
  requireRegistered(ids: Iterable<CommandId>): void;
}
```

`shared/command-router.ts`:

```ts
export interface CommandRouterDeps<Context extends { arg: unknown }> {
  process: ProcessName;
  registry: CommandRegistry<Context>;
  infoOf(id: CommandId): CommandInfo | undefined;
  remote(id: CommandId, arg: unknown): Promise<void>;
  log: Log;
}
export interface CommandRouter<Context extends { arg: unknown }> {
  run(command: CommandId | CommandKey<unknown>, arg: unknown, extras?: Omit<Context, 'arg'>): Promise<void>;
}
export function createCommandRouter<Context extends { arg: unknown }>(deps: CommandRouterDeps<Context>): CommandRouter<Context>;
```

`main/page-commands.ts`:

```ts
export interface PageCommands {
  run(id: CommandId, arg: unknown): Promise<void>;
  // Resolves every waiting run; called when the page slot's `started` goes from true to false.
  pageGone(): void;
}
export function createPageCommands(deps: { page(): WebContents | null; isStarted(): boolean; ipc: Pick<IpcMain, 'on'>; log: Log }): PageCommands;
```

`main/config/config-store.ts`: `ConfigStore` gains `setRuntime(runtime: { main: RuntimeCatalog; page: RuntimeCatalog }): void`.

`main/config/user-keymap.ts`:

```ts
export function heldBackUserBinds(user: UserKeymap, names: KeymapNames, fixedCommands: KeymapNames['commands']): { kept: UserKeymap; problems: string[] };
```

`shared/plugin-manifests.ts`:

```ts
export function mergeKeymap(defaults, manifests, user, runtime?: DefaultKeyLayer): Keymap;
export function defaultKeyLayers(defaults, manifests, runtime?: DefaultKeyLayer): DefaultKeyLayer[];
export function commandInfos(core, manifests, runtime?: readonly CommandInfo[]): Record<CommandId, CommandInfo>;
export function withoutUnhandledRuntimeBinds(keymap: Keymap, commands: Record<CommandId, CommandInfo>, has: (id: CommandId) => boolean, side: 'main' | 'page'): Keymap;
```

`plugins/keys/contract.ts`: `AnchorOptions` gains `arg?: CommandArg`. `keysFor` gains a fourth parameter `arg?: CommandArg`.

`plugins/forms/contract.ts`: `export const formsChooseCommand: CommandKey<number, 'forms.choose'> = { id: 'forms.choose' };`

## Decisions

### The registry and the run path

1. `run` starts the handler in the same stack as the call when no intercept defers it. The key engine needs this: `feedKeys` in `renderer/page-keys.ts` reads focus right after `target.run`, to type replayed keys into a box. Do not write `run` as a function that awaits before the handler.
2. `CommandRouter.run` throws at the call for an unknown id and for a bad arg. It is not an `async` function, so the throw reaches the caller and is not a rejected promise. An unknown id throws `No command is registered as "<id>"`, the text the registry uses today. A bad arg throws the `checkCommandArg` text.
3. `infoOf` on the page reads the page's runtime catalog through its slot writer, then `live.current().commands`. `infoOf` in main reads the main writer, then `store.current().commands`. A command this process declares in `runsIn` runs here. The other process's command goes to `remote`.
4. A declared command of this process with no handler (its plugin is disabled) throws the same `No command is registered` text from the registry.
5. A handler's throw or rejection is logged under `owner` as `command <id> failed: <error text>`, and the promise resolves.
6. Intercepts nest, the last registered outermost. `next` runs the next wrap, then the handler. A second `next` call in one run does nothing. A wrap that does not call `next` stops the run: the handler does not run and `onDidRun` does not fire.
7. A wrap's throw or rejection is logged under the wrap's owner as `intercept of <id> failed: <error text>`, and the promise resolves.
8. `onDidRun` listeners hear a run that ended with no failure, in the process that ran the handler, once the handler has settled. A listener's throw is logged under the listener's owner, and the other listeners run. This matches `pluginEvents`.
9. `intercept` on an id the catalog knows as the other process's throws `<id> runs in <process>; intercept it there`. An id the catalog does not know yet is accepted: the command can register later.
10. `api.commands.run` loses its context parameter. No plugin passes a context at plan time (measured at plan time, re-verify with a multi-line search). The key paths pass extras: page keys `{}`, editor binds `{ editor: fired }`, main chords `{ chord }`. Every core caller goes through the router: `renderer.ts:147`, `renderer.ts:213`, `renderer/page-keys.ts`, and the three run sites in `main/keybindings.ts`. `installPageKeys` and the two main install functions take `{ run: CommandRouter<Context>['run']; has(id: CommandId): boolean; requireRegistered(ids: Iterable<CommandId>): void }` in place of the registry.
11. `register(short, decl, handler)` qualifies `short` with the plugin id. It throws when `decl.runsIn` is not this process, and when the id is in the catalog already. The handle is filed in the part's registrations. Its dispose removes the handler and the catalog entry.
12. The core's own commands use owner `core`: `panes.*` in `renderer/renderer.ts`.
13. Run `checkCommandArg` for every run, key paths included. A bound arg passed the check at load, so the check costs nothing the user can see.

### checkCommandArg text

Pin these strings. The test asserts them.

| Case | Text |
|---|---|
| shape undefined, arg present | `command "<id>" takes no argument` |
| shape `'number'`, arg not a finite number | `command "<id>" needs a number` |
| shape `'string'`, arg not a string | `command "<id>" needs a string` |
| record shape, arg not a plain object | `command "<id>" needs a record` |
| record shape, field missing or of the wrong kind | `command "<id>" needs "<field>" as a <kind>` |
| record shape, extra field | `command "<id>" takes no field "<field>"` |

### Routing

14. Page to main: `bridge.runCommand` is an `ipcRenderer.invoke` on `commandRun`. Main's handler calls its router and answers when the run settles. The page's `remote` catches a rejection (a stale catalog in main), logs it as `command <id> failed: <error text>` under source `commands`, and resolves.
15. Main to page: `createPageCommands` sends `commandRunInPage` with a request id, the command id and the arg. The preload calls the `onRunCommand` listener, then sends `commandRunDone` with the request id once the listener's promise settles. Main's `run` resolves on that message.
16. The no-page case: when `page()` is null or `isStarted()` is false, `run` logs `<id> not run: no page` under source `commands` and resolves. `isStarted` reads `started` on the page slot. Do not send to a page that is still starting: nothing listens yet, and the promise would wait forever.
17. `pageGone` ends each waiting run (decision 22). Each waiting run logs `<id> ended with the page` under source `commands` and resolves.
18. The page installs `onRunCommand` before `startPlugins`. Its listener calls the page router with the arg.

### Runtime commands and binds

19. Each process keeps one core slot, `coreRuntimeMainSlot` or `coreRuntimePageSlot`. The core publishes it with `store.publish(key)`. `commands.register` and `keys.bind` write the slot of their process through that writer, and read it back through that writer. They keep no second list.
20. `CommandInfo` for a runtime command is `{ ...decl, id, plugin, runtime: true }`.
21. The page core writes `{ commands: [], binds: empty, started: false }` before `startPlugins`, right after `createPageState`, and sets `started: true` after the check at `renderer.ts:318` passes. Main does the same around `startMainParts`, then sets `started: true`.
22. Task 05 releases a page's claims with no message to main, so main has no page-load hook. The page's first write in decision 21 is the signal: old page commands and binds leave the served config with it. When the page slot's `started` goes from true to false, main calls `pageGone`. A run sent in the gap before that write waits and resolves there. `renderer.ts` reads `bridge.config()` before that write, so the first config can hold old runtime binds: decision 35's filter drops them. On `render-process-gone`, main calls `holder.applyPageWrite` with the empty catalog, since no new page will write it.
23. `main.ts` listens on both slots through `holder.store`, and calls `store.setRuntime` on each change. `setRuntime` re-serves through the store's file-change path, and one tick's burst re-serves once. `store.onChanged` then pushes to the page and calls `keybindings.setKeymap`, as a file change does.
24. Layers: default ◄ manifest keys ◄ main runtime binds ◄ page runtime binds ◄ user `keymap.json`. Pass both runtime sets to `mergeKeymap` as one `DefaultKeyLayer`, as its last default layer. A user `unbind` removes a runtime bind, since the runtime layer sits before `withoutUnbound`.
25. `commandInfos` lists runtime entries last. For an id already listed, keep the first entry and log `command <id> declared twice` under source `config`. Do not throw: a cross-process race is no bug in the app.
26. `mergeKeymap` runs when `read.text` is null too. Today that path returns `fixed.defaultKeymap`, which would drop the runtime layer.
27. `user-config.ts` `schema()` returns `commands` and `defaultBindLayers` with the runtime entries added, so the Settings keymap lists them. `userConfig.onChanged` fires when `setRuntime` changes them.
28. `keys.bind` throws at the call in these cases:
    - The command is not in the catalog. The caller registers first.
    - The command's process is not this process.
    - The arg fails `checkCommandArg`.
    - `expandBind` throws, on the page.
    - The bind's keys collide with the keymap in force, by `requireUnambiguousKeymap` over `config.current().keymap` plus this bind.
29. A runtime bind's scope and command are qualified, as in `keymap.json`. The API does not qualify them. Main's `global` section takes no runtime bind, as the plan's API comment says.

### Unknown commands and the checks that read them

30. `parseUserKeymap` reads `names` built from manifests and core only.
    - A known id: the `runsIn` check and the arg check throw at load and refuse the whole file, as today.
    - An unknown id: `requireCommand` does not throw. The bind stays in the parsed `UserKeymap`.
31. `heldBackUserBinds` runs after the parse, with names that include the runtime catalogs. For each bind whose id is not in `fixedCommands`:
    - An id unknown in the catalog, a wrong process or a bad arg removes the bind from `kept`.
    - It adds a problem string with the same text and path as the parse: `"binds[3].command" names no command "x".`
    - The index is the index in the file.
32. `checkKeymapText` takes the runtime catalogs and returns `{ keymap: Keymap; heldBack: string[] }`. Every caller changes.
33. The store adds each `heldBack` string to `problems` under `KEYMAP_FILE` only when both catalogs hold `started: true`. Before that the bind is held back in silence. A later `setRuntime` that makes the command known puts the bind in force and removes the problem.
34. The served keymap never holds a bind whose command is not in the served catalog. Update the comment on `withoutPluginBinds`, which says such a bind stays.
35. `requireRegistered` stays at all three places: `installWindowKeybindings` and `setKeymap` in `main/keybindings.ts`, `renderer.ts:318`, and `applyKeys` in `renderer/config-push.ts`. Each now runs over a keymap filtered by `withoutUnhandledRuntimeBinds`:
    - `startedPluginsConfig` takes a third parameter `has`. Move `new CommandRegistry` above `renderer.ts:107`, which calls it. On later pushes it runs at `renderer.ts:360`, so `applyKeys` needs no change. `main.ts` calls the filter before `setKeymap` and `registerGlobalShortcuts`.
    - The filter drops a bind whose command has `runtime: true`, runs on `side`, and has no handler here. A disposed runtime command is in this state until the next push.
    - A manifest or core command with no handler still throws. It is a bug in the app.
36. The key paths guard the same gap. When `runBind`, the editor callback or a main chord finds no handler for a runtime bind, it logs `<keys> names no command <id>` and runs nothing. It does not throw.
37. A user's bad bind no longer refuses the whole file when its id is unknown at load. The other binds apply. This follows the plan's decision, and task 15 re-reads the docs against it.

### Bind `arg`

38. `arg` is an optional field of the `binds`, `app`, `intercept` and `global` entries in `keymap.json`. An `unbind` entry takes no `arg`.
39. `expandBind` copies `arg` to both halves. `main/keybindings.ts` passes `bind.arg` in each of its three run sites.
40. **Two binds on one key.** `arg` is no part of a bind's identity. `bindIdentities` does not change. Two binds on one key in one scope that differ only by `arg` are a key bound twice, and `requireUnambiguousBinds` or the editor check refuses them with today's text. A later layer's bind on the same keys and scope replaces the earlier one, whatever the arg. One command on many keys, each with its own arg, is the normal case.
41. `layerBindsFirst` does not change. Moving a user's bind ahead of a command's other binds is harmless, since an arg lookup filters by arg afterwards.
42. `configSchema` throws when a default or manifest bind's arg fails `checkCommandArg`. This is a bug in the app, and such binds never reach a user.
43. `keysFor` and `promptKeysFor` take `arg` as their last parameter, and `AnchorDeps.keysFor` passes it from `options.arg`. With `arg` given, a bind fires only when `isSameJson(bind.arg, arg)`. With no `arg`, the first bind of the command matches, whatever its arg.
44. `runBind` logs `<keys> ran <commandTarget>`. A no-arg command's log line is unchanged, so the self-test's `expect` lines stay.

### forms.choose

45. `plugins/forms/manifest.ts`: remove `Digit`, `ChoiceCommand` and `choiceCommands`. Declare `choose: { label: CHOICE_LABEL, group: 'choices', runsIn: 'page', arg: 'number' }` where the spread sits today, so the Settings order stays. `DIGITS` and `NUMBER_KEY_COUNT` stay, and `NUMBER_KEY_COUNT` is still `DIGITS.length`. `MAX_ENTRIES` in `plugins/forms/contract.ts` does not change.
46. `plugins/keymap.ts`: lines 51-56 and 62-65 become `command: 'forms.choose' as const, arg: Number(digit)`. The keys and scopes do not change.
47. `forms-commands.ts`: one `choose` handler reads `context.arg`, with the same `changeAnswer` call and log lines. An out-of-range number keeps today's result: `form-state` returns the same state. Remove `choose1` through `choose9`.
48. `plugins/forms/ids.ts`: delete `numberedCommand`.
49. `appendPickKeys`: past `NUMBER_KEY_COUNT` it draws nothing, as today. Otherwise it calls `anchor(keys, formsCommand('choose'), { arg: number })`.
50. `PartAnchor` gains a third parameter `options?: { arg?: CommandArg }`, and every function that builds one forwards it.
51. Placement: `Anchors.placedIn` returns `commandTarget(command, options.arg)` values. `unplacedBinds` carries `arg` and tests `placed.has(commandTarget(bind.command, bind.arg))`. An anchor with no arg places only the no-arg target. `unplacedLine` prints `unplaced <keys> <commandTarget> in <scope>`.
52. Settings: for a command whose decl has `arg`, `keymapRows` gives one `CommandRow` per distinct bound arg, default and user lines together, in first-seen order. It gives no row when no key binds it. `CommandRow` gains `arg?: CommandArg`. The nine rows with today's label stay.
53. `keymap-view.ts`: `commandRow`'s key is `commandTarget(row.command.id, row.arg)`. `addBind` writes `row.arg` into the new bind and uses the same key for its box. The kept line of its layer write keeps `arg`.
54. Help and which-key read labels. `mergeHints` merges by label, so the digits print as today. Neither needs a change.
55. Drive and self-test: no file there names a choose id (measured at plan time, re-verify: `grep -rnE 'choose[1-9]|forms\.choose' src/main/drive src/main/selftest-runner.ts src/plugins/*/main/selftest-script.ts`). Their digit presses go through the keymap. `main/drive/drive-run.ts:68` `run: commands.run` is the drive's own commands object, and it stays.
56. Fixture ids `choose1` in `plugins/keys/page/which-key.test.ts` and `forms.choose1` in `shared/key-hints.test.ts` are test data for label merging. Leave them. Change `kit.d.ts:85` to name `nextItem`.

### Main handlers

57. The handler context changes at every main handler. Two take one at plan time (measured at plan time, re-verify): `settings.show`, which reads nothing, and the window plugin's `summon`, which reads the chord.
58. `summon` logs `${context.chord ?? 'a command'} summoned the window`. The line with a chord is unchanged. A run from the page has no chord.
59. `main.ts:730` types its entries as `CommandHandler<MainCommandContext<any>>`.

### Harness

60. Both fake APIs get `commands` built on a real `CommandRegistry` and `createCommandRouter`. `remote` records the call in the world and resolves. `infoOf` reads the manifest under test, then the world.
61. `keys.bind` and `commands.register` on the fakes record in the world, and their handles count as tracked.
62. `commands.run` no longer does nothing, so a test that relied on the empty `run() {}` now sees the command run or throw. Fix each such test to fake the command it names, or assert the run.

### Docs

63. `docs/keymap.md`: add `arg` beside `where` in the bind format. Say a command that declares an argument needs it on each bind, and that an argument is a number, a string or a small record. Add one `forms.choose` example.

## Behaviour

GIVEN a bind `1` in `forms.forms` with `arg: 1` WHEN the user presses `1` THEN `forms.choose` runs with `context.arg` 1, and the log reads `1 ran forms.choose 1`.

GIVEN no intercept WHEN a key runs a command that focuses a box and keys remain to replay THEN the keys are typed into the box, as today.

GIVEN `run('forms.choose')` with no arg WHEN it is called THEN it throws `command "forms.choose" needs a number` at the call.

GIVEN a page plugin WHEN it runs a main command THEN the main handler runs and the promise resolves after that handler settles.

GIVEN a main plugin and no started page WHEN it runs a page command THEN the log reads `<id> not run: no page`, and the promise resolves.

GIVEN a handler that throws WHEN it runs THEN the owner's log reads `command <id> failed: <text>`, and the promise resolves.

GIVEN two intercepts on one id WHEN the command runs THEN the last registered runs first, and each `next` reaches the inner one.

GIVEN a page part registers a command and binds it WHEN main re-serves THEN help lists the bind, its key runs it, and the user's `keymap.json` bind on that key wins.

GIVEN `keymap.json` binds an id no plugin declares WHEN both processes have started THEN the problems list holds `"binds[0].command" names no command "x".` and the file's other binds apply.

GIVEN that bind's command is registered later WHEN main re-serves THEN the bind is in force and the problem is gone.

GIVEN the page reloads with a runtime bind from the old page WHEN the new page starts THEN `renderer.ts:318` does not fail, and the old bind is gone.

GIVEN two binds on `1` in one scope with different args WHEN the file loads THEN it is refused as a key bound twice.

GIVEN a round of ten entries WHEN main checks it THEN it is refused as today, since `NUMBER_KEY_COUNT` is still 9.

GIVEN a card with two choices WHEN it draws THEN the anchors show `1` and `2`, and the placement check logs `3` through `9` as today, with the new target text.

## Tests

- `checkCommandArg_ShapeAndArgTable_GivesThePinnedText` in `shared/command-args.test.ts`, one table of the rows above plus the passing cases. Catches a text drift, and a record with an extra field passing.
- `commandTarget_NoArgAndArg_GivesIdThenJson` in the same file. Catches a placement key that changes for no-arg commands, which would break self-test `expect` lines.
- Rows added to `shared/command-registry.test.ts`:
  - `run_NoIntercept_StartsTheHandlerBeforeReturning`. Catches an `await` before the handler, which breaks key replay.
  - `run_HandlerThrowsOrRejects_LogsUnderOwnerAndResolves`.
  - `intercept_TwoWraps_LastRegisteredIsOutermost`.
  - `intercept_WrapSkipsNext_NoHandlerAndNoDidRun`.
  - `intercept_NextTwice_RunsTheHandlerOnce`.
  - `onDidRun_ListenerThrows_OtherListenersRun`.
- `shared/command-router.test.ts`:
  - `run_UnknownOrBadArg_ThrowsAtTheCallNotARejection`.
  - `run_OtherProcessCommand_GoesToRemoteAndNoLocalIntercept`.
  - `run_CommandKey_RunsByItsId`.
  - `intercept_OtherProcessCommand_Throws`.
- `main/page-commands.test.ts`:
  - `run_NoPageOrNotStarted_LogsAndResolves`.
  - `run_PageAnswers_ResolvesOnDone`.
  - `pageGone_WaitingRun_LogsAndResolves`. Catches a promise that waits forever over a reload.
- `shared/define-plugin.test-d.ts`:
  - rows for `context.arg` typed number with `arg: 'number'`, a record's fields, and undefined with none.
  - `run(formsChooseCommand, 'x')` fails to compile.
- Rows added to `main/config/user-keymap.test.ts`:
  - `parseUserKeymap_KnownCommandBadArg_Throws`.
  - `parseUserKeymap_ArgOnUnbind_Throws`.
  - `parseUserKeymap_UnknownCommand_KeepsTheBind`, replacing any row that expected a throw.
  - `heldBackUserBinds_UnknownWrongProcessBadArg_DropsWithPathInText`.
- Rows added to `main/config/config-store.test.ts`:
  - `setRuntime_BeforeBothStarted_HoldsBackInSilence`.
  - `setRuntime_BothStarted_ReportsTheHeldBackBind`.
  - `setRuntime_CommandArrives_BindAppliesAndProblemGoes`.
  - `setRuntime_NoKeymapFile_ServesTheRuntimeLayer`. Catches the `read.text === null` shortcut.
- Rows added to `shared/plugin-manifests.test.ts`:
  - `mergeKeymap_RuntimeLayer_UserBindOnSameKeyWins`.
  - `mergeKeymap_UserUnbind_RemovesARuntimeBind`.
  - `mergeKeymap_TwoArgsOnOneKeyInOneLayer_RefusedAsBoundTwice`.
  - `expandBind_Arg_ReachesBothHalves`.
  - `configSchema_DefaultBindBadArg_Throws`.
  - `withoutUnhandledRuntimeBinds_ManifestCommandStays_RuntimeWithoutHandlerGoes`.
- Row added to `renderer/started-config.test.ts`: a runtime bind with no handler is dropped.
- Rows added to `renderer/page-keys.test.ts`: `runBind_Arg_PassesItToTheRun`, and `runBind_RuntimeCommandGone_LogsAndRunsNothing`.
- Rows added to `main/keybindings.test.ts`: each run site passes `arg` and `chord`.
- Rows added to `renderer/plugins/page-api.test.ts` and `main/plugins/main-api.test.ts`:
  - `register_DisposedWithThePart_LeavesRegistryAndSlot`.
  - `register_OtherProcessDecl_Throws`.
  - `bind_CollidingKeys_ThrowsAtTheCall`.
- `plugins/forms/page/forms-commands.test.ts`: rewrite its `run('choose<n>')` rows to `run('choose', { arg: n })`. The cases stay.
- `plugins/forms/page/layout/card-kit.test.ts:432`: `choiceList_AnchorsEachChoice` asserts `forms.choose` with args 1 and 2.
- Row added to `plugins/keys/page/keys-for.test.ts`: `keysFor_Arg_PicksThatArgsBind`. Catches a choice hint that shows `1` on every row.
- Row added to `plugins/keys/page/unplaced.test.ts`: `unplacedBinds_ArgPlaced_OtherArgsStillListed`. Catches placement weakened by arg.
- Row added to `plugins/settings/page/keymap-rows.test.ts`: `keymapRows_ArgCommand_OneRowPerBoundArgAndNoneWhenUnbound`.
- Row added to `preload/preload.test.ts`: `onRunCommand_ListenerSettles_SendsDone`.

Runtime checks go to [16 — Final verification](16-final-verification.md).

## Done when

- The type check and `scripts/check-layers.mts` pass.
- `grep -rnE 'choose[1-9]' src --include='*.ts' --include='*.js'` prints only the two fixture test files.
- `grep -n "chord: string" src/contracts/plugin.ts` prints nothing.
- The test gate runs the tests above.

## Commit

One commit for the group.

## Proof

