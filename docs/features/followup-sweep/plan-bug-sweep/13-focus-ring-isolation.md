# 13 — The doc editor's focus ring stays inside the editor's stacking

Status: done
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     modify `src/renderer/codemirror-vim/editor-theme.ts`
Consumes:  nothing new
Produces:  `isolation: 'isolate'` in the `'&.wg-document-editor'` rule of `export const editorTheme` in
           `src/renderer/codemirror-vim/editor-theme.ts`
Decisions: `.wg-document-editor` takes `isolation: isolate`, so the focus ring's z-index stays inside the editor
           (plan.md, Decided notices); the ring keeps its `zIndex: '300'`, which still lifts it over CodeMirror's own
           gutters and panels inside the editor

## Behaviour

- The `'&.wg-document-editor'` rule (now `{ height: '100%' }`) gains `isolation: 'isolate'`. The editor becomes its
  own stacking context, so the `::after` ring's `zIndex: '300'` orders it only against the editor's own layers (the
  gutters, the vim panel), and the editor as a whole stacks as one L2 content element: under the side bar drawn over
  the content (`z-index: 1`), the floating layer (`--wg-z-floating`), dialogs, help and which-key, and toasts.
- The ring rule itself (`'&.wg-document-editor.cm-focused::after'`) is unchanged, `zIndex: '300'` included; inside the
  isolated editor it still paints over the gutter and the vim panel, which CodeMirror stacks at up to 300 and which
  come before `::after` in tree order.
- Nothing escapes that should: the editor's autocomplete tooltip mounts on `document.body` (`tooltipsOnBody()` in
  `codemirror-vim-host.ts`), outside the editor, so its `calc(var(--wg-z-dialog) + 1)` is unaffected.
- The input-frame variant (`input-frame.css`, `.ui-input .cm-editor.wg-document-editor.cm-focused::after { content:
  none }`) is unchanged; isolating an editor inside a frame changes nothing visible there.

## Comments

The comment above the ring (a text box's focus ring is its frame; the document editor's ring is an overlay so the
opaque gutter and vim panel cannot cover its edges; an input frame around a document editor hides it and rings it
instead) gains one sentence: the document editor isolates its stacking, so the ring's z-index orders it only above
the editor's own gutter and panels.

GIVEN a focused doc editor in a narrow window WHEN the side bar opens over the content THEN the side bar covers the
editor's focus ring (live check)

## Tests

None: the claim is about what paints over what, which a unit test cannot see (`wigley:writing-tests` § What earns a
live run instead); `editor-theme.ts` has no test. The live checks carry it.

Done when: `npm run typecheck` and `npm run lint` pass
Commit:    one commit for the group

## Live checks for task 15

Captured once, after every task lands: the stacking fault is read from the code, so the checks prove the fixed
state rather than reproduce the old one.

- Expected — ring under the narrow overlay: drive run with `docs.seed`; `resize` to 679 px wide; `key Space k d`
  (Docs mode; the side bar starts hidden while narrow), open a doc (`key Space k d` to open the overlay, `key j l`
  until `[docs] opened …`; once task 10 lands the overlay closes on the open), `key <A-l>`, `key i` to edit (the
  editor focused: `query` `.cm-editor.wg-document-editor.cm-focused` matches), then `key Space k d` to open the side
  bar over the content and `screenshot`. The side bar covers the 1px accent ring where the two overlap.
- Expected — ring under help: the same focused editor, `key Space ?` (help, floating layer) and `screenshot`. The help panel covers
  the ring.
- Low-confidence (the ring inside the editor, the reason it has a z-index) — after the fix, the focused editor with
  line numbers and the vim panel showing (`key :` opens the vim command line; `key Escape` after): the ring's four
  edges stay visible over the gutter and over the vim panel's top border, at `screenshot` zoom.

## Proof

bf6d8d2 · diff read, isolation: isolate on the rule; ring rule unchanged · concerns: none

