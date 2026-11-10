# 10 — Primer, backlog and practice keep their boxes

Status: not started
Type: Batch
Wave: 4 · Depends on: 06, 08, 09
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/primer/page/layout/primer-kit.ts` · modify `src/plugins/primer/page/primer-view.ts` ·
           modify `src/plugins/backlog/page/followup-editor.ts` · modify `src/plugins/backlog/page/backlog-view.ts` ·
           modify `src/plugins/practice/page/problem-workspace.ts` ·
           modify `docs/features/followups.md` · modify `docs/features/intent-alignment/master-plan.md` ·
           test `src/plugins/primer/page/primer-view.test.ts` · test `src/plugins/backlog/page/backlog-view.test.ts` ·
           test `src/plugins/practice/page/start.test.ts`

Consumes:  `EditorBoxes.place(parent: HTMLElement, box: Box, text: string): HTMLElement` ← 06 ·
           `EditorBoxes.release(box: Box): void` ← 06 · `EditorBoxes.setText(box: Box, text: string): void` ← 06 ·
           `keepFocusedBox` (it now sweeps with `destroyReleased` and refocuses with `{ insert: true }`) ← 06 ·
           `destroyBox` as a no-op for a key no editor holds ← 06

Produces:  in `src/plugins/backlog/page/followup-editor.ts`, on `interface FollowupEditor`:
           `place(field: EditorField, parent: HTMLElement, text: string): HTMLElement` (replaces `mount`)
           `release(field: EditorField): void`

Tasks 08 and 09 edited `primer-view.ts`, `primer-kit.ts` and `backlog-view.ts` before this task: line numbers
below are from plan time. Find each member by name.

## Shared rule (task 06)

Each owner's text box goes through `place`: the frame comes from editor boxes, the owner adds its classes to it,
and the draw's rollback records `release`, not `destroyBox`. An owner disposes a box's old draw before the new
draw places it again. Each owner keeps its `keepFocusedBox` call around a redraw: after task 06 it ends the boxes
the redraw left out (`destroyReleased`) and focuses the kept box again with no cursor move. The brief named
dropping `keepFocusedBox`; it stays, because the refocus and the sweep must run after the whole draw.

## Primer

- `PrimerPartKitDeps.boxes` becomes `Pick<EditorBoxes<PrimerBox>, 'place' | 'release'>`.
- `appendField` (~L416) now: makes `inputFrame()`, mounts into it, records `destroyBox`. After, in this order: build
  `field` with its section header, `parent.append(field)`, call `deps.boxes.place(field, primerBox, boxText(primer,
  box.target))` (it appends the frame after the header), add `primer-box` to the frame, append the `boxHint` keys
  after it, and record `rollback.recordBox(() => deps.boxes.release(primerBox))`. The field is attached before the
  editor is created, as today (`primer-view.ts`: "Editors mount into attached elements, so they can measure
  themselves"). The DOM order in the field is unchanged: header, frame, keys.
- The add-item box's text: `place` replaces a kept editor's text with the text it is given when they differ (task
  06), so after `addItem` clears `newItemTexts[entryId]` the next card draw shows `''`, as today. No primer-side
  rule is added.
- `primer-view.ts` `rebuildCard` (~L631) keeps its `keepFocusedBox` call; `card.dispose()` now releases the card's
  boxes, and the sweep ends a box the new card leaves out (the add-item box once its task holds 20 items).
- `destroyPrimerView`'s `destroyForm` and `forgetForm` stay.
- The doc comment of `createPrimerFormView` (~L565: "its boxes destroyed and mounted again") says after: the
  card's boxes move into the new card, and a box the new card leaves out is destroyed.

## Backlog

- `FollowupEditor.mount(field, frame, text)` becomes `place(field, parent, text)`: it calls
  `boxes.place(parent, field, text)`, keeps the returned frame in `frames` (the frame is now the same element for
  the box's life, so the `fieldHint` move on `activated` is unchanged), and returns it. New `release(field)` calls
  `boxes.release(field)`. `isMounted` reads "placed". `destroy()` and `forget()` stay.
- `FollowupEditor.setText(field, text)` now destroys and remounts the box in its frame. After: it calls
  `boxes.setText(field, text)`: no `changed`, focus and vim mode kept, the replace joins undo. Its doc comment and
  the interface comment ("`setText` replaces one box's text, reporting no change") say so; the comment on
  `FollowupEditor` ("mounted into the frames the editor pane places; it builds no DOM") says after: editor boxes
  make each box's frame, and the editor pane places it.
- `backlog-view.ts` `textBoxFor` (~L517): replace `appended(parent, inputFrame())` and `followupEditor.mount` with
  `followupEditor.place(field, parent, texts[field])`, add `backlog-editor-box` and `backlog-editor-box--<field>` to
  the frame, and record `rollback.recordBox(() => followupEditor.release(field))`. Drop the `isMounted` guard: a
  release of a released box is a no-op.
- `drawEditorPane` (~L534): remove its `followupEditor.destroy()` call. `closeEditorPane` still destroys and
  forgets, and `syncEditor` draws the pane only while `editorDraw` is null, which follows a close or the first
  open. A `setLayouts` redraw then keeps the boxes: `editorDraw?.dispose()` releases them, the new draw places them
  again, and the left-out loop (`!followupEditor.isMounted(field)`) still finds a box the user layout leaves out.
- `setLayouts` (~L1432) keeps its `keepFocusedBox` call.
- `inputFrame` and `appended` imports go when no other use remains in `backlog-view.ts` (grep first).

## Practice

- `textBoxSlot` (~L492): after, `boxes.place(parent, id, store.get().drafts[id].text)`, add `practice-box` and
  `practice-box--<id>` to the frame, and record `rollback.recordBox(() => boxes.release(id))`.
- **A replaced draft still mounts anew.** `place` would only `setText` a kept editor, which keeps its undo history,
  so a box must not be kept across a new problem or a draft replaced from disk: those start a fresh editor.
  `problem-workspace.ts` keeps `placedFor: Record<BoxId, string | null>` (starts `{ notes: null, customCases: null
  }`): the key the box was last placed for. The key is the file's existing tab key data read through the store's open
  problem (`store.get().problem?.slug`): `JSON.stringify(['notes', slug, boxReplaces.notes])` for `notes` (the
  `notes` case of the tab key function) and `JSON.stringify(['testcase', slug, boxReplaces.customCases])` for
  `customCases` (`consoleTabKey`'s testcase branch). Reuse those two key builders (pull each into a small helper both
  callers use); build no second key. `textBoxSlot` computes that key first; when it differs from `placedFor[id]`, it calls `boxes.destroyBox(id)`
  (a no-op when the sweep already ended the box), then places, then sets `placedFor[id]`. A tab switch, a
  `drawBodies` redraw for the same problem and a `setLayouts` keep the box while it stays shown; a box on a tab that
  is no longer shown is released and the sweep ends it, as its destroy does today.
- `drawBodies` (~L808) and `setLayouts` (~L1247) keep their `keepFocusedBox` calls. `boxReplaces` and
  `drawnProblemKey` stay as they are: they still make the tab draw again on a replace.
- `drawBoxTab`'s left-out check (`!boxes.isMounted(id)`) stays: `disposeDraws` releases before the draw.
- `dispose`'s `boxes.destroyForm(FORM_ID)` stays.

## Bookkeeping (this task's commit)

Tasks 01, 02, 03, 08 and 09 have landed by Wave 4. In `docs/features/followups.md`, remove each whole bullet (from
its `- **` line to the line before the next `- **` or heading): **Toasts through the shell layout**, **Shell
layout swap failure tests**, **Sessions split picker rows through the sessions layout**, **Fixed texts in layout
slots**. In `docs/features/intent-alignment/master-plan.md` § Lane L, change `[ ]` to `[x]` on these three lines:

- `- [ ] Toasts through the shell layout, with Shell layout swap failure tests (the same contract)`
- `- [ ] Fixed texts in layout slots`
- `- [ ] Sessions split picker rows through the sessions layout`

## Behaviour

GIVEN the primer's task card with its comment box focused in visual mode WHEN `setLayouts` picks a new card layout
THEN the new card holds the same editor in the same frame, and that editor gets one `focus()` with no option

GIVEN a task with 19 items and the add-item box holding text WHEN the 20th item lands THEN the add-item box's
editor is destroyed (the new card leaves it out)

GIVEN the backlog editor open with the title box focused in insert mode WHEN `setLayouts` runs THEN the title box
is the same editor and its last focus option is `{ insert: true }`; a box the user layout leaves out is appended

GIVEN the backlog editor open WHEN the tags picker sets the tags THEN the tags box's editor gets `setText` with the
joined tags, and no editor is created or destroyed

GIVEN practice's notes tab shown with the notes box focused WHEN `setLayouts` runs THEN the notes box is the same
editor and it holds focus

GIVEN practice's notes tab shown WHEN `refreshed` replaces the notes draft from disk THEN the old notes editor is
destroyed and a new one mounts with the new text

GIVEN practice's notes tab shown WHEN the user opens another problem and the notes tab stays shown THEN the old
notes editor is destroyed and a new one mounts with the new problem's notes

GIVEN a primer task card whose add-item box shows typed text WHEN `addItem` lands the item and clears the text THEN
the add-item box shows `''` and its editor is the same one

## Tests

- `primer-view.test.ts`: `rebuilds the shown card on setLayouts with a new pick and keeps the focused box` also
  expects the host created no editor during `setLayouts` and the focused editor got `focus` with no option.
  `falls back to default when a user card throws after mounting a box, mounting each box once` also expects one
  editor for `taskComment1` (the failed attempt's editor is kept by the fallback, not made twice), not destroyed.
  `leaves the card once the 20th item lands, focusing the task comment box on nextBox` stays as is (its
  `isMounted(newItem1)` false holds through the sweep).
- `backlog-view.test.ts`: `a layout reload keeps the open editor draft and focused box` changes: `remounted` is
  `title` (the same editor), and its last focus option is `{ insert: true }`. New
  `tagsPicker_EditorOpen_SetsTheTagsBoxText` — the tags box's editor records one `setText` with the joined tags,
  and the live editor count for `tags` stays 1. `a box the editor pane leaves out is appended` and
  `followupEditor_DropAfterRedraw_GoesToTheBoxUsedLast` stay as they are.
- `start.test.ts` (practice): new `layoutChange_FocusedNotesBox_KeepsItsEditor` — the notes editor before and after
  `setLayouts` is the same, and it is the active box. New `refreshedDraft_ShownNotesBox_MountsANewEditor` — after
  a `refreshed` with a new notes text, the earlier notes editor is destroyed and the live one was created with the
  new text. New `problemChange_ShownNotesBox_MountsANewEditor` — the same box key with a new slug: the earlier
  notes editor is destroyed and the live one was created with the new problem's notes.
- `primer-view.test.ts`: new `addItem_AddItemBoxHeldEditor_ShowsTheClearedText` — after the item lands and the card
  redraws with the same card key, the add-item editor is the same one and its `text()` is `''`.

Live check: task 15 (the primer, backlog and practice boxes keep the cursor, a visual mode and undo across a layout
save).

Done when: `npm run lint` and the typecheck pass; the test gate runs `primer-view.test.ts`, `backlog-view.test.ts`,
`followup-editor` tests if any exist (none at plan time), and `src/plugins/practice/page/start.test.ts`.

Commit: one commit for the group — the eight source and test paths in Files, `docs/features/followups.md`,
`docs/features/intent-alignment/master-plan.md`.

## Proof
