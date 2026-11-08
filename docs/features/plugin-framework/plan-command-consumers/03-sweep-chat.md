# 03 — Sweep: chat

Status: in progress
Type: Task
Wave: 2 · Depends on: 01
Plan: [plan.md](plan.md)

**Contents**

- **Files** — every file this task creates, modifies or tests.
- **Consumes** — the signatures this task reads.
- **Produces** — the added commands, keys, members and signatures.
- **Decisions** — clicked versus focused, and each site's rule.
- **Behaviour** — GIVEN/WHEN/THEN.
- **Tests** — the tests and the break each catches.
- **Done when** and **Commit**.

## Files

All paths are under `src/plugins/chat/`, except `card.ts`.

- Modify `manifest.ts`, `contract.ts`.
- Modify `page/chat-commands.ts`, `page/chat-view.ts`, `page/chat-kit.ts`, `page/entry-list.ts`, `page/side-sections.ts`, `page/start.ts`.
- Modify `src/shared/page/ui/card.ts`.
- Test `page/chat-commands.test.ts`, `page/chat-kit.test.ts`, `page/entry-list.test.ts`, `page/side-sections.test.ts`, `page/chat-view.test.ts`, `page/start.test.ts`.

`page/composer-kit.ts`, `layouts/layout.d.ts` and `layouts/default/layout.js` do not change: their callbacks and part names stay.

## Consumes

From `plan-commands-and-state` task 07, on `PageApi`, in `src/contracts/commands.ts` and `src/contracts/plugin.ts`:

- `export type CommandArgShape = 'number' | 'string' | { readonly [field: string]: 'number' | 'string' };`
- `export interface CommandKey<A, Id extends string = string> { readonly id: Id; readonly argType?: A; }`
- `CommandDecl` gains `arg?: CommandArgShape`.
- `PageCommandContext<A = undefined>` is `{ editor?: TextEditor; arg: A }`. A handler is `(context) => void | Promise<void>`.
- `commands: { run(id: CommandId): Promise<void>; run<A>(key: CommandKey<A>, arg: A): Promise<void>; … }`. An unknown id or a bad arg throws at the call. It is not a rejected promise. A handler's throw or rejection is logged as `command <id> failed: <error text>`, and the promise resolves.
- `src/shared/command-args.ts`: `checkCommandArg(id: CommandId, shape: CommandArgShape | undefined, arg: unknown): string | null`, the error text or null.

From `plan-commands-and-state` task 12: chat entries sit in a keyed list slot, whole entries by id. This task reads a session's entries through `session.state.entries`, the member `chat-commands.ts` reads at plan time. Task 12 may change how the state fills. Use the member that task left.

From task 01 of this plan, on `BaseKit`: a command with a declared `arg` lists in Settings and help only when a key binds it. So the commands below add no visible row.

From task 01 of this plan, in `src/shared/page/layout-host/base-kit.ts`: `keyRunner(commands: Pick<PageApi['commands'], 'run'>, log: PluginLog): <A>(key: CommandKey<A>, arg: A) => void`. It catches a throw at the call and logs `command <id> failed: <error text>`.

Members the tree holds: `ChatTabs.session(sessionId: string): ChatSession | undefined`, `PermissionActions.allow(session, entry)` and `deny(session, entry)`, `pullBackQueued(deps, session, queuedId)`, `Attachments.removeAt(index: number): void`, `ImageViewer.open(images, index)`, `Expanders` in `page/chat-kit.ts`.

## Produces

Commands in `manifest.ts`, each `runsIn: 'page'`, each with no key and no anchor:

| Command | `arg` | Label | Group | Site served |
|---|---|---|---|---|
| `chat.allowEntry` | `{ sessionId: 'string', entryId: 'string' }` | `allow this tool once` | `permissions` | Allow once, `chat-kit.ts:181` |
| `chat.denyEntry` | `{ sessionId: 'string', entryId: 'string' }` | `deny this tool, with a reason` | `permissions` | Deny, `chat-kit.ts:184` |
| `chat.removeImageAt` | `{ sessionId: 'string', index: 'number' }` | `remove this attached image` | `box` | image remove, `composer-kit.ts:309`, wired at `chat-view.ts:748` |
| `chat.toggleRun` | `{ sessionId: 'string', runId: 'string' }` | `expand or collapse this activity line` | `entries` | activity line, `entry-list.ts:1023` |
| `chat.toggleExpander` | `{ sessionId: 'string', entryId: 'string', place: 'number' }` | `expand or collapse this part of the entry` | `entries` | expander head, `card.ts`, through `chat-kit.ts:64` |
| `chat.pullBackMessage` | `{ sessionId: 'string', queuedId: 'string' }` | `pull back this pending message` | `box` | pending row, `entry-list.ts:1071` |
| `chat.toggleSection` | `'string'`, the part id | `collapse or expand this session hub section` | `view` | section head, `side-sections.ts:372` |
| `chat.openImage` | `{ sessionId: 'string', entryId: 'string', index: 'number' }` | `open this image` | `image` | thumbnail, `chat-kit.ts:204` |
| `chat.moveFocus` | `{ sessionId: 'string', stopId: 'string' }` | `move the cursor to this stop` | `entries` | list click, `entry-list.ts:643` |

The expander command is a site beyond the fact map's table. The map lists no row for `createCollapsibleCard`'s head.

In `contract.ts`, one typed key per command, named as below, each a typed object literal such as `export const chatAllowEntryCommand: CommandKey<{ sessionId: string; entryId: string }, 'chat.allowEntry'> = { id: 'chat.allowEntry' };`:

`chatAllowEntryCommand`, `chatDenyEntryCommand`, `chatRemoveImageAtCommand`, `chatToggleRunCommand`, `chatToggleExpanderCommand`, `chatPullBackMessageCommand`, `chatToggleSectionCommand`, `chatOpenImageCommand`, `chatMoveFocusCommand`.

Members:

- `runKey<A>(key: CommandKey<A>, arg: A): void` on `ChatViewDeps` in `page/chat-view.ts`. `page/start.ts` wires it to `keyRunner(api.commands, services.log)`, so a click whose run throws leaves a log line.
- `runClicked(runId: string): void` and `stopClicked(stopId: string): void` on `EntryListDeps` in `page/entry-list.ts`.
- `toggleRun(runId: string): ToggleResult`, `toggleExpander(entryId: string, place: number): ToggleResult` and `moveFocusTo(stopId: string): boolean` on `EntryList` in `page/entry-list.ts`. The `ChatSession.entries` `Pick` in `page/chat-view.ts` gains these three.
- `expanderClicked(entryId: string, place: number): void` on `KitDeps`, and `openImages(entryId: string, index: number): void` in place of `openImages(images, index)`, in `page/chat-kit.ts`.
- `toggle(place: number): ToggleResult` on `Expanders` in `page/chat-kit.ts`.
- `toggleClicked(partId: string): void` on `SideSectionsDeps`, and `toggleSection(partId: string): void` on `SideSections`, in `page/side-sections.ts`.
- `createCollapsibleCard(options: CollapsibleCardOptions, headClicked?: () => void): CollapsibleCard` in `src/shared/page/ui/card.ts`.

`ToggleResult` moves from `page/entry-list.ts:89` to `page/chat-kit.ts`, since `entry-list.ts` imports the kit and the kit now names the type. `entry-list.ts` imports it from there. The name stays.

## Decisions

**Clicked versus focused.** A key and a click run different commands.

- `allowOrCopy`, `denyPermission`, `toggleEntry`, `removeImage` and `pullBackQueued` stay as they are. They declare no `arg`. They read the focus, the oldest pending permission or the newest pending row. They keep their rows in Settings and help, and their keys.
- A click runs a new command. Its `arg` names the entry, row or index that was clicked.
- The kit gives no optional argument. A declared `arg` takes a command off Settings and help unless a key binds it with that argument (task 01). So a declared `arg` on `allowOrCopy` removes its row and fails its bind.
- A click on Allow once allows and never copies. The key also copies, with no pending permission or with an open range. Two commands keep that difference.
- The Allow once and Deny hints stay anchored on `allowOrCopy` and `denyPermission`. The hint shows the key that means the same answer for the focused entry.

**The arg names the session.** A click acts in the tab that holds the clicked element. `sessionFor(tabs, context)` reads the visible tab, which is a different thing. A handler reads `tabs.session(arg.sessionId)`. An unknown session logs `<short> for unknown session <id> ignored`, as `fillComposer` logs, and does nothing. Update the comment above `chatCommandHandlers`: a command whose arg names a session acts on that session.

**Wiring.** The kit and list callbacks stay callbacks. The tab wiring in `chat-view.ts` (lines 748 to 767 at plan time) turns each one into `deps.runKey`:

- `allow: (entry) => deps.runKey(chatAllowEntryCommand, { sessionId: ref.sessionId, entryId: entry.id })`, and `deny` the same way. This replaces `deps.permissions.allow(ref, entry)` at the wiring. The handlers call `deps.permissions`.
- `removeImage`, `openImages`, `pullBack`, `runClicked`, `stopClicked` and `expanderClicked` follow the same form.
- `SideSectionsDeps.toggleClicked` is wired in `start.ts` to `runKey(chatToggleSectionCommand, partId)`.

**Handlers.** Each lives in `chatCommandHandlers` in `chat-commands.ts`, except `toggleSection`, which sits beside `toggleSideParts` in `start.ts` and joins that `Omit`.

| Command | Handler |
|---|---|
| `allowEntry` | Finds the entry. It must be `kind: 'permission'` with `answer === null`. Calls `deps.permissions.allow(session, entry)`. Otherwise logs `no pending permission <entryId> in <session name>`. It reads no range and copies nothing. |
| `denyEntry` | Same check. Calls `deps.permissions.deny(session, entry)`. |
| `removeImageAt` | Calls `session.attachments.removeAt(index)`. No log, as the click logs none today. |
| `toggleRun` | Calls `session.entries.toggleRun(runId)`. No log, as the click logs none today. |
| `toggleExpander` | Calls `session.entries.toggleExpander(entryId, place)`. No log. |
| `pullBackMessage` | Calls `pullBackQueued(deps, session, queuedId)`. Main refuses a row already sent, as today. |
| `toggleSection` | Calls `sideSections.toggleSection(arg)`, and does nothing else. See Section head for the lookup and the log lines. |
| `openImage` | See Thumbnail. |
| `moveFocus` | Calls `session.entries.moveFocusTo(stopId)`. No log. |

**Allow and Deny.** Keep `createPermissionPart`: its `act(current)` still takes the entry version the part holds. The entry's id goes into the arg, because the arg holds JSON fields only.

**Thumbnail.** `imageThumbnails` receives the entry's id and calls `deps.openImages(entryId, index)`. An arg holds strings and numbers, so it cannot carry the images. The handler finds the entry by `entryId`, requires `kind: 'user'` and an image at `index`, then calls `deps.viewer.open(entry.images, index)`. A miss logs `no image <index> in entry <entryId>` and opens nothing. The `toggleEntry` key still opens the viewer directly at index 0.

**Activity line and list click.** One click on an activity line runs two commands, in this order: `chat.toggleRun` from the slot's listener, `chat.moveFocus` from the list's listener. Bubbling gives that order, as today.

- The two stay separate, because the list's guards apply to the cursor move alone. Today a click with a text selection still toggles the line and leaves the cursor.
- The result does not depend on when each handler starts. `toggleRun` moves a focus on the run's steps to its line, and `moveFocus` then sets the line. In the other order the focus is already on the line and stays.
- Each listener reads the DOM at the click: selection, `CLICK_CONTROLS`, `stopIdOfTarget`. The arg carries the result. No handler reads the DOM event.

**List click.** `onListClick` keeps `isSelecting`, `isOnControl` and `stopIdOfTarget`. It calls `deps.stopClicked(stopId)` when `stopIdOfTarget` is not null. The `order.includes(stopId)` check moves into `moveFocusTo`, which returns false and leaves the focus when the stop is not in `order`. So a click on a slot's padding runs the command and moves nothing. A click that hits no slot runs nothing.

**Pending row.** `CLICK_CONTROLS` holds `.chat-queued-slot`, so its click moves no cursor. This stays.

**Expander head.** `createCollapsibleCard` takes the second parameter `headClicked`.

- With `headClicked`, the head calls it and does not call `setOpen`. Without it, the head toggles as today, so `gallery-view.ts` does not change.
- It is a second parameter so that `layout.d.ts`'s `CollapsibleCardOptions` stays what a layout sees.
- `addCollapsible` in `chat-kit.ts` takes `place = expanders.length` before the push, and passes `() => deps.expanderClicked(current.id, place)`.
- `place` is the creation-order place that `openStates` and `restore` already use, so it holds across a redraw.
- `Expanders.toggle(place)` calls `setOpen(!isOpen())` on that expander and returns `'expanded'` or `'collapsed'`, or `'nothing'` when no expander holds that place.
- `EntryList.toggleExpander` returns `'nothing'` for an entry with no slot.

**Section head.** `sectionHead` keeps its `mousedown` guard, `tabIndex = -1` and `type = 'button'`. Only its `toggle` callback changes: it calls `deps.toggleClicked(frame.part.id)`.

- `SideSections.toggleSection(partId)` owns the lookup. It finds the part in `deps.parts.parts()`. A gone part logs `no section <id>` and changes nothing.
- A found part goes to `toggleCollapsed(part)`. That function stays where it is, in the scope of `createSideSections`. It already reaches `uiState`, the log and every open tab.
- The log line `section <title> collapsed|expanded` stays in `toggleCollapsed`.

**Sites re-checked, no change.** These already run commands: `composer-kit.ts:497` Send, `:561` and `:575` chips, `dialog-kits.ts:64` dialog actions, `sign-in-dialog.ts:76` Copy. Picker row clicks go through `src/shared/page/list-picker.ts`, which this task does not touch.

**No key.** `src/plugins/keymap.ts` and `docs/keymap.md` do not change.

## Behaviour

GIVEN a pending permission and an open range WHEN the user clicks Allow once THEN that entry is allowed and nothing is copied.

GIVEN two pending permissions WHEN the user clicks Deny on the newer THEN the reason box opens for the newer. The `denyPermission` key still opens it for the oldest.

GIVEN a user entry with three images WHEN the user clicks the second thumbnail THEN the viewer opens on that entry's images at index 1.

GIVEN a run with its cursor on a step WHEN the user clicks the run's line THEN the run closes and the cursor is on the line.

GIVEN a text selection in the list WHEN the user clicks a block THEN the cursor stays and no `chat.moveFocus` runs.

GIVEN a section in two tabs WHEN the user clicks its head in one THEN it collapses in both and the focus stays where it was.

GIVEN an entry with two expanders WHEN the user clicks the second head THEN only the second opens, and a layout reload keeps it open.

GIVEN Settings WHEN the user opens the keymap section THEN no row names a command of this task.

GIVEN a click whose command run throws WHEN the click lands THEN the log reads `command <id> failed: <error text>` and the page keeps working.

Runtime checks that a test cannot settle collect in [Final verification](11-final-verification.md).

## Tests

- `chat-commands.test.ts`, new `allowEntry_RangeOpen_AllowsThatEntryAndCopiesNothing`. Break: `allowEntry` routes through `allowOrCopy`, so a click copies.
- `chat-commands.test.ts`, new `clickCommand_ArgNamesAnotherSession_ActsOnThatSession`, a table over `allowEntry`, `denyEntry`, `removeImageAt`, `pullBackMessage`, `openImage`, `moveFocus`. Break: a handler reads the visible tab through `inSession`.
- `chat-commands.test.ts`, new `denyEntry_NewerOfTwoPending_OpensTheReasonBoxForIt`. Break: the handler picks `oldestPendingPermission`.
- `chat-commands.test.ts`, new `clickCommand_TargetGone_LogsAndActsOnNothing`, a table: unknown session, answered permission, entry not `permission`, entry not `user`, no image at the index. Break: a stale arg throws, or answers an entry already answered.
- `chat-commands.test.ts`, new `openImage_UserEntry_OpensItsImagesAtTheIndex`. Break: the handler opens at 0, as `toggleEntry` does.
- `chat-commands.test.ts`, new `clickCommands_Manifest_DeclareTheirArgAndNoBind`, a table of the nine commands, built with a helper `row<A>(key: CommandKey<A>, shape, valid: A, invalid: unknown)`. Each row asserts three things: `chatManifest.commands[short].arg` equals the shape in Produces, `checkCommandArg` passes `valid` and refuses `invalid`, and no bind in `defaultKeymap` names the id. Break: a missing `arg` adds an unbound row to Settings, or a shape that differs from the key's type throws on the first real click.
- `chat-kit.test.ts`, new `images_ThumbnailClick_PassesEntryIdAndIndex`. Break: the click passes a wrong index in the map.
- `chat-kit.test.ts`, new `collapsibleRow_HeadClick_RunsExpanderClickedAndOpensNothing`. Break: the head toggles itself as well, so one click toggles twice once the command lands.
- `chat-kit.test.ts`, row added to `collapsibleRow_RegistersWithExpanders`: `toggle(place)` opens that expander, and a place no expander holds gives `'nothing'`.
- `entry-list.test.ts`: the fake deps wire `runClicked`, `stopClicked` and `expanderClicked` back to the list, so the existing activity click test (line 572 at plan time), the pending row test (line 798) and the `click ($case)` table (line 2152) keep their assertions and pin the guards.
- `entry-list.test.ts`, new `moveFocusTo_StopNotInOrder_LeavesTheFocus`. Break: the `order` check goes with the listener's rewrite, and a click on padding moves the cursor.
- `entry-list.test.ts`, new `toggleExpander_EntryWithNoSlot_GivesNothing`. Break: the non-null slot read that `toggleFocused` uses throws on a stale arg.
- `side-sections.test.ts`: the fake deps wire `toggleClicked` to `toggleSection`, so `a head's click collapses the section in both tabs…` (line 193) keeps its assertions. New row: a part id no section holds logs `no section <id>`.
- `side-sections.test.ts`, the new row also asserts that a part id no section holds leaves `collapsed-sections` as it was. Break: the handler toggles a part it did not find.
- `chat-view.test.ts`, new `clickSites_RunTheirCommandWithTheirArg`, a table over the eight sites `chat-view.ts` wires, each with its key and arg recorded by a fake `runKey`. Break: a site is wired to the private function again.
  - The test captures deps and clicks no DOM. `vi.mock` of `./entry-list` and `./composer-kit`, through `importOriginal`, records what `createEntryList` and `createComposerSurface` receive, then calls the real function. `chat-kit.test.ts` and `entry-list.test.ts` own the clicks.
  - Rows call these captured members: Allow once `kit.allow`, Deny `kit.deny`, thumbnail `kit.openImages`, expander head `kit.expanderClicked`, activity line `runClicked`, list click `stopClicked`, pending row `pullBack`, image remove `removeImage` on `createComposerSurface`'s second argument.
- `start.test.ts`, new `sectionHead_Click_RunsToggleSectionAndCollapsesThePart`. It opens a tab on the part harness, with the `sessions` fake keeping the tab's element, and clicks a section head through the real `commands.run`. It asserts `section <title> collapsed` in the harness logs. Break: `toggleClicked` or the `toggleSection` handler is wired wrong, or the arg fails the declared shape. `side-sections.test.ts` wires its fake straight to `toggleSection`, so it cannot catch this.

The existing `allowOrCopy`, `denyPermission`, `toggleEntry` and `removeImage` tests stay unchanged. They pin what a key does.

## Done when

- The project compiles and `chat` passes its tests at the test gate.
- `grep -n "allowEntry\|denyEntry\|removeImageAt\|toggleRun\|toggleExpander\|pullBackMessage\|toggleSection\|openImage\|moveFocus" src/plugins/keymap.ts` prints nothing.
- In `src/plugins/chat/page/entry-list.ts`, `chat-kit.ts` and `side-sections.ts`, every `addEventListener('click'` calls a callback that `chat-view.ts` or `start.ts` wires to `runKey`.

The `chat` filtered self-test is the gate's. Its `expect` lines do not move, since no log line changes on a key path.

## Commit

One commit: `Chat: every click runs a command, with an arg naming what was clicked`.

## Proof

