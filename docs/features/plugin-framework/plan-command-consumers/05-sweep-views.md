# 05 — Sweep: docs, notes, backlog, settings, unity-pool

Status: not started
Type: Batch
Wave: 2 · Depends on: 01
Plan: [plan.md](plan.md)

**Contents**

- **Files** — every file this task creates, modifies or tests.
- **Consumes** — the signatures this task reads.
- **Produces** — the added commands, keys, members and signatures.
- **Decisions** — one section per plugin.
- **Behaviour** — GIVEN/WHEN/THEN.
- **Tests** — the tests and the break each catches.
- **Done when** and **Commit**.

## Files

All paths are under `src/plugins/`.

- Docs: modify `docs/manifest.ts`, `docs/contract.ts`, `docs/main/start.ts`, `docs/page/start.ts`, `docs/page/docs-view.ts`, `docs/page/tree-view.ts`, `docs/page/doc-view.ts`, `docs/page/docs-dialogs.ts`. Test `docs/page/tree-view.test.ts`, `docs/page/doc-view.test.ts`, `docs/page/docs-dialogs.test.ts`, `docs/page/start.test.ts`. Modify the fake `docs/page/docs-page-fakes.ts`.
- Notes: modify `notes/manifest.ts`, `notes/contract.ts`, `notes/page/popup.ts`, `notes/page/markup-view.ts`, `notes/page/layout/notes-parts.ts`. Test `notes/page/popup.test.ts`, `notes/page/markup-view.test.ts`.
- Backlog: modify `backlog/manifest.ts`, `backlog/contract.ts`, `backlog/page/start.ts`, `backlog/page/backlog-view.ts`. Test `backlog/page/backlog-view.test.ts`.
- Settings: modify `settings/manifest.ts`, `settings/contract.ts`, `settings/page/start.ts`, `settings/page/settings-view.ts`. Test `settings/page/settings-view.test.ts`. `settings/page/sections-view.ts` does not change.
- Unity-pool: modify `unity-pool/manifest.ts`, `unity-pool/contract.ts`, `unity-pool/page/start.ts`, `unity-pool/page/pool-view-model.ts`, `unity-pool/layouts/layout.d.ts`, `unity-pool/layouts/default/layout.js`. Test `unity-pool/page/pool-view-model.test.ts`, `unity-pool/page/start.test.ts`.

## Consumes

From `plan-commands-and-state` task 07, on `PageApi`, in `src/contracts/commands.ts` and `src/contracts/plugin.ts`:

- `export type CommandArgShape = 'number' | 'string' | { readonly [field: string]: 'number' | 'string' };`
- `export interface CommandKey<A, Id extends string = string> { readonly id: Id; readonly argType?: A; }`
- `CommandDecl` gains `arg?: CommandArgShape`.
- `PageCommandContext<A = undefined>` is `{ editor?: TextEditor; arg: A }`. A handler is `(context) => void | Promise<void>`.
- `commands: { run(id: CommandId): Promise<void>; run<A>(key: CommandKey<A>, arg: A): Promise<void>; … }`. An unknown id or a bad arg throws at the call.

From `plan-commands-and-state` task 09, on `PageServices`: `openExternal(url: string): Promise<void>`.

From `plan-commands-and-state` task 13: unity-pool's state moves to a slot. This task reads `pool.pool` and `clone.number` from the `PoolState` that task leaves, and adds no state.

From task 01 of this plan, on `BaseKit`:

- `button(parent: HTMLElement, label: string, command: CommandId, options?: { arg?: CommandArg; variant?: string; keys?: string }): HTMLElement`
- `command(id: CommandId, arg?: CommandArg): () => void`. Getting the runner runs nothing, and it checks the id and `arg` when called. So call it while the part builds.
- A command with a declared `arg` lists in Settings and help only when a key binds it. So the commands below add no visible row.
- `keyRunner(commands: Pick<PageApi['commands'], 'run'>, log: PluginLog): <A>(key: CommandKey<A>, arg: A) => void`, in `src/shared/page/layout-host/base-kit.ts`. It catches a throw at the call and logs `command <id> failed: <error text>`.

Members the tree holds: `allViews()`, `activeView()`, `onActiveView()` and `addedViews` in `docs/page/start.ts`; `kit.keyHint` on `DocsKit`; `sessions.activate(sessionId)` on `SessionsPageExports`; `runAction` in `unity-pool/page/start.ts`.

## Produces

Commands in each `manifest.ts`, each `runsIn: 'page'`, each with no key and no anchor:

| Command | `arg` | Label | Group | Site served |
|---|---|---|---|---|
| `docs.openNode` | `{ viewId: 'string', nodeId: 'string' }` | `open this row` | `tree` | tree node, `tree-view.ts:297` |
| `docs.followLink` | `{ viewId: 'string', href: 'string' }` | `follow this link` | `doc` | link, `doc-view.ts:309` and `:533` |
| `docs.answerConfirm` | `{ viewId: 'string', answer: 'string' }`, `answer` being `yes` or `no` | `answer this Trash prompt` | `confirm` | Trash prompt buttons, `docs-dialogs.ts:296` |
| `notes.pickColour` | `'string'`, a `MarkupColour` | `pick this colour` | `markup` | colour button, `notes-parts.ts:502` |
| `notes.removeImageAt` | `'number'`, the 0-based image index | `remove this image` | `images` | image remove, `notes-parts.ts:271` |
| `notes.removeSession` | `'string'`, the session id | `remove this session` | `fields` | session remove, `notes-parts.ts:308` |
| `backlog.openHomeRow` | `'string'`, the home root | `open this home` | `list` | home row, `backlog-view.ts:563` |
| `backlog.selectRow` | `'string'`, the row key | `select this row` | `list` | item row, `backlog-view.ts:701` |
| `settings.moveToRow` | `'string'`, the row key | `move the cursor to this row` | `settings` | row, `settings-view.ts:494` |
| `settings.openSectionAt` | `'number'`, the section index | `open this section` | `settings` | section, `sections-view.ts:64` through `settings-view.ts:322` |
| `unity-pool.selectHolder` | `'string'`, the session row id | `show the holder's session` | `pool` | holder, `layout.js:154` |

In each `contract.ts`, one typed key per command, each a typed object literal such as `export const docsOpenNodeCommand: CommandKey<{ viewId: string; nodeId: string }, 'docs.openNode'> = { id: 'docs.openNode' };`. Keys are needed only where the page calls `runKey`:

`docsOpenNodeCommand`, `docsFollowLinkCommand`, `backlogOpenHomeRowCommand`, `backlogSelectRowCommand`, `settingsMoveToRowCommand`, `settingsOpenSectionAtCommand`.

Notes, unity-pool and `docs.answerConfirm` run through `kit.command` and `kit.button`, by qualified id, and declare no key.

Members:

- `runKey<A>(key: CommandKey<A>, arg: A): void` on `DocsViewDeps` in `docs/page/docs-view.ts`, `BacklogViewDeps` in `backlog/page/backlog-view.ts` and `SettingsViewDeps` in `settings/page/settings-view.ts`. Each `start.ts` wires it to `keyRunner(api.commands, <the plugin's log>)`, so a click whose run throws leaves a log line.
- `openExternal(url: string): Promise<void>` on `DocsViewDeps` and `DocViewDeps`. `docs/page/start.ts` wires it to `services.openExternal`.
- `rowClicked(nodeId: string): void` on `TreeViewDeps`, and `openNode(nodeId: string): void` on `TreeView`, in `docs/page/tree-view.ts`.
- `linkClicked(href: string): void` on `DocViewDeps`, and `followHref(href: string): void` on `DocView`, in `docs/page/doc-view.ts`.
- `openNode(nodeId: string): void`, `followLink(href: string): void` and `answerConfirm(answer: string): void` on `DocsView` in `docs/page/docs-view.ts`.
- `viewId: string` on `DocsDialogsDeps` in `docs/page/docs-dialogs.ts`. `docs-view.ts` passes `deps.viewId`.
- `pickColourByName(colour: string): void` on `MarkupView` in `notes/page/markup-view.ts`.
- `openHomeRow(root: string): void` and `selectRow(key: string): void` on `BacklogView` in `backlog/page/backlog-view.ts`.
- `moveToRow(key: string): void` and `openSectionAt(index: number): void` on `SettingsView` in `settings/page/settings-view.ts`.
- In `unity-pool/layouts/layout.d.ts`: `HolderInput.select` becomes `sessionId: string | null`. The `action` member task 01 left stays.
- In `unity-pool/page/pool-view-model.ts`: `panelInput(pool: PoolState, rows: readonly PoolRow[], now: number, pending: ReadonlyMap<number, PendingAction>): PanelInput`.

Already removed by `plan-commands-and-state` task 09: the `openExternal` member of `DocsChannel`, its handler in `docs/main/start.ts`, and the `EXTERNAL_SCHEME` import there. Check with `grep -n openExternal src/plugins/docs/contract.ts src/plugins/docs/main/start.ts`, which prints nothing.

## Decisions

**Every command takes an arg, unity-pool's and the removes included.** A command with no `arg` lists in Settings as an unbound row, which is a visible change. So `notes.removeSession` names the session, though the draft holds one session. A sweep keeps what the user sees.

**Order.** Each handler keeps today's click order. The orders are pinned under each plugin. One click runs one command in this task, so no order depends on when `commands.run` starts a handler.

### Docs

- **The arg names the view.** A click acts in the view that holds the row or link. Added views have their own trees, and a link resolves against its own view's open file. `onActiveView` reads the active view, so these handlers do not use it. So `docs.followLink`'s arg holds `viewId` beside `href`.
- **View lookup in `docs/page/start.ts`.** `viewNamed(viewId)` gives `machineView` for `'machine'`, else `addedViews.get(viewId)?.view`. An unknown view logs `<short> for unknown view <id> ignored`.
- **Handlers.** Add `openNode`, `followLink` and `answerConfirm` beside the `onActiveView` entries in `start.ts`'s `commands`. They do not join `DocsViewCommands`, which holds handlers with no argument. `TREE_COMMANDS_IN_SIGHT` does not gain them: a click means the row or link is in sight.
- **Tree node.** `rowAction(item, () => deps.rowClicked(row.node.id))`. `TreeView.openNode(nodeId)` keeps today's order: set `state.selectedId`, `pane.focus()`, `view.open()`. A node with no row logs `no row <id>` and leaves the selection. `rowAction` keeps its focus guard and its check for a disabled row.
- **Link.** The `body` listener keeps `closest('a.md-link')`, the `shown === null` check and `event.preventDefault()`, then calls `deps.linkClicked(anchor.dataset.href ?? '')`. `DocView.followHref(href)` holds today's `resolveLink` and `switch`. With `shown === null` it logs `no doc open for link <href>` and does nothing.
- **External link.** The `external` case calls `deps.openExternal(target.url)`, with today's `.then(log)` and `.catch(toast)`. The log line `opened link <url>` and the error toast stay. `EXTERNAL_SCHEME` stays in `docs/links.ts`, where `resolveLink` reads it.
- **Trash answers.** A click answers the prompt of the view that drew it. A key answers the active view's prompt. So a click and a key run two commands, as `plan.md` § File Structure says.
  - `confirmYes` and `confirmNo` stay as they are, for the keys. They reach `confirm.yes` and `confirm.no` through `onActiveView`.
  - `activeView` gives the machine view while Docs mode shows, else the first visible added view. So a prompt can be open in a view that is not active. The click must not read `activeView`.
  - `createConfirm` takes `viewId`. `answerButton`'s last parameter becomes the runner. Its `kit` member reads `kit.command(qualify(docsManifest.id, 'answerConfirm'), { viewId, answer: pick })` while the part builds. `textButton`, `variant` and the `kit.keyHint` hint for `confirmYes` or `confirmNo` stay.
  - The handler finds the view through `viewNamed(arg.viewId)` and calls `view.answerConfirm(arg.answer)`. `DocsView.answerConfirm` calls `dialogs.confirmYes()` for `yes` and `dialogs.confirmNo()` for `no`. Any other text logs `no trash answer <answer>` and answers nothing.
  - A view with no open prompt does nothing, as `answer` already holds `answers === null`. `answer(pick)` stays private to `confirm.yes`, `confirm.no` and `onBaseChanged`.

### Notes

- **Tool buttons need no change.** `MARKUP_TOOLS` entries already run `toolSelect`, `toolPen`, `toolText`, `toolArrow` and `toolBox` through `commandButton` in `toolButton`, in `notes-parts.ts`. The fact map's table reads these as no command. That reading is out of date.
- **Colour.** `drawToolbar`'s `pickColour` parameter goes, and so does `NotesParts.markupToolbar`'s second parameter. The button's click is `base.command(qualify(PLUGIN_ID, 'pickColour'), colour)`, read while the part builds. `MarkupView.pickColourByName(colour)` calls the private `pickColour(MARKUP_COLOURS.indexOf(colour))`, whose session check stays. A name outside `MARKUP_COLOURS` logs `no markup colour <colour>` and changes nothing. `popup.ts`'s `commands` adds `pickColour: ({ arg }) => markupView.pickColourByName(arg)`.
- **Image remove.** The kit's `removeButton` runs `kit.command(qualify(PLUGIN_ID, 'removeImageAt'), position - 1)`. `ImageEntries.removeImageAt` goes. The handler is `void removeImageAt(index)`. It does not go through `whileEditable`, since today's click does not. `runDraftOperation` and the gone-image check stay in force.
- **Session remove.** `NotesParts.session`'s third parameter becomes `sessionId: string | null`, and `drawSession` passes `session?.sessionId ?? null`. The kit's `removeButton` runs `kit.command(qualify(PLUGIN_ID, 'removeSession'), sessionId)`. With a null id the button runs nothing, and no runner is made. The handler calls `removeSession()` when the draft's attached session has that id, else logs `session <id> not attached`. `removeSession`'s `isLocked` check stays.
- **Typing.** `createNotePopup`'s `commands` becomes `PageStart<typeof notesManifest>['commands']`. The existing handlers with no parameter still fit that type.
- **Keys.** `remove`, `nextColour` and `prevColour` do not change. `remove` acts on the focused field through `whileEditable`.

### Backlog

- **Home row.** `rowAction(root, () => deps.runKey(backlogOpenHomeRowCommand, home.root))`. `BacklogView.openHomeRow(root)` keeps today's order: `dispatch({ type: 'openHome', root })`, then `deps.homePicked()`.
- **Item row.** `rowAction(root, () => deps.runKey(backlogSelectRowCommand, shown.key))`. `BacklogView.selectRow(key)` keeps today's order: `dispatch({ type: 'select', key })`, then `dispatch({ type: 'focus', focus: 'items' })`.
- **Stale arg.** The run is deferred, so the row can go between the draw and the handler. `openHomeRow(root)` checks `orderedHomes(store.get())`. A root no home holds logs `no home <root>` and returns before `dispatch` and `homePicked`. `selectRow(key)` checks `visibleRows(store.get(), matcher)`. A key no row holds logs `no row <key>` and returns before either `dispatch`.
- **Typing.** `BacklogCommand` excludes `openHomeRow` and `selectRow` beside `showMode`. `start.ts`'s `commands` adds them beside `showMode`: `openHomeRow: ({ arg }) => view.openHomeRow(arg)`.

### Settings

- **Row.** The listener keeps the `.settings-box` check at the click and calls `deps.runKey(settingsMoveToRowCommand, row.key)` when the click is outside the box. The `openBox === null` check moves into `moveToRow(key)`, which reads the state when it runs. `moveToRow` then keeps today's order: `setCursor(key)`, `focusRows()`. A key no row in `rows` holds logs `no row <key>` and moves nothing.
- **Section.** `clicked: (index) => deps.runKey(settingsOpenSectionAtCommand, index)`. `openSectionAt(index)` keeps today's order: `sectionsCursor = index`, `focusSections()`, `openSection(index)`, `deps.sectionPicked()`. `sections-view.ts` keeps `deps.clicked(index)` and `rowAction`.
- **Why an index.** The cursor and `openSection` already work by index. `openSection` already ignores an index with no section, but `sectionPicked` still runs after it, as today's click would. `openSectionAt` returns before it changes anything when `index` holds no section, and logs `no section <index>`.
- **Typing.** `SettingsCommand` is a closed union and does not gain the two. `start.ts`'s `commands` adds them beside `showMode`.

### Unity-pool

- **Task 01 moved Hold and Release.** `unity-pool.hold`, `unity-pool.release`, their handlers and `layout.js:64` are in the tree. This task adds only the holder click. Keep `kit.button`'s `HTMLButtonElement` return: `button.disabled` needs no cast.
- **View model.** `holderInput` gives `sessionId: row.sessionId`, and `sessionId: null` where `select` was null.
- **Layout.** `drawHolder` reads `holder.sessionId`. It returns as plain text when null. Otherwise it keeps the `is-link` class and the `mousedown` guard.
  - `const run = kit.command('unity-pool.selectHolder', holder.sessionId)` sits in the body of `drawHolder`, outside the listener. Both callers, `panel` and `drawTicket`, reach it while the part builds. So a bad id or `arg` throws at build, and the part falls back to `default`.
  - The click calls `run()`. A `kit.command` call inside the listener makes a runner and never runs it, and `layout.js` gets no compiler help on this.
- **Handler in `start.ts`.** Add `selectHolder: ({ arg }) => sessions.activate(arg)` beside `hold` and `release`.
- **Manifest comment.** Update the comment above `unityPoolManifest`, and keep its `commands` to these three.

## Behaviour

GIVEN two docs views WHEN the user clicks a row in the view that is not active THEN that view's row is selected, its tree has focus and the row opens.

GIVEN an open doc in a second docs view WHEN the user clicks a relative link THEN the link resolves against that view's file and opens there.

GIVEN an http link WHEN the user clicks it THEN `services.openExternal` receives the URL and `opened link <url>` is logged. A rejection shows as an error toast.

GIVEN the Trash prompt WHEN the user clicks Move to the Trash THEN the doc moves as `confirmYes` moves it, and the dialog closes.

GIVEN a Trash prompt open in an added view while Docs mode shows WHEN the user clicks its answer THEN that view's prompt takes the answer, and the machine view's dialogs do not change.

GIVEN a home row or item row gone before its handler runs WHEN the handler runs THEN the log names the root or key, and nothing changes. The side bar overlay stays open.

GIVEN the markup view WHEN the user clicks a colour THEN the pen takes that colour and `colour <name>` is logged.

GIVEN a draft with two images WHEN the user clicks the second's remove THEN the second goes, whichever image the cursor is on.

GIVEN a locked draft WHEN the user clicks the session's remove THEN the session stays.

GIVEN Backlog with the homes focused WHEN the user clicks an item row THEN that row is selected and the items pane has focus.

GIVEN a Settings row box open WHEN the user clicks another row THEN the cursor stays.

GIVEN a clone a session holds WHEN the user clicks the holder's label THEN that session's row is selected and the focus stays where it was.

GIVEN Settings WHEN the user opens the keymap section THEN no row names a command of this task.

GIVEN a click in docs, backlog or settings whose command run throws WHEN the click lands THEN the log reads `command <id> failed: <error text>` and the page keeps working.

Runtime checks that a test cannot settle collect in [Final verification](11-final-verification.md).

## Tests

Docs:

- `tree-view.test.ts`, new `openNode_Row_SelectsFocusesThenOpens`. Break: `view.open()` runs before the selection moves, so the previously selected row opens.
- `tree-view.test.ts`, new `openNode_NoRow_LogsAndKeepsTheSelection`. Break: the selection moves to an id with no row and the cursor disappears.
- `doc-view.test.ts`, new `followHref_ByLinkKind_ActsAsTheLinkMeans`, a table: external calls `openExternal`, heading scrolls, a missing heading toasts, a file calls `followFile`, unsupported toasts. Break: a case is lost in the move out of the listener.
- `doc-view.test.ts`, new `linkClick_OutsideALink_CallsNothing`. Break: the `closest` check goes, so every body click runs the command.
- `docs-dialogs.test.ts`, new `confirmDialog_AnswerClick_RunsItsCommand`, rows yes and no. The fake records `docs.answerConfirm` with `{ viewId, answer }`. Break: a button keeps its closure and bypasses the command, or names another view.
- `start.test.ts`, new `clickCommand_ViewIdOfAnAddedView_ActsOnThatView`, rows `openNode`, `followLink` and `answerConfirm`, with Docs mode shown so the machine view is active. Break: the handler reads `activeView()`, so a click answers another view's prompt.
- `start.test.ts`, new `answerConfirm_UnknownAnswer_LogsAndAnswersNothing`. Break: any text other than `yes` counts as `no`, or as `yes`, and the doc moves.

Notes:

- `markup-view.test.ts`, new `pickColourByName_UnknownName_ChangesNothing`. Break: `indexOf` gives -1 and `MARKUP_COLOURS[-1]` reaches `readColour`.
- `markup-view.test.ts`, new `pickColourByName_KnownName_SetsThePenAndLogsColour`. Break: the name maps to the wrong index, or the `colour <name>` log is lost in the move.
- `popup.test.ts`, new `removeClick_RunsItsCommandWithItsTarget`, rows image at a 0-based index and session by id. The fake at `notes-page-fakes.ts:19` records the arg. Break: the button keeps its closure, or passes the 1-based `position`.
- `popup.test.ts`, new `colourClick_RunsPickColourWithItsName`. A colour button records `notes.pickColour` with the colour's name. Break: the button keeps its closure, or `popup.ts`'s `commands` has no `pickColour` entry, so the click does nothing.
- `popup.test.ts`, new `removeSession_OtherIdOrLockedDraft_KeepsTheSession`. Break: the handler detaches without its check.

Backlog:

- `backlog-view.test.ts`, new `rowClick_RunsItsCommandWithItsKey`, rows home root and item key. Break: a row keeps its closure.
- `backlog-view.test.ts`, new `openHomeRow_DispatchesThenCallsHomePicked`. Break: the `homePicked` call is lost in the move, and the side bar overlay stays open.
- `backlog-view.test.ts`, new `selectRow_SelectsTheRowAndFocusesTheItems`. Break: the focus dispatch is lost in the move.
- `backlog-view.test.ts`, new `rowCommand_TargetGone_LogsAndChangesNothing`, rows unknown root (`no home <root>`, no `homePicked`) and unknown key (`no row <key>`, focus unchanged). Break: `homePicked` still runs for a gone home and closes the side bar overlay with nothing opened.

Settings:

- `settings-view.test.ts`, new `rowClick_InsideBoxOrOutside_RunsMoveToRowOnlyOutside`. Break: the `.settings-box` check goes, and typing in a box moves the cursor.
- `settings-view.test.ts`, new `moveToRow_BoxOpenOrUnknownKey_LeavesTheCursor`. Break: the `openBox` check is lost in the move.
- `settings-view.test.ts`, new `openSectionAt_Index_OpensAndCallsSectionPicked`, rows a held index and an index with no section. Break: `sectionPicked` runs for an index with no section, which closes the side bar overlay with no section opened.

Unity-pool:

- `pool-view-model.test.ts`: `panelInput_Select_CallsActionWithRowId` becomes `panelInput_Holder_CarriesSessionId`, asserting `sessionId: 'row-7'`. Break: the holder names the wrong row.
- `start.test.ts`, new `selectHolder_RunsActivateWithTheRow`. It draws the `default` layout on the part harness and clicks the holder's label. The `sessions` fake records `activate`. Break: the layout makes the runner inside the listener and never runs it, so the click is dead, or the command is not wired to `sessions.activate`.

## Done when

- The project compiles, and `docs`, `notes`, `backlog`, `settings` and `unity-pool` pass their tests at the test gate.
- `grep -n "openNode\|followLink\|answerConfirm\|pickColour\|removeImageAt\|removeSession\|openHomeRow\|selectRow\|moveToRow\|openSectionAt\|unity-pool\.\(hold\|release\|selectHolder\)" src/plugins/keymap.ts` prints nothing.
- `grep -n "\.run\b\|select()" src/plugins/unity-pool/layouts/default/layout.js` prints nothing.
- `grep -n "'openExternal'" src/plugins/docs/page/doc-view.ts src/plugins/docs/main/start.ts` prints nothing.

The filtered self-tests are the gate's. Their `expect` lines do not move: no log line on a key path changes.

## Commit

One commit: `Docs, notes, backlog, settings, unity-pool: every click runs a command`.

## Proof

