# 01 — Kit buttons run commands, and listing rules

Status: done
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

**Contents**

- **Files** — what this task creates, modifies and tests.
- **Consumes** — the signatures from `plan-commands-and-state`, copied.
- **Produces** — the signatures this task lands, and the commands it adds.
- **Decisions** — kit checks, the listing rule, the arg label, shared modules.
- **Behaviour** — GIVEN/WHEN/THEN.
- **Tests** — each with the break it catches.
- **Done when**, **Commit**, **Proof**.

## Files

Kit:

- modify `src/shared/page/layout-host/base-kit.ts`
- modify `src/shared/page/layout-host/kit.d.ts`
- test `src/shared/page/layout-host/base-kit.test.ts`
- test `src/shared/layouts/layout-contracts.test.ts` (it runs unchanged and type-checks the new text)

Every `KitCommands` literal. Each moves to `kitCommandsOf(api)`: 17 plugin files, measured at plan time, re-verify with `grep -rln "exists: (" src/plugins --include='*.ts'`:

- modify `src/plugins/{agent-lines,agent-skills,agent-strip,backlog,chat,docs,forms,gallery,keys,notes,primer,sessions,settings,unity-pool,usage,visual,workflow}/page/start.ts`
- modify `src/renderer/renderer.ts` (the shell's `commands` literal; it reads the page registry and writes its own literal)
- test fakes: `src/plugins/docs/page/docs-page-fakes.ts`, `src/plugins/sessions/page/sessions-view-fakes.ts`, `src/plugins/notes/page/notes-page-fakes.ts`, and every test file with a `KitCommands` literal (find them with `grep -rl "exists:" src --include='*.test.ts'`)

Unity-pool, the one layout that calls `kit.button`:

- modify `src/plugins/unity-pool/manifest.ts`, `src/plugins/unity-pool/contract.ts`, `src/plugins/unity-pool/page/pool-view-model.ts`, `src/plugins/unity-pool/page/start.ts`, `src/plugins/unity-pool/layouts/layout.d.ts`, `src/plugins/unity-pool/layouts/default/layout.js`
- test `src/plugins/unity-pool/page/start.test.ts`

Listing rule:

- modify `src/shared/command-args.ts`; test `src/shared/command-args.test.ts`
- test only: `src/plugins/keys/page/help-sections.test.ts`, `src/plugins/keys/page/which-key.test.ts`. `src/shared/key-hints.ts`, `help-sections.ts` and `which-key.ts` do not change (Decisions).
- modify `src/plugins/settings/page/keymap-rows.ts`, `src/plugins/settings/page/keymap-view.ts`, `src/plugins/settings/page/row-filter.ts`; test `src/plugins/settings/page/keymap-rows.test.ts`, `src/plugins/settings/page/row-filter.test.ts`

Shared picker:

- modify `src/contracts/list-picker.ts` (`ListPicker`)
- modify `src/shared/page/list-picker.ts`; test `src/shared/page/list-picker.test.ts`. The test's two `createListPicker` literals gain `owner` and `run`.
- modify `src/shared/page/fake-list-picker-service.test-support.ts`
- modify `src/contracts/commands.ts`, `src/config/keymap.ts`
- create `src/renderer/picker-commands.ts`; test `src/renderer/picker-commands.test.ts`
- modify `src/renderer/renderer.ts`
- modify `src/renderer/plugins/page-api.ts`, which implements `ListPickerService`; test `src/renderer/plugins/page-api.test.ts`

`src/shared/page/confirm-prompt.ts` does not change (Decisions).

## Consumes

Every item comes from `plan-commands-and-state`, which is closed by the time this task runs.

- `src/contracts/commands.ts`:
  - `export type CommandArgShape = 'number' | 'string' | { readonly [field: string]: 'number' | 'string' };`
  - `export interface CommandKey<A, Id extends string = string> { readonly id: Id; readonly argType?: A; }`
  - `CommandArg`, the value type `KeyBind.arg` carries: a number, a string, or a record of these.
- `CommandDecl` gains `arg?: CommandArgShape`. `CommandInfo extends CommandDecl`, and `commandInfos` spreads the declaration (`src/shared/plugin-manifests.ts`), so `schema.commands[id].arg` and `api.keys.command(id)?.arg` hold the shape.
- `PageCommandContext<A = undefined>` is `{ editor?: TextEditor; arg: A }`. A handler is `(context) => void | Promise<void>`.
- `src/shared/command-args.ts`: `checkCommandArg(id: CommandId, shape: CommandArgShape | undefined, arg: unknown): string | null`, the error text or null.
- `PageApi.commands`: `run(id: CommandId): Promise<void>` and `run<A>(key: CommandKey<A>, arg: A): Promise<void>`. `register(short: string, decl: CommandDecl, handler: CommandHandler): Disposable`.
- `KeyBind` and the `keymap.json` entry gain `arg?: CommandArg`.
- `CommandRouter.run(command: CommandId | CommandKey<unknown>, arg: unknown, extras?: Omit<Context, 'arg'>): Promise<void>`, in `src/shared/command-router.ts`. It throws at the call for an unknown id and for a bad arg. `renderer.ts` and `page-api.ts` hold the page's router.
- `CommandRegistry.register(id: CommandId, handler: CommandHandler<Context>, owner: string): Disposable`. The core's own commands use owner `core`.
- `commandTarget(id: CommandId, arg: unknown): string`, in `src/shared/command-args.ts`: the id with no arg, else the id, one space and the arg as JSON. A record's fields print sorted by name.
- Settings, from that plan's task 07:
  - `CommandRow` has `arg?: CommandArg`.
  - `keymapRows` gives a command with a declared `arg` one row per distinct bound arg, default and user lines together, in first-seen order, and no row when no key binds it. The rows hold the bare label.
  - `commandRow`'s key in `keymap-view.ts` is `commandTarget(row.command.id, row.arg)`. `addBind` writes `row.arg` into the new bind.
  - `keymap-rows.test.ts` has `keymapRows_ArgCommand_OneRowPerBoundArgAndNoneWhenUnbound`.
- `PageServices.picker: ListPickerService`, `create(options?: ListPickerOptions): ListPicker`. `src/renderer/plugins/page-api.ts` builds it per plugin, and builds every `ListPickerDeps` in `create`. `create` files one registration that calls `picker.close()`. Chat's session-bound wrapper stays chat's and sits on the service.
- `ListPicker` in `src/contracts/list-picker.ts`. `ListPickerDeps` and `createListPicker` in `src/shared/page/list-picker.ts`. `fakeListPickerService()` in `src/shared/page/fake-list-picker-service.test-support.ts`, a real `createListPicker` over a fake matcher.
- Tree: `coreCommands` in `src/config/keymap.ts`. `textButton` in `src/shared/page/ui/button.ts`. `LiveConfig` (`live` in `renderer.ts`).

## Produces

Kit, in `src/shared/page/layout-host/base-kit.ts` and `kit.d.ts`:

```ts
// kit.d.ts
export type CommandArg = number | string | { readonly [field: string]: number | string };
export interface KitButtonOptions { arg?: CommandArg; variant?: ButtonVariant; keys?: string | null; }
button(parent: HTMLElement, label: string, command: string, options?: KitButtonOptions): HTMLButtonElement;
command(qualifiedId: string, arg?: CommandArg): () => void;

// base-kit.ts
export interface KitCommands {
  exists(id: CommandId): boolean;
  argShape(id: CommandId): CommandArgShape | undefined;
  run(id: CommandId, arg?: CommandArg): void;
}
export function commandRunner(qualifiedId: CommandId, commands: KitCommands, arg?: CommandArg): () => void;
export function kitCommandsOf(api: {
  keys: Pick<PageApi['keys'], 'command'>;
  commands: Pick<PageApi['commands'], 'run'>;
}): KitCommands;
export function keyRunner(commands: Pick<PageApi['commands'], 'run'>, log: PluginLog): <A>(key: CommandKey<A>, arg: A) => void;
```

`kit.d.ts` text for each member, verbatim:

- `button`: `` `button.ui-button`, variant `secondary` when left out; never takes focus. `keys` draws its hint after the label. A click runs `command`, a qualified id, with `options.arg`. An id no plugin registers, or an `arg` the command does not declare, throws while the part builds, and the part falls back to `default`. ``
- `command`: `` A runner for any plugin's command by its qualified id (as `docs.openDoc`), with `arg` when the command declares one: each call runs the command, and getting it runs nothing. It checks the id and `arg` when called, so call it while the part builds: a bad id or `arg` throws, and the part falls back to `default` like any that throws. ``

Listing, in `src/shared/command-args.ts`:

```ts
export function commandArgLabel(arg: CommandArg): string;
```

Settings, in `src/plugins/settings/page/keymap-rows.ts`: `CommandRow` gains `label: string`. `arg` is already there.

Shared picker:

- `ListPickerDeps`, in `src/shared/page/list-picker.ts`, gains `owner: string` (the owning plugin's id) and `run(command: CommandId, arg: CommandArg): void`.
- `ListPicker`, in `src/contracts/list-picker.ts`, gains `chooseAt(index: number): void`.
- `PageApiDeps`, in `src/renderer/plugins/page-api.ts`, gains `pickerCommands: PickerCommands`.

Core commands, in `src/contracts/commands.ts` and `src/config/keymap.ts`:

```ts
export const PICKER_CHOOSE_ROW: CommandKey<{ owner: string; index: number }, 'picker.chooseRow'> = { id: 'picker.chooseRow' };
export const PICKER_CANCEL: CommandKey<string, 'picker.cancel'> = { id: 'picker.cancel' };
```

| Command | `arg` | Label | Group | Site |
|---|---|---|---|---|
| `picker.chooseRow` | `{ owner: 'string', index: 'number' }` | `choose the row` | `picker` | `list-picker.ts` row click, built-in and `drawRow` |
| `picker.cancel` | `'string'` (the owner) | `cancel the list` | `picker` | `list-picker.ts` backdrop click |

`src/renderer/picker-commands.ts`:

```ts
export interface PickerCommands {
  // A second live picker for one owner throws `picker owner <owner> is taken`.
  track(owner: string, picker: ListPicker): Disposable;
}
export function registerPickerCommands(commands: Pick<CommandRegistry<PageCommandContext>, 'register'>): PickerCommands;
```

`renderer.ts` calls it beside the core's own pane commands, before `startPlugins`, with owner `core` on both handlers. It passes the result to `createPageApi` as `pickerCommands`.

Unity-pool commands, in `src/plugins/unity-pool/manifest.ts`, each `runsIn: 'page'`, with their `CommandKey`s in `contract.ts`:

| Command | `arg` | Label | Group | Site |
|---|---|---|---|---|
| `unity-pool.hold` | `{ pool: 'string', clone: 'number' }` | `hold the clone` | `pool` | `layouts/default/layout.js` action button |
| `unity-pool.release` | `{ pool: 'string', clone: 'number' }` | `release the clone` | `pool` | `layouts/default/layout.js` action button |

`layout.d.ts`'s clone `action` becomes `{ label: string; command: string; arg: { pool: string; clone: number }; running: boolean }`. Its header comment says an action's button runs that command.

No added command takes a key.

## Decisions

**Kit.**

- `button` and `command` both go through `commandRunner`. It throws `no command <id>` for an unknown id, and the `checkCommandArg` text for a bad `arg`, at build. A layout mistake therefore falls back to `default` and never throws on a click.
- `button` takes no function. A function passed to it fails `exists` and throws at build.
- `command` and `button` take a qualified id only, as `command` does today.
- `kitCommandsOf` runs `api.commands.run(id)` when `arg` is undefined, and `api.commands.run({ id }, arg)` otherwise. It reads `exists` and `argShape` from `api.keys.command(id)`. It voids the promise: a handler failure is logged by the command core.
- `keyRunner` is for a click that runs a typed `CommandKey`, as tasks 03 and 05 do. It calls `commands.run(key, arg)` in a `try` and voids the promise, which never rejects. It logs a throw at the call as `command <id> failed: <error text>`.
- The shell's `commands` literal in `renderer.ts` does not use `kitCommandsOf`, because the shell has no `PageApi`. It reads the router's `infoOf` (see **One command source**):
  - `exists` is `infoOf(id) !== undefined`.
  - `argShape` is `infoOf(id)?.arg`.
  - `run` calls `router.run(id, arg, {})` and voids the promise. The router makes the arg check, so a bad `modes.show` arg throws at the call.

**One command source.** Every kit's `exists`, `argShape` and run read one source, the router's `infoOf`, so a build check and a click agree. Two reads of two sources let a command pass the build check and then throw on the click.

- `plan-commands-and-state` stacked two patches on the old reads: the arg check in `commandRunner`, and the shell's `exists` reading served commands (`live.current().commands`). This task replaces both with the `infoOf` read, and `KitCommands` keeps its three members.
- `commandRunner` logs and runs nothing for a command that is served and has no handler. Today `CommandRegistry.run` throws on a click, uncaught and unlogged. The case covers a disabled plugin's command, and the 21 `run: (id) => api.commands.run(id)` sites in the plugin kits, which share the throw. The fix lives in `commandRunner` and `kitCommandsOf`, so no site changes.
- A runtime page command registered at part start counts at the first shell draw, because `infoOf` reads the freshest catalog the process has. A shell layout that names such a command therefore keeps its part, where the served-commands read made it fall back to `default` with no recovery. No part registers one today.
- One wiring proof pins the shell's `exists` in `renderer.ts`: a shell layout names a command that is registered and not yet served, and the part draws. A unit test of `commandRunner` does not reach this literal.
- No kit overrides `button` or `command`, and no `layout.d.ts` redeclares them (measured at plan time, re-verify). Every wrapper takes the change through its `...base` spread.

**Unity-pool moves here, not in task 05.** `layouts/default/layout.js` is the only `kit.button` caller, and it passes a function. Task 01 changes that signature, so task 01 moves the caller, or the panel breaks through Wave 1.

- `pool-view-model.ts`'s `cloneAction` returns `command` and `arg`. The `run` member of `panelInput`'s `actions` goes. The holder `select` stays with task 05.
- The handlers go in the `commands` object that `start.ts` returns (`commands: {}` today, line 407, measured at plan time). That closure holds `runAction`. Each handler calls `runAction(arg.pool, 'hold' | 'release', arg.clone)`.
- A run while that clone's action is pending does nothing and logs nothing. `runAction` already returns early when `running` is true (`start.ts:307`), so a key or a later palette run needs no new guard.

**Listing rule.** A command with a declared `arg` lists only while a bind names it. Settings lists it once per bound arg. Help and which-key keep one merged line.

- Settings is a delta on what `plan-commands-and-state` task 07 landed (Consumes). Do not rebuild its rows, its row key or its `addBind`. This task adds:
  - `CommandRow.label`: `command.label` with no `arg`, and `<command.label>: <commandArgLabel(arg)>` with one.
  - `keyRowInput` and `matchesCommand` in `row-filter.ts` read `row.label` in place of `row.command.label`.
  - `replacedBy` removes repeats of one command from its result, since one command now holds many rows.
- A row's identity is `commandTarget`. No other key or comparison of args exists.
- A default line in any state counts as bound, so a default the user unbound keeps its row and the user can restore it. A command with no `arg` keeps its one row, bound or not.
- The label suffix is the one change the user sees in Settings. Task 07 lands the nine `forms.choose` rows with the same label. The suffix tells them apart, which is the point of one row per number.
- Help and which-key do not change, by the user's answer of 2026-11-05. They list binds, so they already skip an unbound command. `mergeHints` groups by the bare label, so forms' digits still print `1–9 pick the numbered choice`, as `plan-commands-and-state` task 07 promises. `commandArgLabel` reaches Settings only.
- The command palette is Wave 4, out of scope.

**Arg label.** A Settings row labels its arg as `<label>: <arg>`:

| `arg` | `commandArgLabel` | Row |
|---|---|---|
| `3` | `3` | `pick the numbered choice or action (again clears): 3` |
| `'chat'` | `chat` | `<label>: chat` |
| `{ pool: 'p', clone: 2 }` | `clone 2, pool p` | `<label>: clone 2, pool p` |

A record lists `field value`, fields sorted by name, joined with `, `.

**How a shared module with no plugin runs a command.**

- A shared module runs a command through its deps. It owns no command unless every caller would otherwise write the same one.
- `confirm-prompt.ts` needs no change. Each caller names its own `keep` and `confirm` commands and passes `run`, so the prompt already runs a command from the caller's plugin. Its callers are primer, forms and backlog twice.
- `list-picker.ts` would make all six plugins write the same row command. The core therefore owns `picker.chooseRow` and `picker.cancel`, as `coreCommands` entries with `runsIn: 'page'`.
- Each declares an `arg`, so neither lists anywhere while unbound, and six plugins' Settings pages gain nothing.
- The arg names the owner, because every plugin's picker has its own open state and a click must reach the picker that drew the row.
- The plugins' own `pickerChoose`, `pickerCancel`, `pickerPick` and `pickerClose` commands stay for their keys. They act on the cursor, as a key does. A click names a row, as a pointer does.

**Picker wiring.**

- `renderer.ts` passes the `registerPickerCommands` result into `createPageApi` as `pickerCommands`.
- `services.picker.create` in `page-api.ts` fills `owner` with `manifest.id`. It fills `run` with a call to the page's router, which takes a bare `CommandId`, and voids the promise. It adds no `{ id }` wrapper.
- `create` calls `pickerCommands.track(manifest.id, picker)` and files the result in the part's registrations, beside the `picker.close()` registration. A part's stop therefore frees the owner before a restart.
- One plugin holds one picker, and `create` runs once per part start: six `createListPicker` calls in six plugins, each at mount, measured at plan time, re-verify. A second `create` in one part start throws `picker owner <owner> is taken` at the call, so the part fails at start and never on a click.
- `fakeListPickerService()` fills `owner` with `fake`. Its `run` calls `chooseAt(arg.index)` on the picker it built for `picker.chooseRow`, and `cancel()` for `picker.cancel`. A site's test that clicks a row therefore still reaches `chosen`.
- Row click, built-in row and `drawRow` row alike: `deps.run('picker.chooseRow', { owner: deps.owner, index })`.
- Backdrop click: `deps.run('picker.cancel', deps.owner)`.
- `chooseAt(index)` sets `state.cursor` to `index`, then runs `choose`. An `index` not among the visible rows does nothing and logs `picker row <index> is not shown`.
- `picker.chooseRow`'s and `picker.cancel`'s handlers find the tracked picker by owner. An owner with no tracked picker logs and does nothing.

**Self-test lines.** `expect` lines that name an old label move with the label, per `plan.md` § Boundary rules.

## Behaviour

- GIVEN a layout calls `kit.button(parent, 'Hold', 'unity-pool.hold', { arg: { pool: 'p', clone: 2 } })` WHEN the user clicks it THEN `unity-pool.hold` runs with that arg.
- GIVEN a layout calls `kit.button` with an id no plugin registers WHEN the part builds THEN it throws `no command <id>`, and the part falls back to `default`.
- GIVEN `kit.command('forms.choose')` on a command declaring `arg: 'number'` WHEN the part builds THEN it throws the `checkCommandArg` text.
- GIVEN a command with `arg` and no bind WHEN Settings draws THEN it has no row, and help and which-key list nothing for it.
- GIVEN `forms.choose` bound on `1` and `2` WHEN Settings draws THEN it has two rows, labelled `pick the numbered choice or action (again clears): 1` and `…: 2`.
- GIVEN `forms.choose` bound on `1` through `9` WHEN help or which-key draws THEN each shows one line, `1–9` and the bare label.
- GIVEN the user adds a bind on the row for arg `2` WHEN the bind saves THEN the user keymap entry carries `arg: 2`.
- GIVEN clone 2's Hold is pending WHEN `unity-pool.hold` runs again on clone 2 THEN nothing happens.
- GIVEN an open picker WHEN the user clicks the row at item index 3 THEN `picker.chooseRow` runs with the picker's owner and index 3, the cursor moves to 3, and `chosen` gets item 3.
- GIVEN an open picker WHEN the user clicks the backdrop THEN `picker.cancel` runs with the owner, and `cancelled` runs.

Runtime checks collect in [Final verification](11-final-verification.md). This task adds none here.

## Tests

- `base-kit.test.ts`: `button_Click_RunsCommandWithItsArg`. Catches a button that drops `arg`.
- `base-kit.test.ts`: rows added to `commandRunner_UnknownId_ThrowsAtCreationAndRunsOnlyOnCall` for a bad `arg`, a missing declared `arg`, and an `arg` on a command with none. Catches a layout mistake surfacing only on a click.
- `base-kit.test.ts`: `commandRunner_ServedCommandWithNoHandler_LogsAndRunsNothing`. Catches a click on a disabled plugin's command throwing uncaught and unlogged.
- The wiring proof for the shell's `exists`, beside `renderer.ts` or its nearest seam: `shellCommands_RuntimeCommandRegisteredAtPartStart_CountsAtFirstDraw`. Catches the shell `exists` reading served commands, which the part-start command is not in yet.
- `base-kit.test.ts`: `keyRunner_RunThrows_LogsAndDoesNotThrow`. Catches a stale arg throwing out of the DOM listener, where the click dies with no log line.
- `base-kit.test.ts`: `kitCommandsOf_ArgGiven_RunsThroughCommandKey`. Catches a helper that drops `arg` on the way to `commands.run`.
- `layout-contracts.test.ts`: `every owner contract type-checks beside kit.d.ts` runs on the new text. Catches a `layout.d.ts` that clashes with the new `button`.
- `command-args.test.ts`: `commandArgLabel_EachShape_PrintsPinnedText`, a table with the three rows above and a record given in the other field order. Catches a label that depends on field order.
- `help-sections.test.ts`: `helpSections_DigitBindsWithArgs_PrintOneRangeLine`. Catches an arg suffix reaching help and splitting `1–9` into nine rows.
- `which-key.test.ts`: `whichKeyModel_DigitBindsWithArgs_PrintOneRangeLine`. Catches the same split in which-key.
- `keymap-rows.test.ts`: narrow `keymapRows_EveryCommandHasARow` to commands with no `arg`, because plugins now declare unbound click commands. It still catches a no-arg command losing its row.
- `keymap-rows.test.ts`: extend `keymapRows_ArgCommand_OneRowPerBoundArgAndNoneWhenUnbound`, the test task 07 landed, with rows for the label `<label>: 1`, for a record arg with its fields in the other order, and for an unbound default keeping its row. Catches a row with the bare label, a duplicate row from field order, and a default the user cannot restore.
- `keymap-rows.test.ts`: `replacedBy_ArgCommand_NamesItOnce`. Catches a repeated command in the replaced list.
- `row-filter.test.ts`: `matchesCommand_ArgRow_MatchesItsLabel`. Catches a filter that reads the bare label and misses a row's arg.
- `list-picker.test.ts`: rows added to `drawRow_DrawsEachVisibleItemAndKeepsCursorAndClick` that assert `run` gets `picker.chooseRow` with owner and index, on both built-in and `drawRow` rows. `backdropClick_RunsPickerCancelWithOwner`. `chooseAt_HiddenIndex_DoesNothing`. Catches a click that skips the command, or chooses a filtered-out row.
- `picker-commands.test.ts`: `chooseRow_TwoOwners_ReachesTheOwnersPicker`. `track_SecondPickerForOwner_Throws`. Catches a click reaching another plugin's picker.
- `page-api.test.ts`: `picker_RowClick_RunsChooseRowWithThePluginAsOwner`. `picker_PartRestarts_OwnerIsFreeAgain`. Catches a picker built with no owner, and a restart that throws `is taken`.
- `unity-pool/page/start.test.ts`: `hold_RunsActionOnTheArgsPoolAndClone`, with a row for `release` and a row for a second run while `running`. Catches the Hold button losing its target in the move, and a second action sent to main.

The shell's literal has no unit test, because `renderer.ts` has no test file. `shell-chrome.test.ts` keeps a fake `commands`.

## Done when

The tree compiles. The layer check passes. `grep -rn "onClick" src/shared/page/layout-host/kit.d.ts` finds nothing on `button`. `grep -rn "commandArgLabel" src/plugins/keys src/shared/key-hints.ts` finds nothing. The test gate runs the tests above.

## Commit

One commit for the group.

## Proof

Commit 84ca8726 · proof: diff read (Produces present: button/command with arg, KitCommands.run(id,arg?), kitCommandsOf, keyRunner, commandArgLabel, CommandRow.label, picker.chooseRow/cancel, registerPickerCommands); typecheck 0; lint clean; worker: vitest 9974 pass, selftest unity-pool/docs/settings pass · concerns: settings rowsPerArg compares args with isSameJson (key-order blind); page-api picker run voids router.run, a sync throw would escape the click; 14 start.ts swaps covered by typecheck/vitest only; one blocked npx call (nothing downloaded); lint:fix reformatted run files only
