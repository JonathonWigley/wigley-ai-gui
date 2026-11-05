# 02 — Sweep: forms and primer

Status: not started
Type: Task
Wave: 2 · Depends on: 01
Plan: [plan.md](plan.md)

**Contents**

- **Files** — what this task modifies and tests.
- **Consumes** — the signatures this task uses, copied.
- **Produces** — the commands this task adds, by site.
- **Decisions** — the click and key rule, what goes, what stays.
- **Behaviour** — GIVEN/WHEN/THEN.
- **Tests** — each with the break it catches.
- **Done when**, **Commit**, **Proof**.

## Files

Forms:

- modify `src/plugins/forms/manifest.ts`, `src/plugins/forms/contract.ts`
- modify `src/plugins/forms/page/forms-commands.ts`; test `src/plugins/forms/page/forms-commands.test.ts`
- modify `src/plugins/forms/page/layout/card-kit.ts`; test `src/plugins/forms/page/layout/card-kit.test.ts`
- modify `src/plugins/forms/page/layout/layout-panes.ts`; test `src/plugins/forms/page/layout/layout-panes.test.ts`
- modify `src/plugins/forms/page/view-model.ts` (`reviewRowsByRailPosition` moves here, exported)
- modify `src/plugins/forms/page/kinds/item-format.ts` (`CardDeps`), `src/plugins/forms/page/round-view.ts` (its `toggleDontAsk` dep at line 349, measured at plan time)
- modify `src/plugins/forms/layouts/layout.d.ts`

Primer:

- modify `src/plugins/primer/manifest.ts`, `src/plugins/primer/contract.ts`
- modify `src/plugins/primer/page/primer-commands.ts`; test `src/plugins/primer/page/primer-commands.test.ts`
- modify `src/plugins/primer/page/layout/primer-kit.ts`; test `src/plugins/primer/page/primer-view.test.ts`

## Consumes

From `plan-commands-and-state`:

- `export type CommandArgShape = 'number' | 'string' | { readonly [field: string]: 'number' | 'string' };` and `export interface CommandKey<A, Id extends string = string> { readonly id: Id; readonly argType?: A; }`, in `src/contracts/commands.ts`.
- `CommandDecl` gains `arg?: CommandArgShape`. `PageCommandContext<A = undefined>` is `{ editor?: TextEditor; arg: A }`.
- `commands.run(id: CommandId): Promise<void>` and `run<A>(key: CommandKey<A>, arg: A): Promise<void>`.
- `forms.choose`, one command with `arg: 'number'`, in place of `choose1..choose9`. Its binds carry the digit as `arg`. The number is 1-based: a question's choice, or a finding's entry.

From task 01:

- `button(parent: HTMLElement, label: string, command: string, options?: KitButtonOptions): HTMLButtonElement`
- `command(qualifiedId: string, arg?: CommandArg): () => void`
- A command with a declared `arg` lists only while a key binds it.

From the tree: `railPickAction`, `pickRailItem`, `jumpedToLine` and `jumpMoved` in `src/plugins/forms/page/view-model.ts`. `reviewRowsByRailPosition(round)`, private in `layout-panes.ts` at line 232 (measured at plan time). `changeAnswer`, `boxIn`, `focusBoxItem` in `forms-commands.ts`. The `selectTask` and `selectItem` actions in `src/plugins/primer/page/primer-state.ts`.

## Produces

Each command takes no key. Each declares an `arg`, so none lists in Settings, help or the palette while unbound. Each has a `CommandKey` in its plugin's `contract.ts`.

Forms commands, `runsIn: 'page'`, in `src/plugins/forms/manifest.ts`:

| Command | `arg` | Label | Group | Site |
|---|---|---|---|---|
| `forms.chooseAt` | `{ item: 'number', number: 'number' }` | `pick the numbered choice on the item` | `choices` | `card-kit.ts:591,732,758`; `kinds/card-parts.ts:124` takes it through `pick` |
| `forms.clearChoiceAt` | `'number'` (rail position) | `clear the choice on the item` | `choices` | `card-kit.ts:642` Clear |
| `forms.acceptRecommendationAt` | `'number'` (rail position) | `accept the recommendation on the item` | `choices` | `card-kit.ts:817` Accept |
| `forms.toggleNotApplicableAt` | `'number'` (rail position) | `not applicable on the item` | `answer` | `card-kit.ts:548` |
| `forms.toggleDontAskAt` | `'number'` (rail position) | `don't ask me this on the item` | `answer` | `card-kit.ts:553` |
| `forms.focusItem` | `'number'` (rail position) | `focus the item` | `items` | a layout's use in place of `kit.run({ type: 'focus' })` |
| `forms.pickRailItem` | `'number'` (rail position) | `pick the rail item` | `items` | `layout-panes.ts:187` rail entry |
| `forms.reviewJumpAt` | `'number'` (review row) | `jump to the review row` | `review` | `layout-panes.ts:455` review pick |

`item` and every rail position are 0-based, as the `focusItem` action reads them. `number` is 1-based.

Forms' `Kit` in `src/plugins/forms/layouts/layout.d.ts`:

- Remove `run(action: LayoutAction): void` and the `LayoutAction` type.
- Add `readonly position: number;`, with the comment: `` This card's item's rail position, the `arg` of `forms.focusItem` and the `forms.*At` commands, and the `item` of `forms.chooseAt`. ``

Primer commands, `runsIn: 'page'`, in `src/plugins/primer/manifest.ts`:

| Command | `arg` | Label | Group | Site |
|---|---|---|---|---|
| `primer.selectTask` | `'number'` (position in `taskRows`, 0-based) | `select the task row` | `rows` | `primer-kit.ts:250`, reaching rows at `:319,332` |
| `primer.selectItem` | `'number'` (the item, 1-based) | `select the item row` | `rows` | `primer-kit.ts:283`, reaching the row at `:367` |
| `primer.toggleIncludeAt` | `'number'` (the item, 1-based) | `include the item row` | `items` | `primer-kit.ts:285` item row's mark |

The arg numbering matches the `selectTask` action's `row` and the `selectItem` action's `item` as they stand.

Primer's `includeMark` at `primer-kit.ts:200` acts on the selected item, as the key does. It runs the existing `primer.toggleInclude`, and adds no command.

## Decisions

**A click names its item, and a key means the focused one: two commands, never an optional arg.**

- `<short>` acts on the focused item, and on the item of the box holding focus. That is `forms.choose`, `forms.clearChoice`, `forms.toggleNotApplicable` and the rest, unchanged.
- `<short>At` acts on the item its `arg` names.
- An optional arg is rejected for three reasons. `CommandArgShape` has no optional form, so `checkCommandArg` refuses a missing arg. A bind's `arg` is static, so a key cannot name the focused item. A second command lists nowhere and costs no row.
- Sessions, agent-strip and every later sweep use the same suffix (task 04).

**An `At` handler ignores the focused box.**

- It dispatches `focusItem` with its position, then applies the action to the focused item.
- It does not call `boxIn` or `focusBoxItem`. A button never takes DOM focus, so a box in another card can still hold focus during the click. `focusBoxItem` would move the focus back to that box's item, and the answer would land on the wrong item.
- Split `changeAnswer`: a new private `applyAnswer(deps, action, describe)` holds its last five statements. `changeAnswer` calls `focusBoxItem` and then `applyAnswer`. An `At` handler dispatches `focusItem` and then calls `applyAnswer`. `describe` is the same function for both, so a click logs the same line a key logs.
- This fixes one behaviour: Don't ask's click today runs the `toggleDontAsk` command after focusing, and that command re-focuses the active box's item. The At command acts on the clicked item. `forms.toggleDontAskAt` still focuses the reason box when the answer turns on, as `toggleDontAsk` does.

**`forms.chooseAt` logs as `forms.choose` does.** Both use one `describeChoice(number)`.

**`kit.run` and `runLayoutAction` go.**

- Remove `runLayoutAction`, `layoutActions` and `Kit.run`. No layout in the tree calls `kit.run` (measured at plan time, re-verify with `grep -rn "kit.run" src/plugins/forms/layouts`), and no user layout exists (`plan.md` § Preconditions).
- Each `kit.run` site in `card-kit.ts` uses the runner `kit.command(id, arg)`, obtained while the card builds. A `pick` closure that takes a number at click time calls `kit.command(chooseAt, { item: position, number })()`.
- Clear at `card-kit.ts:642-646` runs `forms.clearChoiceAt` alone. Its two dispatches go.
- `CardDeps.toggleDontAsk` and `round-view.ts:349` go. `CardDeps.dispatch` goes when no caller remains; check with grep.

**The rail handler reads state.** `forms.pickRailItem(position)` calls `pickRailItem` with `store.get().view`, the active round's rail item at `position`, and the `reviewRowsByRailPosition` entry at `position`. `round-view.ts:312` defines `shownView` as the same `view`. All three come from the store at run time, so an arg holds one number. With no active round the handler does nothing. `reviewRowsByRailPosition` moves to `view-model.ts`, exported, so `forms-commands.ts` reads it without importing a layout file. `layout-panes.ts` removes its closure over `reviewRowAt` at the entry. `reviewRowAt` stays for what else reads it.

**The rail's rule stays in `railPickAction`.** Focus in the forms view, jump in the review, nothing under the confirm or with no round.

**What already runs a command stays:** `layout-panes.ts:429` `appendReviewButton`, `round-view.ts:434` Review, `primer-review.ts:115`, `primer-view.ts:768`, and the confirm prompts' buttons.

**Number hints.** `kinds/card-parts.ts:150` anchors each choice's hint through `numberedCommand('choose', number)`. `plan-commands-and-state` owns that conversion. This task leaves whatever it landed.

**`PrimerKitDeps`.** Primer's kit uses the `run` its deps hold or gains `run: (command, arg) => void`. Remove `dispatch` from its deps when grep shows no caller left. `primer.toggleIncludeAt` dispatches `selectItem` then `toggleInclude`, the order the row's mark runs today.

**Primer handlers.** Primer's rows have no focused-box case, so these handlers dispatch directly.

**Sweep.** What the user sees does not change. A click adds a log line, the one the key logs. Self-test `expect` lines stand, since a line is only added; a line a test expects absent moves with the change.

## Behaviour

- GIVEN a box in card 2 holds focus WHEN the user clicks choice 3 on card 4 THEN `forms.chooseAt` runs with `{ item: 4, number: 3 }`, item 4 takes focus, and item 4 holds choice 3.
- GIVEN item 4 holds choice 3 WHEN the user clicks choice 3 on card 4 THEN the choice clears, as the key does.
- GIVEN the forms view WHEN the user presses `3` THEN `forms.choose` runs with `3` on the focused item.
- GIVEN the forms view WHEN the user clicks rail position 2 THEN `forms.pickRailItem` runs with `2` and item 2 takes focus.
- GIVEN the review view WHEN the user clicks the rail entry of an item with a row THEN the view jumps to that row's item. GIVEN a notice WHEN clicked THEN its card shows. GIVEN the confirm view WHEN clicked THEN nothing happens.
- GIVEN the review view WHEN the user clicks row 5's pick THEN `forms.reviewJumpAt` runs with `5`.
- GIVEN the Don't ask click turns the answer on THEN the reason box takes focus.
- GIVEN the primer tasks column WHEN the user clicks row position 1 THEN `primer.selectTask` runs with `1`.
- GIVEN the items column WHEN the user clicks the mark on the row at position 1 THEN `primer.toggleIncludeAt` runs with `2`, item 2 is selected, and its include flips.
- GIVEN any added command WHEN Settings draws THEN it has no row.

Runtime checks collect in [Final verification](11-final-verification.md). This task adds none here.

## Tests

- `forms-commands.test.ts`: `atCommands_BoxFocusedOnOtherItem_ActOnTheNamedItem`, one table with a row per `forms.*At` command. Catches a click answer landing on the box's item.
- `forms-commands.test.ts`: `chooseAt_HeldNumber_ClearsAndLogsAsChooseDoes`. Catches two copies of the choice rule drifting.
- `forms-commands.test.ts`: `toggleDontAskAt_TurnsOn_FocusesReasonBox`. Catches the reason box losing focus in the move off `kit.run`.
- `forms-commands.test.ts`: `pickRailItem_EachView_FollowsRailPickAction`, rows for forms, review with a row, review notice and confirm. Catches the handler reading a stale review row. The `railPickAction` test keeps the rule.
- `card-kit.test.ts`: delete `kitRun_UnknownActionType_LogsAndDispatchesNothing`, since its seam goes. Add `cardControls_Click_RunTheirAtCommandWithPosition`, a table for choice, group pick, Clear, Accept, Not applicable and Don't ask. Catches a control running the key's command, or the wrong position.
- `layout-panes.test.ts`: `railEntry_Click_RunsPickRailItem` and `reviewPick_Click_RunsReviewJumpAt`. Catches a dropped arg, or a dispatch left behind.
- `primer-commands.test.ts`: `selectCommands_ArgNamesTheRow`, a table for `selectTask`, `selectItem` and `toggleIncludeAt`. Catches an off-by-one between position and 1-based item.
- `primer-view.test.ts`: `tasksAndItems_Click_RunTheirCommands`, with a row for `includeMark` running `primer.toggleInclude`. Catches a click left on a dispatch.

## Done when

The tree compiles. The layer check passes. `grep -rn "LayoutAction\|runLayoutAction\|kit\.run" src/plugins/forms` finds nothing outside this task's history. `grep -n "deps\.dispatch" src/plugins/primer/page/layout/primer-kit.ts` finds nothing. The test gate runs the tests above, with a filtered self-test naming forms and primer.

## Commit

One commit for the group.

## Proof

