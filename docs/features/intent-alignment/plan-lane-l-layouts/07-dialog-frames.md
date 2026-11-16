# 07 — Dialog frames through each opener's layout

Status: not started
Type: Parallel
Wave: 2 · Depends on: 03, 04
Plan: [plan.md](plan.md)

Files:     each row's own files (§ Rows); every row also modifies its owner's `layouts/layout.d.ts`,
           `layouts/default/layout.js` and its reader.
Consumes:  `DialogFrameInput`, `DialogFramePart`, `ConfirmButtonsKit` in `src/shared/page/layout-host/kit.d.ts` ← 04 ·
           `DrawDialogFrame`, `DialogOptions.drawFrame?`, `Dialog.redrawFrame()` in `src/shared/page/ui/dialog.ts` ← 04 ·
           `ConfirmPromptDeps.drawFrame?`, `ConfirmPrompt.redraw()` (redraws the frame) in
           `src/shared/page/confirm-prompt.ts` ← 04 ·
           `requireDialogFrame(frame, input, partName)` in `src/shared/page/layout-host/draw-part.ts` ← 04 ·
           `LayoutParts.redraw(key, parent, build, slot?)` in `src/shared/page/layout-host/layout-parts.ts` (in the tree) ·
           nothing from 03: the sessions row shares 03's files (`sessions/layouts/layout.d.ts`,
           `layouts/default/layout.js`, `page/layout/read-sessions-layout.ts`, `page/layout/sessions-parts.ts`), so it
           edits them after 03's `pickerRow` landed
Produces:  in each owner's `layouts/layout.d.ts` (owners in § Rows), inside its layout interface:
           `dialogFrame?(parent: HTMLElement, input: DialogFrameInput, kit: <Owner>Kit): DialogFramePart`
           in `src/plugins/primer/layouts/layout.d.ts`: `export interface ConfirmBodyInput { body: string }`,
           `export interface ConfirmBodyKit extends PrimerKit, ConfirmButtonsKit {}`, and
           `confirmBody?(parent: HTMLElement, input: ConfirmBodyInput, kit: ConfirmBodyKit): HTMLElement`
           in `src/plugins/practice/layouts/layout.d.ts`:
           `export interface ConfirmBodyKit extends PracticeKit, ConfirmButtonsKit {}`
           in `src/plugins/audio-picker/layouts/layout.d.ts`: `export interface ConfirmBodyInput { body: string }`,
           `export interface ConfirmBodyKit extends PickerKit, ConfirmButtonsKit {}`, and
           `confirmBody?(parent: HTMLElement, input: ConfirmBodyInput, kit: ConfirmBodyKit): PickerLayoutPart`
           in `src/plugins/audio-picker/page/layout/picker-kit.ts`:
           `export function createConfirmKit(deps: PickerKitDeps, rollback: RollbackDeps): PickerKit`

The owner list is plan.md Precondition 3's command, run at plan time. It printed the eleven calls the plan names
(chat 1, gallery 1, docs 2, sessions 1, notes 2, keys 1, practice 1, session-stash 1, `confirm-prompt.ts` 1). The
confirm prompt's callers outside forms are practice (one), the primer (one) and the audio picker (one), plan.md
Precondition 5; backlog has none since its rebuild (ai commit `ba762a069`). Forms (one confirm prompt) is task 11. Run the command again before the first row; a new caller becomes a row written to the
reference.

## Reference: one owner's frame

Every row does these steps with its own names and values.

1. **Contract** (`layouts/layout.d.ts`). Import `DialogFrameInput` and `DialogFramePart` from the kit (the import
   the file already has from `'../../../shared/page/layout-host/kit'`). Add the `dialogFrame?` part to the layout
   interface, with this comment: "The frame of `<the owner's dialogs>`: the panel, its title (`input.title`) and,
   when `input.hasActions`, its actions row. Return the panel, appended to `parent`, with `body` and `actions` inside
   it; the app fills them. The app keeps the scrim, showing and hiding, keys and focus. A frame whose `body` or
   `actions` is not inside its panel, or whose `actions` is not null exactly when `hasActions` is false, draws with
   `default`." Rewrite each contract comment that says the frame or title "stays the app's" to the after-state
   (each row names its lines).
2. **Default layout** (`layouts/default/layout.js`). Add `dialogFrame`, drawing today's DOM so the look and every
   existing `findAll(…, 'ui-dialog-body' | 'ui-dialog-actions')` test hold:

   ```js
   dialogFrame(parent, input, kit) {
     const panel = kit.el(parent, 'div', 'ui-floating material-floating ui-dialog');
     kit.el(panel, 'h2', 'ui-dialog-title', input.title);
     const body = kit.el(panel, 'div', 'ui-dialog-body');
     const actions = input.hasActions ? kit.el(panel, 'div', 'ui-dialog-actions') : null;
     return { element: panel, body, actions };
   },
   ```

   The default's `layout.css` gains nothing: these classes keep their rules in `src/shared/page/ui/dialog.css`
   (task 04). Keys' row is the one exception.
3. **Reader.** Add `dialogFrame: true` to the reader's parts table (each row names the file).
4. **Parts module.** Add a member that draws the part through the owner's layout parts. The build calls the builder
   with the owner's kit for the dialog's scope, then returns
   `requireDialogFrame(builder(into, input, kit), input, 'dialogFrame')`, so a bad frame throws and the host draws
   it with `default`. The owner must dispose each frame draw when the frame draws again, so the anchors of the
   last frame do not stay alive. Where the owner has a `LayoutParts`, use
   `parts.redraw('dialogFrame', parent, build, '<slot>')`, with one slot per dialog (each row names it); it disposes
   the earlier draw and removes its element. Where it has none, keep the last draw beside the dialog, and dispose
   it after the next draw returns.
5. **View.** Pass `drawFrame: (parent, input) => <the member>(parent, input).built` (or the member's frame) to
   `createDialog` or `createConfirmPrompt`. On each change of the owner's layouts, call `dialog.redrawFrame()` (or
   the prompt's `redraw()`), whether the dialog is open or not, before the body draws again; a closed dialog's
   frame would otherwise show the old layout at its next open. Read `dialog.body`, `dialog.actions` and
   `dialog.panel` on each use: `redrawFrame` replaces them, so a reference kept from creation goes stale (each row
   names the kept references to change).

Leave out `drawFrame` nowhere outside forms: task 11 makes it required.

## Rows

### chat

- Files: modify `src/plugins/chat/layouts/layout.d.ts` · `src/plugins/chat/layouts/default/layout.js` ·
  `src/plugins/chat/page/read-chat-layout.ts` · `src/plugins/chat/page/chat-dialogs.ts` ·
  `src/plugins/chat/page/dialog-kits.ts` · `src/plugins/chat/page/sign-in-dialog.ts` ·
  `src/plugins/chat/page/image-viewer.ts` · test `src/plugins/chat/page/chat-dialogs.test.ts`
- Part: `dialogFrame?(parent: HTMLElement, input: DialogFrameInput, kit: BaseKit): DialogFramePart` (chat's other
  dialog-adjacent parts, `imageViewer`, take `BaseKit`). Comment's dialogs: "the sign-in, deny-reason and
  end-session dialogs". `ChatPartName` includes it; `DialogPartName` excludes it by its return type, as wanted.
- Parts: chat has no parts module; `ChatLayouts.draw` is `LayoutParts.draw` with no `redraw`. `createChatDialog`
  keeps the last `DrawnPart` and disposes it after each new draw. Its signature becomes
  `createChatDialog(title: string, scope: ChatScopeName, deps: DialogDeps): Dialog`; the build's kit is
  `surfaceBaseKit(deps, scope, rollback)`. Scopes: deny box `'reason'`, end-session `'confirm'`, sign-in `'signIn'`
  (`sign-in-dialog.ts` line 64). Its `hasActions: false` stays.
- Kept references: `createDialogPart`'s `parent` (`dialog-kits.ts`) is read once; its `clear` empties it and its
  `draw` draws into it, so after `redrawFrame` an `update` that draws again would draw into the old, detached body.
  Change `createDialogPart`, `createSignInPart`, `createReasonBoxPart` and `createCloseConfirmPart` to take
  `parent: () => HTMLElement`, read at each `clear` and `draw`. The three dialogs pass `() => dialog.body`;
  `createImageViewerPart` passes `() => scrim` (its caller in `image-viewer.ts` line 67 is unchanged otherwise).
- Layout change: `redrawOnLayoutChange` gains the dialog (`Pick<Dialog, 'redrawFrame'>`) and runs
  `dialog.redrawFrame()` before `part.redraw()`; `createCloseConfirm`'s listener runs `dialog.redrawFrame()` then
  `part.redraw()`. `reasonBox.open`'s `dialog.setTitle(...)` redraws the frame (task 04), then `part.update` runs
  in the new body.
- `layout.css`: `.chat-dialog-part > .ui-dialog-actions` stays (the body part's own row).
- Test: `reasonBox_OpenAfterALayoutChange_DrawsTheBodyInTheNewFrame` — a user layout whose `dialogFrame` marks its
  panel; after the layouts change and `open('Bash', send)`, the reason box part's root is inside the user frame's
  body, the frame carries `data-layout="<user name>"`, and the title reads `Deny Bash?`.

### docs

- Files: modify `src/plugins/docs/layouts/layout.d.ts` · `src/plugins/docs/layouts/default/layout.js` ·
  `src/plugins/docs/page/layout/read-layout.ts` · `src/plugins/docs/page/layout/docs-parts.ts` ·
  `src/plugins/docs/page/docs-dialogs.ts` · test `src/plugins/docs/page/docs-dialogs.test.ts`
- Part: `dialogFrame?(parent, input: DialogFrameInput, kit: DocsKit): DialogFramePart`. Comment's dialogs: "the
  path box dialog and the Trash confirmation".
- Comments: line 158 "The Dialog primitive (scrim, panel and title) stays the app's; a part draws the dialog's body."
  becomes "The app keeps each dialog's scrim, keys and focus; `dialogFrame` draws its panel, title and actions row,
  and a part draws its body." Line 174 "The dialog's title stays the app's." becomes "The app sets the dialog's title;
  `dialogFrame` draws it."
- Parts: `DocsParts.draw` returns only the root, so add a member
  `dialogFrame(slot: HTMLElement, input: DialogFrameInput, scope: 'box' | 'confirm'): { frame: DialogFramePart; dispose(): void }`.
  It records `host.pick('dialogFrame')` in `drawnPicks` as `draw` does, so `redrawIfChanged` sees a changed frame
  pick, draws with `deps.baseKit(scope, rollback)`, and its `dispose` removes the panel and disposes the draw.
  `PART_SCOPES` needs an entry for every part: give `dialogFrame: 'box'`, with a comment that the member draws with
  the scope it is given.
- View: the box dialog (`createDialog('')`, line 86) draws with scope `'box'`, the Trash confirm (line 318) with
  `'confirm'`; each keeps its last draw and disposes it after the next. Each dialog's `redraw()` runs
  `dialog.redrawFrame()` first, open or not, then its body draw only while open. `createDocsDialogs`'s `redraw`
  already calls `box.redraw()` and `confirm.redraw()` inside `parts.redrawIfChanged`. The confirm kit's
  `actions: () => dialog.actions` and the box's `dialog.body` reads already read on use.
- Test: `redraw_ChangedFrameLayout_DrawsTheTrashConfirmInTheNewFrame` — confirm open; a user layout defining only
  `dialogFrame`; after `redraw`, the panel carries the user layout's name, and the question and both answer buttons
  are inside its body and actions.
- Test: `redraw_ChangedFrameLayout_KeepsTheBoxInputAndCompletionsInTheNewFrame` — box open with a typed value; a user
  layout defining `dialogFrame`; after `redraw`, the input is inside the new frame's body with its value, the
  completion list is inside the new body, and the input keeps focus.

### sessions

- Files: modify `src/plugins/sessions/layouts/layout.d.ts` · `src/plugins/sessions/layouts/default/layout.js` ·
  `src/plugins/sessions/page/layout/read-sessions-layout.ts` · `src/plugins/sessions/page/layout/sessions-parts.ts` ·
  `src/plugins/sessions/page/sessions-view.ts` · `src/plugins/sessions/page/rename-dialog.ts` · test `src/plugins/sessions/page/rename-dialog.test.ts`
- Part: `dialogFrame?(parent, input: DialogFrameInput, kit: SessionsKit): DialogFramePart`. Comment's dialogs: "the
  rename dialog".
- Comment: line 61 "Dialogs. The Dialog primitive (scrim, panel and title) stays the app's; a part draws the dialog's
  body." becomes "Dialogs. The app keeps the rename dialog's scrim, keys and focus; `dialogFrame` draws its panel and
  title, and `renameDialog` draws its body."
- Parts: `SessionsParts.dialogFrame(parent: HTMLElement, input: DialogFrameInput): DrawnPart<DialogFramePart>` through
  `parts.redraw('dialogFrame', parent, build)` (slot `dialogFrame`), kit `sessionsKit(rollback)`.
- View: `RenameDialogDeps.parts` becomes `Pick<SessionsParts, 'renameDialog' | 'dialogFrame'>`; `createDialog('Rename
  session', { hasActions: false, drawFrame })`. `start.ts` passes `view.parts`, so `SessionsView.parts` (`sessions-view.ts`, task 03) widens to `Pick<SessionsParts, 'renameDialog' | 'pickerRow' | 'dialogFrame'>`. `redraw()` runs `dialog.redrawFrame()` always, then `drawBody()` while
  renaming. `start.ts`'s `setLayouts` already calls `renameDialog.redraw()` after `view.setLayouts(shown)`.
  `drawBody` already reads `dialog.body` on each call.
- Test: `redraw_ChangedLayout_DrawsTheFrameAndKeepsTheBox` — dialog open with typed text; a user layout defining
  `dialogFrame`; after `setLayouts` and `redraw`, the panel carries the user name, the box is inside its body with
  its text, and the box has focus.

### notes

- Files: modify `src/plugins/notes/layouts/layout.d.ts` · `src/plugins/notes/layouts/default/layout.js` ·
  `src/plugins/notes/page/layout/read-notes-layout.ts` · `src/plugins/notes/page/layout/notes-parts.ts` ·
  `src/plugins/notes/page/popup.ts` · test `src/plugins/notes/page/popup.test.ts`
- Part: `dialogFrame?(parent, input: DialogFrameInput, kit: NotesKit): DialogFramePart`. Comment's dialogs: "the Note
  popup and the discard confirmation".
- Parts: `NotesParts.dialogFrame(parent: HTMLElement, input: DialogFrameInput, dialog: 'popup' | 'confirm'): DrawnPart<DialogFramePart>`
  through `parts.redraw('dialogFrame', parent, build, \`dialogFrame:${dialog}\`)`, kit
  `kitFor(deps, dialog, rollback)` (scopes `popup` and `confirm` are in the notes manifest).
- View: `createDialog('Note', { drawFrame })` with `'popup'`; `createDialog('Discard this note?', { hasActions: false,
  drawFrame })` with `'confirm'`. `setLayouts` (line 1259) runs `dialog.redrawFrame()` and `confirm.redrawFrame()`
  right after `parts.setLayouts(shown)`, before `parts.actions(dialog.actions)` and `parts.confirm(confirm.body)`.
  The fields view and markup view appended once at line 329 move with the frame; `showFields`' `dialog.actions.hidden`
  carries over (task 04). The scrim keeps its `notes-popup` class (the scrim is the app's).
- Comment: `layouts/layout.d.ts` line 12 "The app keeps the dialog frames and titles, the title box and the body editor,"
  becomes "The app keeps the dialogs' scrims, keys and focus, the title box and the body editor," (`dialogFrame` draws
  each dialog's panel, title and actions row).
- Test: `setLayouts_ChangedFrameLayout_KeepsFieldsAndActionsInTheNewFrame` — popup open; a user layout defining
  `dialogFrame`; after `setLayouts`, the fields view is inside the new frame's body and the `actions` part inside its
  actions row.

### practice

- Files: modify `src/plugins/practice/layouts/layout.d.ts` · `src/plugins/practice/layouts/default/layout.js` ·
  `src/plugins/practice/page/layout/read-layout.ts` · `src/plugins/practice/page/import-box.ts` ·
  `src/plugins/practice/page/practice-view.ts` · `src/plugins/practice/page/problem-workspace.ts` · test
  `src/plugins/practice/page/import-box.test.ts`
- Part: `dialogFrame?(parent, input: DialogFrameInput, kit: PracticeKit): DialogFramePart`. Comment's dialogs: "the
  import dialog and the Solution confirm". `ConfirmBodyKit` becomes `extends PracticeKit, ConfirmButtonsKit {}`, its
  two members and their comment removed (`ConfirmButtonsKit` carries them). Import `ConfirmButtonsKit` from the kit.
- Comment: line 190 "(the Dialog primitive's scrim, panel and title stay the app's)" becomes "(`dialogFrame` draws the
  dialog's panel and title; the app keeps its scrim, keys and focus)".
- Parts: practice has no parts module; the two views each hold a `LayoutParts`. Import box: `ImportBoxDeps` gains
  `drawFrame: DrawDialogFrame`; `practice-view.ts` passes `(parent, input) => parts.redraw('dialogFrame', parent,
  build, 'dialogFrame:import').built`, kit `kitFor('import', rollback)`. Solution confirm: `problem-workspace.ts`
  passes `drawFrame` to `createConfirmPrompt` the same way, slot `dialogFrame:confirm`, kit
  `kitFor('confirm', rollback)`.
- View: `import-box.ts` `redraw()` runs `dialog.redrawFrame()` always, then `drawBody()` while importing;
  `practice-view.ts`'s `setLayouts` already calls `importBox.redraw()`, and `problem-workspace.ts`'s calls
  `prompt.redraw()`.
- Test: `redraw_ChangedLayout_DrawsTheFrameAndKeepsTheBox` in `import-box.test.ts` — as the sessions row's test, with
  a fake `drawFrame` that records each draw.

### keys

- Files: modify `src/plugins/keys/layouts/layout.d.ts` · `src/plugins/keys/layouts/default/layout.js` ·
  `src/plugins/keys/layouts/default/layout.css` · `src/plugins/keys/page/keys.css` ·
  `src/plugins/keys/page/layout/read-keys-layout.ts` · `src/plugins/keys/page/layout/keys-parts.ts` ·
  `src/plugins/keys/page/help-view.ts` · `src/plugins/keys/page/start.ts` · test
  `src/plugins/keys/page/layout/keys-parts.test.ts`
- Part: `dialogFrame?(parent, input: DialogFrameInput, kit: KeysKit): DialogFramePart`. Comment's dialogs: "the
  help overlay"; add "its actions row holds the Close button, `kit.button(actions, 'Close', 'keys.closeHelp')`; a
  frame that leaves it out has none, and the close key still closes help".
- Default: the reference frame, with `keys-help-dialog` added to the panel's classes, and, in its actions row,
  `const close = kit.button(actions, 'Close', 'keys.closeHelp', { variant: 'secondary' })` then
  `kit.keyHint(close, 'closeHelp')`, so the hint follows the keymap as today's `closeHint` anchor does
  (`kit.button`'s `keys` option draws keys read once). Move the `.ui-dialog.keys-help-dialog` rule and its comment
  from `keys/page/keys.css` to `keys/layouts/default/layout.css`; `.ui-scrim.keys-help-scrim` stays in `keys.css`
  (the scrim is the app's).
- Parts: `PART_SCOPES` gains `dialogFrame: HELP_SCOPE`. `KeysParts.dialogFrame(parent: HTMLElement, input: DialogFrameInput): DrawnPart<DialogFramePart>`
  through `layoutParts.redraw('dialogFrame', parent, build)`, kit `kitFor('dialogFrame', rollback)`.
- View: `mountHelpView(overlay, sections, parts)` drops its `close` and `closeHint` parameters and the
  `textButton` (and its import); `createDialog('Keys', { drawFrame: (parent, input) => parts.dialogFrame(parent,
  input).built })`. `dialog.element.classList.add('keys-help-scrim')` stays; `dialog.panel.classList.add('keys-help-dialog')`
  goes. `scroller` becomes a getter returning `dialog.panel`. `layoutsChanged()` runs `dialog.redrawFrame()` with
  `draw()` while shown; when hidden it sets `isStale`, and `show()` runs `dialog.redrawFrame()` and `draw()` when
  stale. `start.ts`: remove `closeHint` and its `keys.anchor` (lines 95–98), the two arguments, and
  `closeHelpCommand` (line 94): `closeHelp` (about line 115) does not use it, so it is unused once the arguments go.
  Remove the `qualify` import (line 17) too, since nothing else in the file uses it; `element` stays (line 140).
- Comment: `layouts/layout.d.ts` lines 2–4 "The app keeps the help dialog (its title, scrim and Close button), the
  which-key panel's placement and timers," becomes "The app keeps the help dialog's scrim, keys and focus (its
  `dialogFrame` draws the panel, title and Close button), the which-key panel's placement and timers,".
- Test: `dialogFrame_Default_CloseRunsCloseHelpAndShowsItsKey` — the default frame with `hasActions: true`: its actions
  row holds one button `Close`; a click runs `keys.closeHelp` through the fake kit commands; an anchor for
  `keys.closeHelp` in scope `keys.help` was named.

### session-stash

- Files: modify `src/plugins/session-stash/layouts/layout.d.ts` · `src/plugins/session-stash/layouts/default/layout.js` ·
  `src/plugins/session-stash/page/layout/read-session-stash-layout.ts` ·
  `src/plugins/session-stash/page/layout/session-stash-parts.ts` · `src/plugins/session-stash/page/note-dialog.ts` ·
  test `src/plugins/session-stash/page/note-dialog.test.ts`
- Part: `dialogFrame?(parent, input: DialogFrameInput, kit: BaseKit): DialogFramePart` (session-stash has no owner
  kit; `noteDialog`'s kit extends `BaseKit`). Comment's dialogs: "the stash dialog".
- Comment: line 2's "The Dialog primitive (scrim, panel and its `Stash session` title) stays the app's;" becomes "The
  app keeps the stash dialog's scrim, keys and focus, and its `Stash session` title text; `dialogFrame` draws its
  panel and title;".
- Parts: `SessionStashParts.dialogFrame(parent: HTMLElement, input: DialogFrameInput): DrawnPart<DialogFramePart>`
  through `parts.redraw('dialogFrame', parent, build)`, kit
  `createBaseKit(ownerBaseKitDeps(sessionStashManifest, deps, null, rollback))`, as `noteDialog`'s.
- View: `NoteDialogDeps.parts` becomes `Pick<SessionStashParts, 'noteDialog' | 'dialogFrame'>`; `redraw()` runs
  `dialog.redrawFrame()` always, then the body while stashing. `start.ts` line 87 already calls `noteDialog.redraw()`.
- Test: add to `redraw_ChangedLayout_KeepsOneBodyAndTheTypedNote` its layout defining `dialogFrame`, and assert the
  scrim holds one panel, carrying the user name, with the body inside it. Both assertions check the same redraw.

### gallery

- Files: modify `src/plugins/gallery/layouts/layout.d.ts` · `src/plugins/gallery/layouts/default/layout.js` ·
  `src/plugins/gallery/page/layout/read-gallery-layout.ts` · `src/plugins/gallery/page/layout/gallery-parts.ts` ·
  `src/plugins/gallery/page/gallery-view.ts`
- Part: `dialogFrame?(parent, input: DialogFrameInput, kit: GalleryKit): DialogFramePart`. Comment's dialogs: "the
  Dialog sample".
- Parts: `GalleryParts.dialogFrame(parent: HTMLElement, input: DialogFrameInput): DrawnPart<DialogFramePart>` through
  `parts.redraw('dialogFrame', parent, build)`; one slot, since one sample shows at a time.
- View: `dialogSample(drawFrame: DrawDialogFrame)` passes it to `createDialog('Cancel the round?', { drawFrame })`;
  the sample's own body text and two `textButton`s stay (it shows the primitive). `sectionSpecs` gains a
  `drawFrame` parameter; `framed('Dialog', () => dialogSample(drawFrame), true)`. The view passes
  `(parent, input) => parts.dialogFrame(parent, input).built`. `setLayouts` already calls `drawSections()`, which
  makes a new sample, so the sample needs no `redrawFrame`.
- Comments: `layouts/layout.d.ts` lines 5–7 "A layout's CSS selects under its own root only, so it never restyles a
  primitive." becomes "A layout's CSS selects under its own root only, so it never restyles a primitive; the Dialog
  sample's panel, title and actions row are the layout's `dialogFrame`." Lines 23–24 "`isDialog` for the dialog, whose
  frame holds its scrim." becomes "`isDialog` for the dialog, whose scrim the app keeps and whose panel `dialogFrame`
  draws."
- Test: none; gallery has no view test, and the sample is checked live (task 15).

### primer

- Files: modify `src/plugins/primer/layouts/layout.d.ts` · `src/plugins/primer/layouts/default/layout.js` ·
  `src/plugins/primer/page/layout/read-primer-layout.ts` · `src/plugins/primer/page/primer-view.ts` · test
  `src/plugins/primer/page/primer-view.test.ts`
- Parts: `confirmBody?(parent, input: ConfirmBodyInput, kit: ConfirmBodyKit): HTMLElement` and
  `dialogFrame?(parent, input: DialogFrameInput, kit: PrimerKit): DialogFramePart`, as practice's.
  Comment for `confirmBody`: "The cancel confirm's body, scope `primer.confirm`: `input.body` and the prompt's two
  buttons. A button the part leaves out goes at the end of the frame's actions row." Reader: `PANE_PARTS` in
  `read-primer-layout.ts` gains `confirmBody: true` and `dialogFrame: true`.
- Default `confirmBody`: as practice's default (`practice/layouts/default/layout.js` line 244, `confirmBody(parent, input, kit)`):
  `return kit.el(parent, 'p', '', input.body);`. It leaves both buttons out, so the prompt appends them to the
  frame's actions row, and the DOM matches today's prompt-drawn body.
- View: primer draws with `drawPart` and `pickPart(shownLayouts, part)`, with no `LayoutParts`. In
  `mountPrimerPopups`, move the `let shownLayouts` declaration (now after the prompt, line 347) above
  `createConfirmPrompt`: the prompt draws its body while it is made, and the draw reads `shownLayouts`. Build one
  `PrimerKitDeps` from `deps` as `createPrimerFormView` builds `partDeps` (line 614). Pass
  `drawBody(body, promptParts)` and `drawFrame(parent, input)`, each through `drawPart({ owner: 'primer', pick:
  pickPart(shownLayouts, (layout) => layout.<part>), defaultLayout, … })` with kit
  `createPrimerKit(kitDeps, 'confirm', rollback)` (the body's kit adds `keepButton` and `confirmButton` from
  `promptParts`, as practice's does); keep the last draw of each and dispose it after the next. `setLayouts` runs
  `shownLayouts = shown; confirm.redraw(); render();`.
- Test: `setLayouts_ChangedLayout_RedrawsTheCancelConfirmBodyAndFrame` — a user layout defining `confirmBody` and
  `dialogFrame`, each marking its root; after `setLayouts`, the prompt's panel and body root carry the user name and
  both buttons are inside the panel.

### audio-picker

Added 2026-11-16 (plan.md § Decisions, round 2); line numbers from that day.

- Files: modify `src/plugins/audio-picker/layouts/layout.d.ts` · `src/plugins/audio-picker/layouts/default/layout.js` ·
  `src/plugins/audio-picker/page/layout/read-picker-layout.ts` · `src/plugins/audio-picker/page/layout/picker-kit.ts` ·
  `src/plugins/audio-picker/page/picker-view.ts` · test `src/plugins/audio-picker/page/picker-view.test.ts`
- Parts: `confirmBody?(parent, input: ConfirmBodyInput, kit: ConfirmBodyKit): PickerLayoutPart` and
  `dialogFrame?(parent, input: DialogFrameInput, kit: PickerKit): DialogFramePart`, as the primer's; `confirmBody`
  returns `PickerLayoutPart` because every audio picker part does. `CompleteAudioPickerLayout` gains both as
  required. Comment's dialogs for `dialogFrame`: "the cancel prompt". Comment for `confirmBody`: "The cancel
  prompt's body, scope `audio-picker.confirm`: `input.body` and the prompt's two buttons. A button the part leaves
  out goes at the end of the frame's actions row." Reader: `PARTS` in `read-picker-layout.ts` gains
  `confirmBody: true` and `dialogFrame: true`.
- Comment: the header's list of what the app keeps (line 13–14, "the footer (…), the cancel prompt, scrolling and the
  notes boxes themselves") says "the cancel prompt's scrim, keys and focus" for "the cancel prompt", and the
  paragraph gains: "`dialogFrame` and `confirmBody` draw the cancel prompt's panel, title, body and buttons."
- Kit: `picker-kit.ts` gains `createConfirmKit(deps, rollback)`, `createPickerKit`'s twin in scope `confirm`
  (`ownerBaseKitDeps(audioPickerManifest, deps, 'confirm', rollback)`), the scope the prompt's keys already use
  (`audioPickerScope('confirm')`). Both prompt parts draw with it; the body's kit adds `keepButton` and
  `confirmButton` from the prompt's parts, as the primer's does.
- Default: `confirmBody` returns `{ element: kit.el(parent, 'p', '', input.body) }`. It leaves both buttons out, so
  the prompt appends them to the frame's actions row, and the DOM matches today's prompt-drawn body. `dialogFrame` is
  the reference frame.
- View: the audio picker draws with `drawPart` and `pickPart(shownLayouts, name)`, with no `LayoutParts`
  (`PartName` is `keyof AudioPickerLayout`, so the two parts join it). In `mountPickerPopups`, move the
  `let shownLayouts` declaration (~L246, after the prompt) above `createConfirmPrompt` (~L225): the prompt draws its
  body while it is made, and the draw reads `shownLayouts`. Pass `drawBody(body, promptParts)` and
  `drawFrame(parent, input)`, each through `drawPart({ owner: 'audio-picker', pick: pickPart(shownLayouts, '<part>'),
  defaultLayout, … })` with kit `createConfirmKit`; the frame's build returns `requireDialogFrame(…)`. Keep the last
  draw of each and dispose it after the next. `setLayouts` (~L345) runs `shownLayouts = shown; confirm.redraw();
  render();`. The stale-part loop (~L418) draws only the picker's own rows and leaves the two prompt parts alone.
- Test: `setLayouts_ChangedLayout_RedrawsTheCancelConfirmBodyAndFrame` in `picker-view.test.ts`, as the primer row's —
  a user layout defining `confirmBody` and `dialogFrame`, each marking its root; after `setLayouts`, the prompt's
  panel and body root carry the user name and both buttons are inside the panel.

## Done when

`npm run lint` and the typecheck pass, `layout-contracts.test.ts`'s `every owner contract type-checks beside
kit.d.ts` passes for every changed contract, and the test gate runs each row's test. Every `createDialog` and
`createConfirmPrompt` call that Precondition 3's command and `command grep -rn 'createConfirmPrompt(' <repo>/src
--include='*.ts'` print, outside tests and forms, passes `drawFrame`. Live check: task 15.

## Commit

One commit for the group, its pathspecs every row's Files: `git commit -- src/plugins/chat/layouts
src/plugins/chat/page src/plugins/docs/layouts src/plugins/docs/page src/plugins/sessions/layouts
src/plugins/sessions/page src/plugins/notes/layouts src/plugins/notes/page src/plugins/practice/layouts
src/plugins/practice/page src/plugins/audio-picker/layouts src/plugins/audio-picker/page src/plugins/keys/layouts
src/plugins/keys/page src/plugins/session-stash/layouts src/plugins/session-stash/page src/plugins/gallery/layouts
src/plugins/gallery/page src/plugins/primer/layouts src/plugins/primer/page`. Stage only the files the rows name:
another session may hold changes in those folders.

## Proof

