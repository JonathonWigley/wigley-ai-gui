# 06 — Editor boxes kept across a redraw

Status: in progress
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     modify `src/shared/page/editor-boxes.ts` · test `src/shared/page/editor-boxes.test.ts`

Consumes:  `inputFrame(): HTMLElement` in `src/shared/page/ui/input-frame.ts` (in the tree) ·
           `TextEditor.setText(text: string): void` in `src/contracts/editor.ts` (in the tree) ·
           `FocusOptions.insert` in `src/contracts/editor.ts` (in the tree)

Produces:  in `src/shared/page/editor-boxes.ts`, on `interface EditorBoxes<Box>`:
           `place(parent: HTMLElement, box: Box, text: string): HTMLElement`
           `release(box: Box): void`
           `destroyReleased(formId: string): void`
           and the changed `keepFocusedBox<Box>(boxes: Pick<EditorBoxes<Box>, 'active' | 'activeMode' | 'focus' | 'isMounted' | 'formIdOf' | 'destroyReleased'>, formId: string, rebuild: () => void): void`

## What a box is after this task

A box placed through `place` has one **frame**: a `div.ui-input` that editor boxes make with `inputFrame()` the
first time and keep until the box is destroyed. The editor's DOM lives in that frame for the box's whole life. A
draw moves the frame; it never makes a second frame or a second editor for the same key.

A placed box is in one of two states:

- **placed** — its frame sits in the parent the last `place` gave.
- **released** — its frame is detached (`frame.remove()`); the editor lives on with its text, cursor, vim mode
  and undo.

`destroyBox`, `destroyForm` and `destroyReleased` end the editor (`editor.destroy()`) and remove the frame from its
parent. Only these end a box. `destroyBox` of a key no editor holds is a no-op after this task (today it throws
`No box is mounted as <key>`): an owner that ends a box before it places it again (practice, task 10) cannot know
whether the sweep already ended it. No test asserts the old throw (checked at plan time).

## Decisions

- **`place(parent, box, text)`.** With no editor for the box's key: make the frame with `inputFrame()`, append it to
  `parent`, create the editor in the frame through `host.create(frame, text, events)` with the same events `mount`
  wires today, record the first mount as `mount` does (`firstMounts`, `mountCount`), and return the frame. With an
  editor already held (placed or released): append the same frame to `parent` (a DOM move), mark the box placed,
  and return the frame. When `text` differs from the held editor's `text()`, `place` calls the editor's
  `setText(text)` (no `changed`; the replace joins undo), so an owner whose state holds a different text for the key
  (the primer's add-item box after `addItem` cleared it) shows the owner's text; equal text touches nothing, so the
  cursor and undo stay. Practice keeps its own `placedFor` rule instead of relying on this (task 10): a new problem
  or a draft replaced from disk must start a fresh editor with a fresh undo history. A second `place` with no
  `release` between also moves the frame and does not throw; each kit already refuses a box placed twice in one
  draw (forms' `card.mounted`, the primer's card `mounted` set, forms' `isNoteMounted`).
- **The frame's classes.** `place` adds only `ui-input`. The owner adds its own classes to the frame `place`
  returns (`primer-box`, `practice-box`, `audio-picker-notes-box`, forms' `box`), on every call; `classList.add`
  repeats safely. The owner appends nothing into the frame except the editor's DOM, which the host makes: a node a
  draw put in the frame would stay in it across draws.
- **The scroll position.** Detaching a scrolled element resets its `scrollTop`. `release` saves the `scrollTop` of
  the editor's scroller (`frame.querySelector('.cm-scroller')`, skipped when none is found) with the box, and `place`
  on a held editor restores it after the frame is reattached. Evidence that moving a live view is safe: chat's
  composer already keeps its box across a layout reload by moving an app-owned frame (`appSlot`), so a moved
  CodeMirror view keeping its cursor and undo is the tree's own pattern.
- **`release(box)`.** Detach the frame, save the scroll position and mark the box released. When the box is the active box, clear
  `activeKey` and call `notify()`, as `deactivate` does: the DOM move blurs the editor, and the app must not
  depend on whether the browser fires `blur` for a removed node. A release of a box already released is a no-op.
  A release of a key no editor holds is a no-op, so a rollback that runs after `destroyForm` does not throw.
- **What a rollback records.** An owner's draw records `rollback.recordBox(() => boxes.release(box))` for each box
  it places: a failed attempt and a disposed draw both only detach the frame, as chat's `appSlot` record does
  (`app-slot.ts` `place`: `rollback.recordBox(() => element.remove())`). The owner disposes the draw that placed a
  box before a new draw places it again: `layoutParts.redraw` disposes the last draw first, `drawPart` disposes a
  failed attempt's recorder before the fallback attempt, and each owner task keeps that order. A release run after
  a later `place` would detach the new placement.
- **How an owner ends boxes a new draw left out: the sweep.** `destroyReleased(formId)` destroys every box of
  form `formId` that is released, then calls `notify()` once. A redraw releases every box its old draws placed;
  the new draws place again each box they still show; the boxes left released are those the new draws left out,
  and the sweep ends them, by key. A box left out and shown again later mounts anew from the owner's current text,
  so a released editor never shows a stale text.
- **`keepFocusedBox` after.** It captures the form's focused box and whether it was in insert mode, runs
  `rebuild`, then calls `boxes.destroyReleased(formId)`, then focuses the captured box again when `isMounted` says
  it is placed. The focus option is `{ insert: true }` when the box was in insert mode, else none. A kept editor
  keeps its own mode, so `insert` does nothing to an editor still in insert mode, and an editor in visual or
  normal mode gets no option; this is the refocus chat's `drawComposer` does (`if (hadFocus) tab.box?.focus()`).
  `insertAtEnd` no longer runs, for a kept box or a remounted one: a box destroyed and mounted anew inside
  `rebuild` comes back in insert mode at its cursor, at the text's start. Owners keep calling `keepFocusedBox`
  around a redraw: the refocus must run after the whole draw, because a layout may build its root detached and
  attach it last, and `focus()` on a detached editor does nothing.
- **`isMounted(box)`** is true while the box is placed (through `place`, or mounted through `mount`) and false
  when it is released, destroyed or never mounted. Each owner reads it as "the current draw shows this box"
  (practice's left-out check, `keepFocusedBox`).
- **`focus(box)`** throws `No box is mounted as <key>` for a released box, as for a box never mounted. **`active()`**
  never returns a released box (release clears it), and `activeMode()` is null after a release.
- **`fileEditor(formId, isShown)`** skips released boxes: the last-activated box counts only while placed, and the
  first-mount fallback picks only among placed boxes. `firstMounts` and `lastActivated` still outlive a release
  and a destroy, as today.
- **No `EditorBoxes.setText`.** Its one planned caller, backlog's tags picker, left with backlog's rebuild (ai
  commit `ba762a069`); no owner replaces a box's text from outside the box, and `place` sets a held editor's text
  itself.
- **`mount` stays in this task.** It keeps today's behaviour: the editor is created in the caller's `parent` and
  editor boxes own no frame for it. `place` on a key `mount` made throws `Box <key> is mounted without a frame`;
  `release` on such a key throws the same; `destroyReleased` never reaches one (it is never released). `mount` on a
  key `place` made throws `Box <key> is already mounted`, as today. Callers of `mount` at plan time (grep
  `boxes\.mount\|\.mount(` over `src`): `src/plugins/primer/page/layout/primer-kit.ts` `appendField` (~L459),
  `src/plugins/practice/page/problem-workspace.ts` `textBoxSlot` (~L529), `src/plugins/forms/page/round-view.ts`
  `buildRoundParts`' `mountBox` (~L299), `src/plugins/audio-picker/page/layout/picker-kit.ts` `appendNotesField`
  (~L161, measured 2026-11-16), and the tests `editor-boxes.test.ts`, `primer-view.test.ts`, `round-view.test.ts`,
  `forms-view.test.ts`, `picker-kit.test.ts`, `picker-view.test.ts` through those owners. Chat, notes, docs and settings do not use
  `createEditorBoxes`: chat's composer box and the docs, settings and practice slot boxes go through `appSlot`.
  Task 10 moves primer, practice and the audio picker to `place`; task 13 moves forms and then deletes `mount` (no caller
  remains).
- **The `EditorBoxes` doc comment** says after: "One editor per text box, created the first time its form places
  it and kept across redraws until its form or the box is destroyed." The `keepFocusedBox` comment states the
  after-behaviour above, and no longer says the cursor, vim mode and undo are lost.
- **The vim mode across a move (from this repo's code).** `codemirror-vim-host.ts` keeps vim state in the
  `EditorView` (`cm.state.vim`), not in the DOM. Its blur handler (`boxExtensions`' `domEventHandlers.blur`) runs
  `leaving(view)`, which drops only an unfinished command (`discardUnfinishedInput`: a key buffer, count,
  operator or register), then `events.blurred()`; the host changes no mode on blur. `redrawCursorOnResize`
  re-dispatches the same selection on a resize, which keeps a visual selection. Whether `@replit/codemirror-vim`
  itself leaves visual or insert mode on blur is not in this repo's code: task 15 checks it live. Fallback, decided
  now: if task 15 finds vim visual mode lost on a move, the behaviour is accepted and task 14 rewords the docs to
  "insert mode, cursor and undo"; no code change.
- **`boxOf(editor)`** (the commands use it to find the focused box) returns undefined for a released box.

## Behaviour

GIVEN no editor for `notes` WHEN `place(parent, notes, 'a')` runs THEN the host creates one editor in a new
`div.ui-input` appended to `parent` with text `a`, and `place` returns that frame

GIVEN `notes` placed in `first` with text `a` WHEN `release(notes)` then `place(second, notes, 'b')` run THEN the
same frame sits in `second`, the host created no second editor, and the editor was not destroyed

GIVEN `notes` focused WHEN `release(notes)` runs THEN `active()` is null, the listeners hear one change, the frame
has no parent, and the editor is not destroyed

GIVEN `notes` and `reason` of form `f1` placed and `other` of form `f2` released WHEN `release(reason)` then
`destroyReleased('f1')` run THEN only `reason`'s editor is destroyed and its frame is gone; `notes` stays placed;
`other` stays released

GIVEN `notes` focused in insert mode WHEN `keepFocusedBox` runs a rebuild that releases and places `notes` again
THEN the same editor gets one `focus({ insert: true })` and `active()` is `notes`

GIVEN `notes` focused WHEN `keepFocusedBox` runs a rebuild that releases `notes` and places only `reason` THEN
`notes`' editor is destroyed and no box is focused

## Tests

In `src/shared/page/editor-boxes.test.ts`. The fake host's `setText` records each text it gets; tests that place
boxes install the fake DOM (`installFakeDom(vi.stubGlobal)` from `src/shared/page/test-dom.ts`, with
`vi.unstubAllGlobals()` after each) and use `document.createElement('div')` parents.

- `place_FirstCall_MountsTheEditorInAFrameItOwns` — one editor created; the frame `place` returns has class
  `ui-input`, its `parentNode` is the parent, and the host got that frame and the text.
- `place_AfterRelease_MovesTheFrameAndKeepsTheEditor` — table over the steps between the two places: `release`
  then `place` into a second parent; `place` into a second parent with no release. Each case: one editor created,
  the second `place` returns the first frame, the frame's `parentNode` is the second parent, the editor is not
  destroyed, and the second call, given the same text, called no `setText` on the editor.
- `place_HeldBoxWithNewText_SetsTheEditorText` — table over a placed and a released box, `place` with a text that
  differs from the editor's `text()`: one editor, the same frame, one `setText` with the new text, no `changed`.
- `place_AfterRelease_RestoresTheScroll` — `release` saves the scroller's `scrollTop` (set to 40 on the fake
  scroller), the fake DOM resets it on detach, and the `place` after it sets it back to 40.
- `release_FocusedBox_DetachesItsFrameAndClearsTheFocus` — the frame's `parentNode` is null; `active()` and
  `activeMode()` are null; `boxOf(editor)` is undefined; the listener count grows by one; `isMounted` is false; a
  `place` after it makes `isMounted` true again; the editor is not destroyed.
- `destroyReleased_DestroysOnlyTheFormsReleasedBoxes` — the case in Behaviour.
- `destroy_PlacedBox_RemovesItsFrame` — table over `destroyBox(notes)`, `destroyForm('f1')`, and `release(notes)`
  then `destroyReleased('f1')`: the editor is destroyed and the frame's `parentNode` is null.
- `destroyBox_KeyNoEditorHolds_DoesNothing` — `destroyBox` of a never-mounted key and of a key already destroyed does not throw and tells the listeners
  nothing.
- Rows added to `refuses a box mounted twice, and focusing a box never mounted`: `place` on a key `mount` made and
  `release` on it throw `/mounted without a frame/`; `focus` on a released box throws `/f1\/notes/`.
- Row added to `fileEditor_PicksLastUsedElseFirst`: steps `destroyBox(reason), place reason, focus reason, release
  reason` — expected `notes` (a released box is never the file editor).
- `keepFocusedBox` describe: the test `brings a box in insert mode back in insert mode at its end` becomes
  `keepFocusedBox_InsertingBox_FocusesItInInsertMode` and expects `[{ insert: true }]` on the remounted editor.
  New: `keepFocusedBox_KeptBox_FocusesTheSameEditor` — table over the mode before (`normal` → `[undefined]`,
  `insert` → `[{ insert: true }]`, `visual` → `[undefined]`), with a rebuild that releases and places the box; the
  focus options land on the first editor, and no editor is created. New:
  `keepFocusedBox_BoxTheRebuildLeftOut_IsDestroyed` — the last case in Behaviour.

Live check: task 15 (vim visual and insert mode, cursor, undo and scroll kept across a frame move; the fallback above if visual mode is lost).

Done when: `npm run lint` and the typecheck pass; the test gate runs `src/shared/page/editor-boxes.test.ts`.

Commit: one commit for the group — `src/shared/page/editor-boxes.ts`, `src/shared/page/editor-boxes.test.ts`.

## Proof
