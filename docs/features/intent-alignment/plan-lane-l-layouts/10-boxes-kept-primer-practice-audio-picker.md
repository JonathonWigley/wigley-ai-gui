# 10 — Primer, practice and the audio picker keep their boxes

Status: done
Type: Batch
Wave: 4 · Depends on: 06, 08, 09
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/primer/page/layout/primer-kit.ts` · modify `src/plugins/primer/page/primer-view.ts` ·
           modify `src/plugins/practice/page/problem-workspace.ts` ·
           modify `src/plugins/audio-picker/page/layout/picker-kit.ts` ·
           modify `src/plugins/audio-picker/page/picker-view.ts` ·
           modify `src/plugins/audio-picker/layouts/layout.d.ts` ·
           modify `docs/features/followups.md` · modify `docs/features/intent-alignment/master-plan.md` ·
           test `src/plugins/primer/page/primer-view.test.ts` · test `src/plugins/practice/page/start.test.ts` ·
           test `src/plugins/audio-picker/page/layout/picker-kit.test.ts` ·
           test `src/plugins/audio-picker/page/picker-view.test.ts`

Consumes:  `EditorBoxes.place(parent: HTMLElement, box: Box, text: string): HTMLElement` ← 06 ·
           `EditorBoxes.release(box: Box): void` ← 06 ·
           `keepFocusedBox` (it now sweeps with `destroyReleased` and refocuses with `{ insert: true }`) ← 06 ·
           `destroyBox` as a no-op for a key no editor holds ← 06

Produces:  no new member; each owner's boxes move from `mount` to `place`, so task 13 can delete `mount`.

Tasks 07, 08 and 09 edited `primer-view.ts`, `primer-kit.ts`, `problem-workspace.ts`, `picker-view.ts` and the audio
picker's `layout.d.ts` before this task: line numbers below are from plan time (2026-11-16 for the audio picker).
Find each member by name.

## Shared rule (task 06)

Each owner's text box goes through `place`: the frame comes from editor boxes, the owner adds its classes to it,
and the draw's rollback records `release`, not `destroyBox`. An owner disposes a box's old draw before the new
draw places it again. Each owner keeps its `keepFocusedBox` call around a redraw: after task 06 it ends the boxes
the redraw left out (`destroyReleased`) and focuses the kept box again with no cursor move. The brief named
dropping `keepFocusedBox`; it stays, because the refocus and the sweep must run after the whole draw.

## Primer

- `PrimerPartKitDeps.boxes` becomes `Pick<EditorBoxes<PrimerBox>, 'place' | 'release'>`.
- `appendField` (~L435) now: makes `inputFrame()`, mounts into it, records `destroyBox`. After, in this order: build
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
- The doc comment of `createPrimerFormView` (~L564: "its boxes destroyed and mounted again") says after: the
  card's boxes move into the new card, and a box the new card leaves out is destroyed.

## Practice

- `textBoxSlot` (~L524): after, `boxes.place(parent, id, store.get().drafts[id].text)`, add `practice-box` and
  `practice-box--<id>` to the frame, and record `rollback.recordBox(() => boxes.release(id))`.
- **A replaced draft still mounts anew.** `place` would only set a kept editor's text, which keeps its undo history,
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
- `drawBodies` (~L833) and `setLayouts` (~L1280) keep their `keepFocusedBox` calls. `boxReplaces` and
  `drawnProblemKey` stay as they are: they still make the tab draw again on a replace.
- `drawBoxTab`'s left-out check (`!boxes.isMounted(id)`) stays: `disposeDraws` releases before the draw.
- `dispose`'s `boxes.destroyForm(FORM_ID)` stays.

## Audio picker

- `PickerPartKitDeps.boxes` (`picker-kit.ts` ~L49) becomes `Pick<EditorBoxes<PickerBox>, 'place' | 'release'>`;
  `picker-view.ts` still passes `deps.boxes` (~L407).
- `appendNotesField` (~L145) now: makes `inputFrame()` with `audio-picker-notes-box`, appends it and the `box-keys`
  `boxHint` to the field, appends the field to `parent`, mounts into the frame, records `destroyBox`. After, in this
  order: build `field`, `parent.append(field)`, call `deps.boxes.place(field, box, text)` (it appends the frame to
  the field), add `audio-picker-notes-box` to the frame, append the `boxHint` after it, and record
  `rollback.recordBox(() => deps.boxes.release(box))`. The DOM order in the field is unchanged: frame, keys. The
  `inputFrame` import goes when no other use remains in `picker-kit.ts` (grep first).
- `createNotesKit`'s `isMounted` flag and `appendUnmountedBox` stay: they guard one `textBox` call per draw, and a
  part that leaves the box out still gets it at its end.
- `picker-view.ts`'s stale-part redraw (~L418–432) keeps its `keepFocusedBox(deps.boxes, formId, redraw)` call around
  a redraw that holds a `notes` part. Redrawing a `notes` part disposes its old draw first (its box is released), the
  new draw places the same box again, and the sweep ends a box no new draw placed. The picker's close keeps its
  `boxes.destroyForm(formId)` and `boxes.forgetForm(formId)` (~L257).
- The notes text comes from the picker's draft, which the box itself writes; `place` sets a held editor's text only
  when the draft's text differs, so a redraw touches no text the user is typing.
- `layouts/layout.d.ts`: the header line "A `notes` part drawn again keeps its box's text, and its focus while the
  box had it." says after: "A `notes` part drawn again keeps its box, with its text, cursor, vim mode and undo, and
  its focus while the box had it." `NotesKit.textBox`'s comment says "places" for "mounts".

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

GIVEN practice's notes tab shown with the notes box focused WHEN `setLayouts` runs THEN the notes box is the same
editor and it holds focus

GIVEN practice's notes tab shown WHEN `refreshed` replaces the notes draft from disk THEN the old notes editor is
destroyed and a new one mounts with the new text

GIVEN practice's notes tab shown WHEN the user opens another problem and the notes tab stays shown THEN the old
notes editor is destroyed and a new one mounts with the new problem's notes

GIVEN a primer task card whose add-item box shows typed text WHEN `addItem` lands the item and clears the text THEN
the add-item box shows `''` and its editor is the same one

GIVEN an open audio picker with moment 1's notes box focused in insert mode WHEN `setLayouts` picks a new `notes`
layout THEN the notes box is the same editor in the same frame, it gets one `focus({ insert: true })`, and the host
created no editor

GIVEN an open audio picker WHEN `setLayouts` picks a new `candidate` layout only THEN no notes box is released or
placed again (the stale-part redraw leaves the `notes` parts alone)

## Tests

- `primer-view.test.ts`: `rebuilds the shown card on setLayouts with a new pick and keeps the focused box` also
  expects the host created no editor during `setLayouts` and the focused editor got `focus` with no option.
  `falls back to default when a user card throws after mounting a box, mounting each box once` also expects one
  editor for `taskComment1` (the failed attempt's editor is kept by the fallback, not made twice), not destroyed.
  `leaves the card once the 20th item lands, focusing the task comment box on nextBox` stays as is (its
  `isMounted(newItem1)` false holds through the sweep).
- `start.test.ts` (practice): new `layoutChange_FocusedNotesBox_KeepsItsEditor` — the notes editor before and after
  `setLayouts` is the same, and it is the active box. New `refreshedDraft_ShownNotesBox_MountsANewEditor` — after
  a `refreshed` with a new notes text, the earlier notes editor is destroyed and the live one was created with the
  new text. New `problemChange_ShownNotesBox_MountsANewEditor` — the same box key with a new slug: the earlier
  notes editor is destroyed and the live one was created with the new problem's notes.
- `primer-view.test.ts`: new `addItem_AddItemBoxHeldEditor_ShowsTheClearedText` — after the item lands and the card
  redraws with the same card key, the add-item editor is the same one and its `text()` is `''`.
- `picker-kit.test.ts`: the `fakeDeps` boxes fake moves from `mount`/`destroyBox` to `place` (returning a fresh
  `div` it records with its parent, box and text) and `release`. `createNotesKit_TextBox_MountsTheMomentsBoxOnce`
  asserts one `place` with the field, the box and `'softer'`, the frame carrying `audio-picker-notes-box` followed by
  the `box-keys` hint inside the field, and a rollback that calls `release` with the box;
  `createNotesKit_NoTextBoxCall_AppendUnmountedBoxMountsAtThePartsEnd` asserts the same through `place`.
- `picker-view.test.ts`: `mountPickerPopups_NotesRedraw_KeepsTheFocusedBox` also expects the host created no editor
  during the redraw and the focused editor's last focus option is `{ insert: true }` (the fake editor in insert
  mode). New `mountPickerPopups_CandidateOnlyRedraw_LeavesTheNotesBoxesPlaced` — the second audio picker GIVEN: no
  editor is destroyed or created, and each notes frame keeps its parent.

Live check: task 15 (the primer, practice and audio picker boxes keep the cursor, a visual mode and undo across a
layout save).

Done when: `npm run lint` and the typecheck pass; the test gate runs `primer-view.test.ts`,
`src/plugins/practice/page/start.test.ts`, `picker-kit.test.ts` and `picker-view.test.ts`.

Commit: one commit for the group — the ten source and test paths in Files, `docs/features/followups.md`,
`docs/features/intent-alignment/master-plan.md`.

## Proof

Commit ca910ef9e · proof: Diff read: primer appendField and audio-picker appendNotesField place/release through EditorBoxes (Pick 'place'|'release'); practice textBoxSlot places with placedFor/boxTabKey, destroying on a changed key. Wave 4 typecheck clean; lint clean after oxfmt (ff9075cae). Tests written in primer-view, picker-kit, picker-view, practice start tests; run at the test gate. · concerns: Practice problem-change test drives customCases (opening a problem resets the problem tab to Description, so Notes cannot stay shown); primer and practice layout.d.ts still say 'mounts' (lines 65/189, 29) outside Files, for task 14's doc pass; after addItem the add-item box shows '' only on the next card redraw (card key unchanged), as before — check in task 15 live run; followups hot-reload item rewritten (text's start; fix now names place/release).
