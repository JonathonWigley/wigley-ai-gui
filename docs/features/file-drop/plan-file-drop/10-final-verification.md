# 10 — Final verification

Status: not started
Type: Task
Wave: 5 · Depends on: 09
Plan: [plan.md](plan.md)

Files:     none (a drive run; scratch under the session scratchpad)
Decisions: run in a drive run (`npm run drive -- start --run file-drop`, then `do`, `eval`, `screenshot`, `quit`,
           per `AGENTS.md` § Running and testing), Node through `source ~/.nvm/nvm.sh && nvm use`. Synthetic drops and
           pastes are dispatched with `eval` as `DragEvent`/`ClipboardEvent` carrying a `DataTransfer` of built `File`s;
           such a `File` has no path on disk, so it exercises the pasted-file route (`pathForFile` gives `''`). Each check
           is settled by a screenshot of the surface, and for saved files by listing the folder; a check that
           counts `changed` or reads text and mode does so through `eval` over the box's editor and the page log.

Setups the checks share:

- **A decodable PNG over the cap** (3 932 160 bytes, the most whose base64 fits 5 MB): in one `eval`, an
  `OffscreenCanvas` of 1600 × 1000 filled with an `ImageData` of random bytes (`crypto.getRandomValues` over
  65 536-byte slices, alpha set to 255), then `convertToBlob({ type: 'image/png' })`; noise does not compress, so
  the blob is about 6.4 MB. The script checks `blob.size > 3932160` (growing the canvas if not) before it builds
  `new File([blob], 'noise.png', { type: 'image/png' })`, and keeps the `File` in a `var` for the next `eval`.
- **A JPEG over the cap**: the same noise on a 3000 × 2000 canvas, `convertToBlob({ type: 'image/jpeg', quality: 1 })`,
  checked `> 3932160` the same way.
- **Two panes**: with Sessions showing two sessions, `key <A-;>` (`sessions.splitRight`, `src/plugins/keymap.ts`)
  splits it right.
- **A doc the write guard allows**: `do docs.seed` (returns the run home), then `do docs.openDoc` with
  `{ "path": "<home>/dev/selftest-repo/AGENTS.md" }`, the fixture's `repo` entry (`Repo instructions`); when the
  machine index does not list it (`openDoc` toasts so), `do docs.connectSession` first. `changeRefusal`
  (`src/plugins/docs/path-guard.ts`) allows a write inside a `repo` or `features` entry's root, so pasted images land
  in `<home>/dev/selftest-repo/images/`. `key i` (`docs.edit`) opens the vim editor.

Checks:

1. expected — a PNG pasted into a Form tab's box with the box focused in normal mode shows a file chip `[<name>.png]`,
   the mode is still normal, and the file exists under the run home's `pasted/`.
2. expected — a 6 MB PNG (the noise PNG above) dropped on the Chat tab attaches as a thumbnail (shrunk), with no
   refusal toast.
3. low-confidence (chip rendering and atomic ranges have no test over the DOM) — in a Chat box holding
   `see /tmp/a b.md and /tmp/c.mp4` with the first quoted, both draw as chips; `w` steps over each whole, and `x` on one
   deletes it whole.
4. low-confidence (routing by pointer across panes is wiring a unit test fakes) — with Sessions split into two panes
   (setup above), a drop at the right pane's centre while the left pane's box is focused in insert mode lands a chip
   in the right pane's box; the left box keeps focus and insert mode.
5. low-confidence (docs save goes through the write guard, over a fixture doc) — on the doc set up above, a PNG
   pasted into the Docs editor writes `images/AGENTS-<yyyyMMdd-HHmmss>.png` beside it and inserts
   `![…](images/…)` at the cursor; after `:wq` the rendered doc shows the link's alt text (the app's docs view draws
   no picture).
6. expected — a drop on Settings mode's empty area toasts `Nothing here takes files`; a drop on a settings row's input
   puts the plain path at its caret.
7. low-confidence (the listeners `listenForImages` and the Notes popup had are gone) — with the Notes popup's Body
   focused, a pasted PNG joins its Images field; a pasted text file goes into its Body as a chip.
8. low-confidence (`insert`'s placement per vim mode has no unit test: the test environment has no CodeMirror view) —
   in a Chat box, a pasted text file goes in: in normal mode on `look at` with the cursor on the final `t`, the text
   is `look at <path>` and the cursor is on the chip; in insert mode at the caret, the caret after the path; in
   visual mode — characterwise, linewise and blockwise in turn — one path replaces the main selection and the box
   is in normal mode. In each, the box keeps the focus it had and the page log shows one `changed` per insert.
9. low-confidence (the chip filter's coordinates are checked only live) — in insert mode with the caret just before a
   chip, typing `ab` puts `ab` before it and the caret stays before the chip, not past it.
10. expected — a read-only doc, the fixture's plugin-cache skill
    (`<home>/.claude/plugins/cache/selftest-market/selftest-plugin/1.0.0/skills/cached/SKILL.md`, opened with
    `docs.openDoc`), takes no file: `key i` opens no editor, and a drop on it changes nothing and toasts `Nothing here
    takes files`; and on the doc set up above, the Docs editor holding an absolute path such as `/tmp/a/b.md` draws
    it as plain text, no chip.
11. low-confidence (the `<…>` link destination and `resolveLink`'s decoding meet only here) — a file whose path holds a
    space, dropped into the Docs editor, goes in as `[name](<…>)`; after `:wq` the rendered doc shows the link, and
    following it opens that file.
12. expected — a JPEG over the cap (setup above) dropped on the Chat tab attaches as a JPEG thumbnail (re-encoded as
    itself), with no refusal toast; the page log's `attached a image/jpeg image` line names the type.
13. low-confidence (the Notes shrink goes PNG → canvas → PNG, which no unit test runs) — with the Notes popup's Body
    focused, the 6 MB noise PNG pasted joins its Images field, with no `Image could not be shrunk under 5 MB` toast.

Checks only the user's hands can settle (real Finder drags carry real paths; the agent cannot synthesize them) go in the
run's wrap-up, not here as boxes: drag a `.mp4` and a `.md` from Finder into Chat and into a Form box; Cmd+Shift+Ctrl+4 a
screenshot and Cmd+V it into a Primer box.

Done when: every check above passes, each with its screenshot or listing named in Proof
Commit:    none

## Proof
