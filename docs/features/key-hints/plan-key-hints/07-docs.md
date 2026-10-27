# 07 — Docs

Status: done
Type: Batch
Wave: 2 · Depends on: 01
Plan: [plan.md](plan.md)

**Contents**

- **Intent** — what this task lands.
- **Fields** — Files, Consumes, Produces, Decisions, Binds and anchors, behaviour, Tests, Done when, Commit.
- **Proof** — written by `wigley:make`.

## Intent

Every Docs key shows on the thing it acts on: the tree's header and cursor row, the split edge, the doc
header, and the dialogs and prompts. One docs view serves both places the tree sits — the side bar in Docs
mode and the start pane of a session Docs tab's split — so each anchor is placed inside the view's own
panes and covers both. The conflict prompt, the Trash question and the no-place toast stop printing keys as
plain text; this closes the follow-up "Docs prints keys as plain text inside three sentences" in
`docs/features/followups.md` (task 10 removes the entry). Docs stops reading `keysFor` and drawing Kbd itself.

## Fields

Files:     modify `src/plugins/docs/page/start.ts` · modify `src/plugins/docs/page/docs-view.ts` ·
           modify `src/plugins/docs/page/tree-view.ts` · modify `src/plugins/docs/page/doc-view.ts` ·
           modify `src/plugins/docs/page/docs-dialogs.ts` · modify `src/plugins/docs/page/docs-state.ts` ·
           test `src/plugins/docs/page/docs-state.test.ts` · modify `src/plugins/docs/page/docs.css`

Consumes:  `KeysPageExports.anchor(element: HTMLElement, command: CommandId, options?: AnchorOptions): Disposable` ← 01
           `AnchorOptions { scope?: ViewScope; where?: HintWhere; label?: boolean | string }` ← 01
           the `is-hint-hidden` class the keys plugin sets on a hidden anchor ← 01
           the class `ui-key-chevron` ← 01
           existing: `qualify` (`src/shared/plugin-manifests.ts`), `docsManifest`, `emptyState`, `textButton`,
           `createDialog` (`Dialog.actions`), `createListPicker`

Produces:  in `src/plugins/docs/page/docs-state.ts`:
           `export type DocsAnchor = (element: HTMLElement, command: keyof typeof docsManifest.commands, options: { scope: keyof typeof docsManifest.scopes; label?: boolean | string }) => Disposable;`
           `export interface TreeLine { placement: 'empty' | 'above'; text: string; hint: { command: 'filter' | 'rescan'; words: string } | null; }`
           `export function treeLine(state: TreeLineState): TreeLine | null;` (the `keys` parameter is removed)
           `export function trashQuestion(targets: readonly string[], homeDir: string, paths: Paths): string;` (the `keys` parameter is removed)
           `export function noPlaceText(kindTitle: string): string;` (the keys parameter is removed)
           removed: `DocsKeysFor`, `conflictText`, `keyHints`, `TreeLineHintPart`, `TreeLineKeys`
           in `src/plugins/docs/page/docs-view.ts`: `DocsViewDeps.anchor: DocsAnchor;` replaces `keysFor`,
           `onKeysChanged` and `kbd`
           in `src/plugins/docs/page/tree-view.ts`: `TreeViewDeps.anchor: DocsAnchor;` replaces `keysFor` and
           `kbd`; `TreeView.keysChanged` is removed; `TreeView.dispose(): void` disposes the tree's anchors
           in `src/plugins/docs/page/doc-view.ts`: `DocViewDeps.anchor: DocsAnchor;` replaces `conflictText` and
           `emptyHint`; `DocView.keysChanged` is removed
           in `src/plugins/docs/page/docs-dialogs.ts`: `DocsDialogsDeps.anchor: DocsAnchor;` replaces `keysFor`;
           `DocsDialogs.keysChanged` is removed; `DocsDialogs.dispose(): void` disposes the dialogs' anchors

Decisions: placements the user approved (interview 2026-10-27): the tree header shows `/ filter  a new  A file
           R rescan  c folder`; the cursor row shows `s star  r rename  d trash`; the split edge shows `⌥L doc ›`
           and `‹ tree ⌥H`; the doc header shows `i edit`; the conflict, trash and no-place prompts draw their
           keys as Kbd through anchors instead of plain text; Docs mode's tree in the side bar and a session
           Docs tab's split are both covered · a hint shows only in its anchor's scope (plan.md Decisions) ·
           vim's own keys need no anchor (plan.md Decisions) · each anchor element is made once for the life of
           its view and moved on a redraw, never named again (drafter: task 01's keys plugin redraws every anchor
           on a keymap change, so the views' `onKeysChanged` follow goes) · `c folder` shows in a session view
           too, where `c` toasts that the session's own load states are used: the key fires there (drafter) ·
           the cursor prompt shows on a leaf row only; on a group row `s`, `r` and `d` do nothing or refuse
           (drafter) · the `i edit` hint has `hidden` while the open doc is read-only or its editor is open
           (drafter: `i` refuses on a read-only doc, and inside the editor `i` is vim's) · the edge prompts sit
           inside the view's panes: `⌥L doc ›` at the tree header's end, `‹ tree ⌥H` pinned to the doc pane's
           top start corner, so one placement serves the side bar and the split (drafter) · the start edge reads
           `‹ tree ⌥H`: `keyPrompt` draws the keys and then the label, so `‹ tree` is a `span.ui-key-chevron`
           (task 01) that the view places before the `docs.focusTree` anchor element, which shows keys only;
           `⌥L doc ›` is the `docs.focusDoc` anchor with label `doc`, then a `›` chevron element after it;
           task 01's rule hides each chevron while its anchor is hidden (drafter) · the Trash question becomes a dialog with
           two buttons, Keep it (`docs.confirmNo`) and Move to the Trash (danger, `docs.confirmYes`), each with
           its key as a control hint, so the keys sit on the buttons they press (user: dialogs put each key on
           the button it runs) · the no-place message stays a toast, which holds text only: its text drops the
           keys and reads `No place holds a <kind> yet; create a file by path`, and the tree header's `A file`
           shows the key in the pane focus returns to (drafter) · the empty-state lines keep a key through an
           anchor (DESIGN.md § Surfaces, Empty states): an empty index ends in `R to rescan`; a filter matching
           nothing, and the filtered line above the rows, end in `/ to change it` (drafter: the old `/ then ⎋ to
           clear it` mixed a tree key and a box key in one sentence, and each anchor shows in one scope only)
           · task 01's contract for wave 2: a command counts as placed once the page load named an anchor for
           it in its scope, a disposed anchor included, and the view puts nothing in an anchor element

### Binds and anchors

Every scope Docs owns, from `src/plugins/keymap.ts` § Docs. Labels in quotes are pinned copy.

| Scope | Keys | Command | Anchor: element, options |
|---|---|---|---|
| `docs.tree` | `/` | `docs.filter` | tree header (box hint); `{ scope: 'tree', label: 'filter' }` |
| `docs.tree` | `a` | `docs.createByKind` | tree header; `{ scope: 'tree', label: 'new' }` |
| `docs.tree` | `A` | `docs.createByPath` | tree header; `{ scope: 'tree', label: 'file' }` |
| `docs.tree` | `R` | `docs.rescan` | tree header; `{ scope: 'tree', label: 'rescan' }` |
| `docs.tree` | `c` | `docs.pickContext` | tree header; `{ scope: 'tree', label: 'folder' }` |
| `docs.tree` | `s` | `docs.toggleStar` | cursor row's trailing end (cursor prompt); `{ scope: 'tree', label: 'star' }` |
| `docs.tree` | `r` | `docs.rename` | cursor row's trailing end; `{ scope: 'tree', label: 'rename' }` |
| `docs.tree` | `d` | `docs.trash` | cursor row's trailing end; `{ scope: 'tree', label: 'trash' }` |
| `docs.tree` | `<A-l>` | `docs.focusDoc` | tree header's end (edge prompt, a `›` chevron element after it); `{ scope: 'tree', label: 'doc' }` |
| `docs.tree` | `j k gg G l <CR> h <C-j> <C-k> <C-S-j> <C-S-k>` | tree and scroll commands | vim |
| `docs.tree` | `R`, `/` again | `docs.rescan`, `docs.filter` | the empty-state lines also anchor these (above) |
| `docs.doc` | `<A-h>` | `docs.focusTree` | doc pane's top start corner (edge prompt, a `‹ tree` chevron element before it); `{ scope: 'doc' }`; the empty state's hint anchors it too, keys only |
| `docs.doc` | `i` | `docs.edit` | doc header's end (box hint); `{ scope: 'doc', label: 'edit' }` |
| `docs.doc` | `<Esc> j k <C-j> <C-k> <C-S-j> <C-S-k>`, box `<Esc>` | | vim |
| `docs.conflict` | `r` | `docs.conflictReload` | conflict prompt; `{ scope: 'conflict', label: 'reload' }` |
| `docs.conflict` | `o` | `docs.conflictOverwrite` | conflict prompt; `{ scope: 'conflict', label: 'overwrite' }` |
| `docs.conflict` | `<Esc>` | `docs.conflictCancel` | vim; anchored in the conflict prompt as today; `{ scope: 'conflict', label: 'cancel' }` |
| `docs.picker` | `j k <CR> l <Esc>` | picker commands | vim; no anchor |
| `docs.box` | `<Tab>` | `docs.boxComplete` | under the path box (box hint); `{ scope: 'box', label: 'complete' }`; `hidden` while the open request has `completes: false` |
| `docs.box` | `<CR> <Esc>` | `docs.boxAccept` `docs.boxCancel` | vim |
| `docs.confirm` | `y` | `docs.confirmYes` | inside Move to the Trash (control hint); `{ scope: 'confirm' }` |
| `docs.confirm` | `n` | `docs.confirmNo` | inside Keep it (control hint); `{ scope: 'confirm' }` |
| `docs.confirm` | `<Esc>` | `docs.confirmNo` | vim |
| `any` | `<Leader>kd` `<Leader>vt` | `docs.showMode` `docs.toggleTree` | leader |

### What changes, by file

- `start.ts`: `createView` hands `anchor: (element, command, options) => keys.anchor(element,
  qualify(docsManifest.id, command), { ...options, scope: qualify(docsManifest.id, options.scope) })` in
  place of `keysFor`, `onKeysChanged` and `kbd`. The `kbd` import goes.
- `tree-view.ts`: the pane gains a header (`div.docs-tree-header`) above the status line: the five box hints
  in the order of the table, then the `⌥L doc ›` edge prompt at its end. One cursor prompt element
  (`span.docs-row-actions`, its three anchors in the order `s`, `r`, `d`) is made once; `rowElement` appends
  it at the end of the selected leaf row's trailing part, after the time and status dot, and a selected
  group row gets none. The tree line's hint is one anchor element and a words span; replacing the line
  disposes the old line's anchor. `isSamePart` and the `kbd` parameter of `hintElement` and `lineElement`
  go. The `docs-tree` grid rows in `docs.css` gain one `auto` row for the header.
- `doc-view.ts`: the empty state's hint is an anchor element made once (`docs.focusTree`, keys only). The
  header gains the `i edit` anchor element at its end. The conflict prompt holds the text `File changed on
  disk` and three anchor elements, made once; `showConflict` only shows the prompt. The pane gains the
  `‹ tree ⌥H` edge element. `dispose` disposes every anchor the doc pane named.
- `docs-dialogs.ts`: `createTextBox` takes `anchor` and makes the `⇥ complete` hint once, under the frame.
  `createConfirm` draws Keep it and Move to the Trash into `dialog.actions` once, each running its answer
  and holding its anchor element as `hint`; `Confirm.open` takes the question as a string, and
  `refreshText` goes. `pickPlace` toasts `noPlaceText(kindTitle)`.
- `docs-view.ts`: hands `anchor` to the tree, doc and dialogs; the `conflictText` and `emptyHint` deps go;
  the `keysChange` follow goes; `dispose` calls the tree's and dialogs' `dispose`.
- `docs-state.ts`: the Produces changes; `treeLine` returns these lines, with the texts unchanged:
  empty index → `hint: { command: 'rescan', words: 'to rescan' }`; a filter matching nothing →
  `hint: { command: 'filter', words: 'to change it' }`; the filtered line above the rows →
  `hint: { command: 'filter', words: 'to change it' }`. `trashQuestion` returns the question alone.
- `docs.css`: styles `.docs-tree-header`, `.docs-row-actions`, `.docs-edge`, `.docs-edge--start`,
  `.docs-edge--end` and the box hint line, with existing tokens only. No rule changes the order inside
  `.ui-key-prompt`.

GIVEN Docs mode shows with the tree focused WHEN the tree draws THEN its header shows `/ filter  a new  A file
R rescan  c folder` and `⌥L doc ›`, and the selected leaf row ends in `s star  r rename  d trash`
GIVEN the doc pane has focus WHEN a doc is open THEN the doc header ends in `i edit`, the pane shows
`‹ tree ⌥H`, and the tree's header hints and cursor prompt hide, keeping their space
GIVEN a session's Docs tab shows WHEN its tree has focus THEN the same header, cursor prompt and edge prompt
show in the split's start pane
GIVEN the open doc is read-only WHEN its header draws THEN `i edit` does not show
GIVEN the editor's file changes on disk WHEN the conflict prompt shows THEN it reads `File changed on disk`
followed by `r reload  o overwrite  ⎋ cancel`, each key a Kbd
GIVEN `d` on a leaf WHEN the Trash dialog opens THEN it shows the question `Move a.md to the Trash?` and the
buttons Keep it `n` and Move to the Trash `y`; a click on either answers as the key does
GIVEN no place holds a learning WHEN `a` picks learning THEN the toast reads
`No place holds a learning yet; create a file by path`
GIVEN the path box opens WHEN it completes paths THEN `⇥ complete` shows under it; the name box shows no hint

Tests:     in `docs-state.test.ts` (each test builds its own state and targets):
           `conflictText_AllBound_EachAnswerWithKeys` and `conflictText_UnboundAnswer_DropsOut` — deleted with
           `conflictText` ·
           `trashQuestion_OneTarget_QuestionAlone` (replaces `trashQuestion_Keys_AfterQuestion`) —
           `trashQuestion(['/h/a.md'], '/h', posixPaths)` is `Move a.md to the Trash?` ·
           `trashQuestion_TwoTargets_NamesLink`, `trashQuestion_ThreeTargets_NamesLinks`,
           `trashQuestion_WindowsLinkAndTarget_TildePaths` — the same targets as today, the `keys` argument
           dropped, each expecting the question alone (today's string with any trailing ` y/n` removed) ·
           `noPlaceText_NamesKind` (replaces `noPlaceText_CreateByPathBoundOrNot`) — `noPlaceText('learning')`
           is `No place holds a learning yet; create a file by path` ·
           `treeLine_EmptyIndex_RescanHint` — `{ placement: 'empty', text: 'No docs in this index', hint:
           { command: 'rescan', words: 'to rescan' } }` ·
           `treeLine_FilterMatchesNothing_ChangeHint` (renames `…_ClearHint`) — for the filter box closed and
           open, `{ placement: 'empty', text: 'No docs match "<filter>"', hint: { command: 'filter', words:
           'to change it' } }` ·
           `treeLine_FilterWithRows_FilteredAbove` — `{ placement: 'above', text: 'Filtered: <filter>', hint:
           { command: 'filter', words: 'to change it' } }` ·
           `treeLine_BeforeFirstTree_Null`, `treeLine_FilterBoxOpenWithRows_Null`, `treeLine_NoFilterWithRows_Null`
           — unchanged but for the dropped `keys` argument ·
           `treeLine_KeyUnbound_TextAlone` — deleted: an unbound key is the anchor's case (task 01) ·
           the header, cursor prompt, edges, prompts and dialogs are looks: task 12 (Final verification)
           checks them on screen, in Docs mode and in a session's Docs tab

Done when: typecheck and lint pass; `grep -rn "keysFor\|onKeysChanged\|kbd(" src/plugins/docs/page --include='*.ts'`
           prints no line outside test files; the test gate runs the tests above
Commit:    one commit for the group: "Docs names key anchors on its tree, doc pane and dialogs, and drops keys from its sentences"

### Concerns for the lead

- None outside this task's files. The pickers use `createListPicker` unchanged: every `docs.picker` bind is vim's.

## Proof

Commit 504589a · proof: diff read, Produces present; typecheck clean in docs files · concerns: tree pane grid auto-placement: hidden children drop out, so the rows list may miss its minmax(0,1fr) track (pre-existing)
