# 01 — Kit buttons run commands, and listing rules

Status: not started
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

- modify `src/shared/command-args.ts`
- create test `src/shared/command-args.test.ts`
- modify `src/shared/key-hints.ts`; test `src/shared/key-hints.test.ts`
- modify `src/plugins/keys/page/help-sections.ts`; test `src/plugins/keys/page/help-sections.test.ts`
- modify `src/plugins/keys/page/which-key.ts`; test `src/plugins/keys/page/which-key.test.ts`
- modify `src/plugins/settings/page/keymap-rows.ts`, `src/plugins/settings/page/keymap-view.ts`, `src/plugins/settings/page/row-filter.ts`; test `src/plugins/settings/page/keymap-rows.test.ts`

Shared picker:

- modify `src/shared/page/list-picker.ts`; test `src/shared/page/list-picker.test.ts`
- modify `src/contracts/commands.ts`, `src/config/keymap.ts`
- create `src/renderer/picker-commands.ts`; test `src/renderer/picker-commands.test.ts`
- modify `src/renderer/renderer.ts`
- modify the file that implements `ListPickerService` (`src/contracts/list-picker.ts` declares it, `plan-commands-and-state` task 09; find the implementation with `grep -rln "createListPicker(" src/renderer src/shared`)

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
- `PageServices.picker: ListPickerService`, "the shared list picker plus scope and layer wiring". This service builds every `ListPickerDeps`. Chat's session-bound wrapper stays chat's and sits on the service.
- Tree: `ListPicker`, `ListPickerDeps` and `createListPicker` in `src/shared/page/list-picker.ts`. `coreCommands` in `src/config/keymap.ts`. `textButton` in `src/shared/page/ui/button.ts`.

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
```

`kit.d.ts` text for each member, verbatim:

- `button`: `` `button.ui-button`, variant `secondary` when left out; never takes focus. `keys` draws its hint after the label. A click runs `command`, a qualified id, with `options.arg`. An id no plugin registers, or an `arg` the command does not declare, throws while the part builds, and the part falls back to `default`. ``
- `command`: `` A runner for any plugin's command by its qualified id (as `docs.openDoc`), with `arg` when the command declares one: each call runs the command, and getting it runs nothing. It checks the id and `arg` when called, so call it while the part builds: a bad id or `arg` throws, and the part falls back to `default` like any that throws. ``

Listing, in `src/shared/command-args.ts`:

```ts
export function commandArgLabel(arg: CommandArg): string;
export function sameCommandArg(a: CommandArg | undefined, b: CommandArg | undefined): boolean;
```

Listing, in `src/shared/key-hints.ts`: `BoundKeys` gains `arg?: CommandArg`, and:

```ts
export function boundCommandLabel(label: CommandLabel, command: CommandId, arg?: CommandArg): string;
```

Settings, in `src/plugins/settings/page/keymap-rows.ts`: `CommandRow` gains `arg: CommandArg | undefined` and `label: string`.

Shared picker, in `src/shared/page/list-picker.ts`:

- `ListPickerDeps` gains `owner: string` (the owning plugin's id) and `run(command: CommandId, arg: CommandArg): void`.
- `ListPicker` gains `chooseAt(index: number): void`.

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

`renderer.ts` calls it beside the core's own pane commands.

Unity-pool commands, in `src/plugins/unity-pool/manifest.ts`, with their `CommandKey`s in `contract.ts`:

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
- No kit overrides `button` or `command`, and no `layout.d.ts` redeclares them (measured at plan time, re-verify). Every wrapper takes the change through its `...base` spread.

**Unity-pool moves here, not in task 05.** `layouts/default/layout.js` is the only `kit.button` caller, and it passes a function. Task 01 changes that signature, so task 01 moves the caller, or the panel breaks through Wave 1. `pool-view-model.ts`'s `cloneAction` returns `command` and `arg`. The `run` member of `panelInput`'s `actions` goes. The handlers call today's `runAction(arg.pool, 'hold' | 'release', arg.clone)`. The holder `select` stays with task 05.

**Listing rule.** A command with a declared `arg` lists only while a bind names it, once per bound arg.

- Settings:
  - `keymapRows` skips a command with `arg` and no bind line.
  - It draws one row per distinct `arg` among its lines, in the order the lines first name each `arg`. A line in any state counts, so a default the user unbound keeps its row and the user can restore it.
  - A command with no `arg` keeps its one row, bound or not.
  - An accelerator bind names no `arg`, so it only ever lists on a row with no `arg`.
- Settings editing:
  - A row's key is `<command id>` with no `arg`, and `<command id>:<commandArgLabel(arg)>` with one.
  - `addBind` carries `row.arg` into the bind it makes.
  - `replacedBy` removes repeats of one command from its result, since one command now holds many rows.
  - `keyRowInput` and `row-filter.ts` read `row.label`.
- Help and which-key:
  - They list binds, so they already skip an unbound command. They change only in the label.
  - `helpSections` and `editorHints` pass `bind.arg` into `mergeHints`.
  - which-key's candidates carry `arg`, and `entry` labels through `boundCommandLabel`.
- The command palette is Wave 4, out of scope.

**Arg label.** A row labels its arg as `<label>: <arg>`:

| `arg` | `commandArgLabel` | Row |
|---|---|---|
| `3` | `3` | `pick the numbered choice or action (again clears): 3` |
| `'chat'` | `chat` | `<label>: chat` |
| `{ pool: 'p', clone: 2 }` | `clone 2, pool p` | `<label>: clone 2, pool p` |

A record lists `field value`, fields sorted by name, joined with `, `. `sameCommandArg` compares the same canonical form, so field order never makes two rows.

`mergeHints` merges by label, as today. Two keys on one command and one `arg` still merge. Different args no longer merge. The effect on forms' digits is in the plan run's report as a question for the user; this document follows `plan.md` § Decisions, once per bound argument.

**How a shared module with no plugin runs a command.**

- A shared module runs a command through its deps. It owns no command unless every caller would otherwise write the same one.
- `confirm-prompt.ts` needs no change. Each caller names its own `keep` and `confirm` commands and passes `run`, so the prompt already runs a command from the caller's plugin. Its callers are primer, forms and backlog twice.
- `list-picker.ts` would make all six plugins write the same row command. The core therefore owns `picker.chooseRow` and `picker.cancel`, as `coreCommands` entries with `runsIn: 'page'`.
- Each declares an `arg`, so neither lists anywhere while unbound, and six plugins' Settings pages gain nothing.
- The arg names the owner, because every plugin's picker has its own open state and a click must reach the picker that drew the row.
- The plugins' own `pickerChoose`, `pickerCancel`, `pickerPick` and `pickerClose` commands stay for their keys. They act on the cursor, as a key does. A click names a row, as a pointer does.

**Picker wiring.**

- `ListPickerService` fills `owner` with the asking plugin's id and `run` with the page's command run. It calls `track` for each picker it builds, and disposes the tracking with the picker's owner. One plugin holds one picker: six `createListPicker` calls in six plugins, measured at plan time, re-verify.
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
- GIVEN the user adds a bind on the row for arg `2` WHEN the bind saves THEN the user keymap entry carries `arg: 2`.
- GIVEN an open picker WHEN the user clicks the row at item index 3 THEN `picker.chooseRow` runs with the picker's owner and index 3, the cursor moves to 3, and `chosen` gets item 3.
- GIVEN an open picker WHEN the user clicks the backdrop THEN `picker.cancel` runs with the owner, and `cancelled` runs.

Runtime checks collect in [Final verification](11-final-verification.md). This task adds none here.

## Tests

- `base-kit.test.ts`: `button_Click_RunsCommandWithItsArg`. Catches a button that drops `arg`.
- `base-kit.test.ts`: rows added to `commandRunner_UnknownId_ThrowsAtCreationAndRunsOnlyOnCall` for a bad `arg`, a missing declared `arg`, and an `arg` on a command with none. Catches a layout mistake surfacing only on a click.
- `base-kit.test.ts`: `kitCommandsOf_ArgGiven_RunsThroughCommandKey`. Catches a helper that drops `arg` on the way to `commands.run`.
- `layout-contracts.test.ts`: `every owner contract type-checks beside kit.d.ts` runs on the new text. Catches a `layout.d.ts` that clashes with the new `button`.
- `command-args.test.ts`: `commandArgLabel_EachShape_PrintsPinnedText`, a table with the three rows above. `sameCommandArg_RecordFieldOrder_Same`. Catches a duplicate row from field order.
- `key-hints.test.ts`: change `spells the leader and merges the digit binds` so its digits carry no `arg` and still merge, and add `mergeHints_DifferentArgs_KeepOneRowEach` plus a row for two keys on one `arg`. Catches an arg dropped from a help row, and a repeat of one arg.
- `help-sections.test.ts`: `helpSections_BindWithArg_LabelsTheArg`. Catches help reading the bare label.
- `which-key.test.ts`: `whichKeyModel_BindWithArg_LabelsTheArg`. Catches which-key reading the bare label.
- `keymap-rows.test.ts`: narrow `keymapRows_EveryCommandHasARow` to commands with no `arg`, and add `keymapRows_ArgCommand_OneRowPerBoundArgAndNoneUnbound` and `replacedBy_ArgCommand_NamesItOnce`. Catches an unbound click command in Settings, and a repeated command in the replaced list.
- `list-picker.test.ts`: rows added to `drawRow_DrawsEachVisibleItemAndKeepsCursorAndClick` that assert `run` gets `picker.chooseRow` with owner and index, on both built-in and `drawRow` rows. `backdropClick_RunsPickerCancelWithOwner`. `chooseAt_HiddenIndex_DoesNothing`. Catches a click that skips the command, or chooses a filtered-out row.
- `picker-commands.test.ts`: `chooseRow_TwoOwners_ReachesTheOwnersPicker`. `track_SecondPickerForOwner_Throws`. Catches a click reaching another plugin's picker.
- `unity-pool/page/start.test.ts`: `hold_RunsActionOnTheArgsPoolAndClone`, with a row for `release`. Catches the Hold button losing its target in the move.

A test that clicks a picker row wires `run` to a fake that calls `chooseAt` or `cancel`, or runs through the part harness's real registry.

## Done when

The tree compiles. The layer check passes. `grep -rn "onClick" src/shared/page/layout-host/kit.d.ts` finds nothing on `button`. The test gate runs the tests above.

## Commit

One commit for the group.

## Proof

