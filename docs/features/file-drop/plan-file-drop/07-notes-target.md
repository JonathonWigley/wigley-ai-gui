# 07 — Notes popup drop target

Status: in progress
Type: Task
Wave: 4 · Depends on: 02, 03, 04
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/notes/page/popup.ts` · modify `src/plugins/notes/page/start.ts` ·
           test `src/plugins/notes/page/popup.test.ts`
Consumes:  `DroppedFile`, `PageDrops` (`api.drops.addTarget`, `api.drops.savePasted`) ← 01/04 ·
           `TextEditor.insert(text)` ← 03 · `TextEditor.charBeforeCursor()` ← 03 ·
           `insertionText(filePaths, charBefore)`, `shrinkToFit(image, encoder)`, `canvasEncoder`, `ImageEncoder` ← 02 ·
           `toPngBytes(blob)` (`src/plugins/notes/page/png-image.ts`, in the tree) · `IMAGE_TYPES` (in the tree)
Produces:  in `src/plugins/notes/page/popup.ts`:
           `NotePopupDeps.drops: Pick<PageDrops, 'addTarget' | 'savePasted'>`
           `NotePopupDeps.encoder: ImageEncoder`
           `export const SHRINK_REFUSED = 'Image could not be shrunk under 5 MB';`
Decisions:
- The `// ── Paste and drop` block goes: the `document` paste listener and the dialog's `dragover` and `drop`
  listeners, with the `filesOf`/`holdsPastedText` import and `REFUSED_TYPE` (a non-image is no longer refused; it
  becomes a chip). The core registry (04) owns listening, cancelling and the text-paste rule.
- The target is `dialog.element`, registered once in `createNotePopup` through `deps.drops.addTarget`. The popup lives
  as long as the page, so the `Disposable` is kept and never disposed, as its anchors are. A hidden dialog is under no
  pointer and on no screen, so the core routes nothing to it while closed. `dialog.element` is the scrim, so a drop
  anywhere in the window while the popup shows reaches it. `start.ts` passes `drops: api.drops` and
  `encoder: canvasEncoder`; tests pass a fake encoder.
- **The Title input** (a one-line `<input type=text>`) follows the core rule (04 § One-line input first): a paste
  while the Title is focused, or a drop on the Title input itself, puts plain paths in the Title — a pasted PNG is
  saved to `pasted/` and its path goes into the Title — and this target's `take` never sees it. The image GIVENs
  below are for a paste with the Body focused or no box focused, and a drop anywhere on the popup but the Title.
- `take(files)` runs only while `mayEdit()`; otherwise it logs `files skipped: <inFlight, or 'popup not editable'>`
  and takes nothing, as the old drop did. Files whose `mediaType` is in `IMAGE_TYPES` are images; the rest (folders,
  videos, docs, other image types) are other files.
- Images: one `runDraftOperation('attach', …)` over them in order, holding the draft lock as today. Each image:
  `bytes()` → `toPngBytes(new Blob([bytes], { type: mediaType }))` → `shrinkToFit({ bytes: png, mediaType:
  'image/png' }, deps.encoder)`; null → toast `Image could not be shrunk under 5 MB`, tone `error`, and log; otherwise
  `channel.invoke('addImage', fitted.bytes)` → `imageAdded(draft, 'file')`. Converting first is chosen (design §
  Images over 5 MB): Notes stores PNG, so it shrinks the PNG form it stores and the stored image is sure to fit; a
  large JPEG loses more resolution here than in Chat. A read, convert, shrink (an encoder rejection, which 02's
  `shrinkToFit` passes on) or add failure toasts `Image not attached: <error>` as today and leaves the rest. `imageAdded`'s `how` becomes `'capture' | 'file'`: a
  take can no longer tell a paste from a drop. Main's `note-sender.ts` is untouched: every image it sends was shrunk
  as it joined the field (design § Images over 5 MB).
- `shrinkToFit` is called on every PNG and is relied on to hand back an image already within 5 MB of base64 as it is
  (02's contract): the cap is measured only there, through 02's `base64LengthOf`, so this task checks no size
  itself. The bytes go to main as bytes, so nothing here needs `base64Of`.
- Other files: their `path`, or `await deps.drops.savePasted(file)` when `''` (a save rejection toasts `<name> not
  saved: <error>`, tone `error`, and leaves the rest), then one `body.insert(insertionText(paths,
  body.charBeforeCursor()))`; the Body is the popup's one vim box (the Title is a one-line input). Before inserting,
  the state is checked again, since a send, discard, picker or markup view may have started during the saves: the
  insert runs only when `phase === 'open'` and `inFlight` is null or this take's own `'attach'`; otherwise the
  paths are logged and nothing is inserted, as for a popup closed meanwhile (a send's `loadDraft` or a discard's
  `showDraft` would overwrite the Body). The insert reports `changed`, so the draft's `body` field updates and
  autosave runs. The other files' insert does not wait for the images' attach.
GIVEN the Notes popup open WHEN a PNG is dropped on it (not on the Title) THEN it joins the Images field as the last
  image, selected
GIVEN the Body focused, or no box focused WHEN a 9 MB PNG is pasted THEN it joins the Images field shrunk under 5 MB of
  base64
GIVEN the Title focused WHEN a PNG is pasted THEN it is saved under `pasted/` and its plain path goes into the Title
GIVEN a PNG no step brings under the cap WHEN dropped THEN the toast `Image could not be shrunk under 5 MB` shows and
  the Images field is unchanged
GIVEN a `.md` file on disk WHEN dropped on the popup (not on the Title) with the Title focused THEN its path goes into
  the Body at its cursor and the Title keeps focus (`insert` never focuses, 03; seen live, not unit-tested)
GIVEN a send in flight WHEN files are dropped THEN nothing attaches and nothing is inserted
Tests:     in `popup.test.ts`: the harness gains a fake `drops` keeping the registered target, a fake `savePasted`
           answering `/app/pasted/20261102-090000-1.txt`, a fake encoder, `addImage` in the fake channel (answering
           `DRAFT` with one more image and recording its bytes), and the fake body editor (task 03 gave it the two
           members) with `insert` recording each call and then running the editor's `changed` event with the new
           text, as the real one does, and `charBeforeCursor` answering `''`; `CAP_BYTES = (5 * 1024 * 1024 / 4) * 3`:
           `take_EachFile_GoesWhereItsKindGoes` —
           | files | addImage calls | body inserts |
           |---|---|---|
           | PNG `a.png`, bytes `[1, 2, 3]` | `[[1, 2, 3]]` | none |
           | text `/d/a b.md` | none | `[insertionText(['/d/a b.md'], '')]` |
           | text `n.txt`, path `''` | none | `[insertionText(['/app/pasted/20261102-090000-1.txt'], '')]` |
           | PNG `a.png`, `/d/v.mp4`, PNG `b.png` | both PNGs' bytes, in order | `[insertionText(['/d/v.mp4'], '')]` |
           and, for the `/d/a b.md` row, the draft's `body` field holds the inserted text (the `changed` path).
           `take_PastedFileSaveRejects` — `bad.txt` (path `''`) with `savePasted` rejecting `disk full`, then `/d/a.md`
           → toast `('bad.txt not saved: disk full', 'error')`; body inserts `[insertionText(['/d/a.md'], '')]`.
           `take_StateChangedDuringSave_InsertsNothing` — `n.txt` (path `''`) with a `savePasted` that, before it
           resolves, closes the popup (one row) or starts a send so `inFlight` is `'send'` (another) → no body
           insert; the path logged.
           `take_OverCapPng_ShrinksOrRefuses` —
           | PNG bytes | encoder returns | addImage calls | toasts |
           |---|---|---|---|
           | `CAP_BYTES + 1` | 300 bytes | the 300 bytes | none |
           | `CAP_BYTES + 1` | `CAP_BYTES + 1` bytes at every scale | none | `['Image could not be shrunk under 5 MB']` |
           `take_WhileNotEditable_TakesNothing` — a PNG and `/d/a.md` taken; no `addImage` call, no insert:
           | state |
           |---|
           | popup closed |
           | discard confirmation showing |
           | `addImage` of an earlier take still pending (the draft lock held) |
Done when: compiles (`npm run typecheck`); the test gate runs the tests above; `grep -n "addEventListener('paste'\|'drop'\|pasted-images"
           src/plugins/notes/page/popup.ts` finds nothing
Commit:    one commit for the group

Live checks deferred to "10 — Final verification": its check 7 (with the Body focused, a pasted PNG joins Images; a
pasted text file goes into the Body as a chip) and check 13 (a 6 MB PNG pasted with the Body focused joins Images
shrunk).

## Proof

<written by wigley:make: commit sha, proof result, concerns; empty until the group lands>
