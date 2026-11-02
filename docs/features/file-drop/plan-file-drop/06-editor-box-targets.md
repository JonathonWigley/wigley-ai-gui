# 06 — Editor-box pane targets: Forms, Primer, Backlog

Status: not started
Type: Task
Wave: 4 · Depends on: 01, 03, 04
Plan: [plan.md](plan.md)

Files:     modify `src/shared/page/editor-boxes.ts` · test `src/shared/page/editor-boxes.test.ts` ·
           modify `src/plugins/forms/page/forms-view.ts` · modify `src/plugins/forms/page/start.ts` ·
           modify `src/plugins/primer/page/primer-view.ts` · modify `src/plugins/primer/page/start.ts` ·
           modify `src/plugins/backlog/page/followup-editor.ts` · modify `src/plugins/backlog/page/backlog-view.ts` ·
           modify `src/plugins/backlog/page/start.ts` · test fakes in `src/plugins/forms/page/forms-view.test.ts`,
           `src/plugins/primer/page/primer-view.test.ts`, `src/plugins/backlog/page/backlog-view.test.ts` (new deps, and one registration test each)
Consumes:  `DroppedFile`, `DropTarget`, `PageDrops` (`api.drops.addTarget`, `api.drops.savePasted`) ← 01/04 ·
           `export const NOTHING_TAKES_FILES = 'Nothing here takes files';` (`src/contracts/drops.ts`) ← 01 ·
           `TextEditor.insert(text)` ← 03 · `TextEditor.charBeforeCursor()` ← 03 ·
           `insertionText(filePaths, charBefore)` ← 02
Produces:  in `src/shared/page/editor-boxes.ts`:
           `EditorBoxes<Box>.fileEditor(formId: string, isShown: (box: Box) => boolean): TextEditor | null` — the
             editor of form `formId`'s box focused last while it is still mounted and shown, else of the form's
             shown box mounted first; null when the form shows none
           `EditorBoxes<Box>.forgetForm(formId: string): void` — drops the form's last-used and first-mount records
           `export interface BoxDropDeps { savePasted(file: DroppedFile): Promise<string>;
             toast(text: string, tone: ToastTone): void; log: Log; logSource: string }`
           `export function boxDropTake(editorFor: () => TextEditor | null, deps: BoxDropDeps): DropTarget['take']`
           `FormsViewDeps`, `PrimerViewDeps`, `FollowupEditorDeps`, `BacklogViewDeps` each gain
             `drops: Pick<PageDrops, 'addTarget' | 'savePasted'>`; `FormsViewDeps`, `PrimerViewDeps` and `FollowupEditorDeps`
             also gain `toast(text: string, tone: ToastTone): void` (`BacklogViewDeps` already holds one)
Decisions:
- editor-boxes returns a `take` the caller registers; it takes no `PageDrops`. One `EditorBoxes` spans every form of
  a plugin and builds no DOM, while the element and its lifetime (a round view, a primer view, the backlog editor
  slot) belong to each caller; a returned `take` leaves registration and disposal with the code that owns the
  element, and editor-boxes needs only `savePasted` from drops (plan File Structure's `PageDrops`, Decided).
- "Box last used" is the box last activated (focus from a command or a click), per form, kept by key, so it outlives
  `keepFocusedBox`'s rebuild and backlog's `setText` remount. "First" is the lowest first-mount order: each key gets
  an order number the first time it mounts and keeps it across remounts, so a form's first box stays the one it drew
  first (the top of the form, `title` in backlog) whatever was remounted since. "First" is the lowest order among
  the form's mounted keys that `isShown` passes. Both records survive `destroyBox` and `destroyForm` (a rebuild runs
  them); only `forgetForm` clears them.
- **Shown boxes only**: Forms and Primer mount every item's card up front and hide the cards not in focus, so a
  mounted box may be one the user cannot see. `fileEditor` skips a last-used box `isShown` rejects, and falls back
  to the first shown box. Forms passes `(box) => isBoxShown(store.get(), box)` (`forms/page/boxes.ts`), Primer its
  own `isBoxShown` over its state, and Backlog `() => true` (its one editor is shown while the slot is).
- **Release**: `destroyRoundView`, `destroyPrimerView` and the follow-up editor's `destroy` call
  `boxes.forgetForm(formId)`, so a closed round's records do not outlive it.
- `boxDropTake(editorFor, deps)(files)`: reads `editorFor()` first; null → toast `NOTHING_TAKES_FILES`, tone
  `info`, and log, saving nothing. Otherwise each file in order gives its `path`, or `await deps.savePasted(file)`
  when it is `''`; a save rejection toasts `<name> not saved: <error>`, tone `error`, and leaves the rest. Then
  `editorFor()` again (a save may outlast the box): an editor → one
  `editor.insert(insertionText(paths, editor.charBeforeCursor()))`; none → log the dropped paths and toast nothing.
  Log only is intended: a box gone in the moment a save takes means the user closed it, and the saved files stay
  under `pasted/` where the log names them. No insert when no path gathered. Every file is a chip here, images included (design § What a file becomes).
- Targets, each registered through `deps.drops.addTarget` with `take: boxDropTake(() => boxes.fileEditor(id, isShown), …)`:
  - Forms: each round view's `element`, registered in `syncRoundViews` when its view is made and disposed in
    `destroyRoundView` before the element is removed; `id` the round's `formId`. The idle state outside any round
    view is no target, so a drop there gets the core's `Nothing here takes files`.
  - Primer: each primer view's `element`, the same way in `syncPrimerViews` and `destroyPrimerView`; `id` the
    primer's `formId`.
  - Backlog: `deps.element` (the `div.backlog-editor` slot), registered once in `createFollowupEditor`; `id`
    `FOLLOWUP_FORM_ID`. The slot lives as long as the page, so its `Disposable` is kept and never disposed, as the
    view's anchors are; the slot is hidden while no editor is open, so it takes no drop then.
- Each `start.ts` passes `drops: api.drops` and, where the view lacked it, `toast: services.toast`; `backlog-view.ts`
  passes `drops` and `toast` through to `createFollowupEditor`.
GIVEN a Form tab whose round's second box was focused last and then left WHEN a file is dropped anywhere on the round
  view THEN its path goes into the second box, focus and vim mode unchanged
GIVEN a Primer tab where no box was ever focused WHEN a file is dropped THEN it goes into the primer's first shown box
GIVEN a Form tab on item 3 whose last-used box is item 1's, now hidden WHEN a file is dropped THEN it goes into the
  first shown box, not the hidden one
GIVEN a round view with no text box WHEN a file is dropped on it THEN the toast `Nothing here takes files` shows and a
  pasted file is not saved
GIVEN the backlog follow-up editor is open WHEN a screenshot is pasted with no box focused THEN it is saved under
  `pasted/` and its path goes into the box last used
GIVEN a round closes WHEN its view is destroyed THEN its drop target is disposed
Tests:     in `editor-boxes.test.ts`, reusing the `insert` and `charBeforeCursor` task 03 gave its `fakeHost`
           editors (no second fake): this task makes that `insert` record its calls and that `charBeforeCursor`
           answer `'x'`. Asserts against `NOTHING_TAKES_FILES`, not a literal.
           `fileEditor_PicksLastUsedElseFirst` — mounts `notes`, `reason` (form `f1`) and `other` (form `f2`) as
           `setup()` does; `isShown` passes every box unless the row hides one; asserts which created editor
           `fileEditor('f1', isShown)` returns:
           | steps | `fileEditor('f1', isShown)` |
           |---|---|
           | none | `notes`'s editor |
           | focus `reason`, then `leave()` | `reason`'s editor |
           | focus `reason`, `destroyBox(reason)` | `notes`'s editor |
           | focus `reason`, `destroyForm('f1')`, mount `reason` then `notes` again | the new `reason` editor |
           | `destroyBox(notes)`, mount `notes` again | the new `notes` editor (first-mount order kept) |
           | nothing focused, `destroyForm('f1')`, mount `reason` then `notes` again | the new `notes` editor (order survives `destroyForm`) |
           | focus `reason`, `destroyForm('f1')`, `forgetForm('f1')`, mount `reason` then `notes` again | the new `reason` editor (order and last-used reset) |
           | focus `reason`, `leave()`, `reason` hidden | `notes`'s editor |
           | nothing focused, `notes` hidden | `reason`'s editor |
           | `notes` and `reason` hidden | null |
           | focus `other` | `notes`'s editor |
           | `destroyForm('f1')` | null |
           `boxDropTake_TakesFilesIntoTheBox` — fake `savePasted` answering `/app/pasted/20261102-090000-1.png`, or
           rejecting `disk full` for a file named `bad.png`; asserts the insert calls and the toasts:
           | editor | files | inserts | toasts |
           |---|---|---|---|
           | null | `/d/a.md` | none | `[[NOTHING_TAKES_FILES, 'info']]` and `savePasted` never called |
           | fake | `/d/a.md`, `/d/My File.mp4` | `[insertionText(['/d/a.md', '/d/My File.mp4'], 'x')]` | none |
           | fake | `image.png` with path `''` | `[insertionText(['/app/pasted/20261102-090000-1.png'], 'x')]` | none |
           | fake | `bad.png` path `''`, `/d/a.md` | `[insertionText(['/d/a.md'], 'x')]` | `[['bad.png not saved: disk full', 'error']]` |
           | fake | `bad.png` path `''` | none | `[['bad.png not saved: disk full', 'error']]` |
           `forms-view.test.ts`: `roundView_DropTarget_FollowsTheRound` — a fake `drops` recording each `addTarget`
           (its target, so the test can call the registered `take`) and each `Disposable`'s dispose; a round shown
           registers one target whose `element` is the round view's root; calling its `take` with a file of path
           `/d/a.md` puts `insertionText(['/d/a.md'], <the editor's charBeforeCursor>)` into the box editor of that
           round's form (recorded by the test's fake host), not another form's; the round closing disposes it.
           `primer-view.test.ts`: `primerView_DropTarget_FollowsThePrimer` — the same for a primer.
           `backlog-view.test.ts`: `followupEditor_DropTarget_OnTheSlot` — `addTarget` is called once, with the
           `div.backlog-editor` slot as `element`.
Done when: compiles (`npm run typecheck`); the test gate runs the tests above
Commit:    one commit for the group

Live checks deferred to "10 — Final verification": its check 1 (a pasted PNG in a focused Form box in normal mode)
and check 4 (a drop on the right pane lands in its box).

## Proof

<written by wigley:make: commit sha, proof result, concerns; empty until the group lands>
