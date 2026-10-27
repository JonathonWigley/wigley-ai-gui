# 09 — Backlog and Notes

Status: done
Type: Batch
Wave: 2 · Depends on: 01
Plan: [plan.md](plan.md)

**Contents**

- **Intent** — what this task lands.
- **Fields** — Files, Consumes, Produces, Decisions, Binds and anchors, behaviour, Tests, Done when, Commit.
- **Notes, when its page part exists** — the conditional step.
- **Proof** — written by `wigley:make`.

## Intent

Every Backlog key shows on the thing it acts on: the list's header and cursor row, the split edge between
the list and the detail, the detail's header, the empty states and the follow-up editor. Backlog stops
reading `keysFor` and drawing Kbd itself. When the notes plugin's page part exists at run time, its binds
get anchors by the same four placement kinds. Task 01 changes `createConfirmPrompt` to take `anchor`
through `ConfirmKeys`; `backlog-view.ts` already passes `keys: deps.keys`, typed `KeysPageExports`, so the
delete and discard prompts' buttons carry their keys through task 01's anchors. The one edit to the prompt deps
here removes `onBaseChanged: () => undefined`, which task 01 makes optional.

## Fields

Files:     modify `src/plugins/backlog/page/backlog-view.ts` · modify `src/plugins/backlog/page/followup-editor.ts` ·
           modify `src/plugins/backlog/page/backlog-state.ts` · test `src/plugins/backlog/page/backlog-state.test.ts` ·
           modify `src/plugins/backlog/page/start.ts` · modify `src/plugins/backlog/page/backlog.css` ·
           when `src/plugins/notes/page/` exists at run time: modify the files under `src/plugins/notes/page/`
           that draw the popup, the title box, the markup toolbar, the picker and the discard confirm, and
           `src/plugins/notes/manifest.ts` only if its `dependsOn` lacks `keys`

Consumes:  `KeysPageExports.anchor(element: HTMLElement, command: CommandId, options?: AnchorOptions): Disposable` ← 01
           `AnchorOptions { scope?: ViewScope; where?: HintWhere; label?: boolean | string }` ← 01
           the `is-hint-hidden` class the keys plugin sets on a hidden anchor ← 01
           `ConfirmKeys { anchor(element: HTMLElement, command: CommandId, options?: { scope?: ViewScope }): Disposable }`
           in `src/shared/page/confirm-prompt.ts` ← 01 ·
           `ConfirmPromptDeps.onBaseChanged` optional: `onBaseChanged?(): void` ← 01 ·
           the class `ui-key-chevron` ← 01 ·
           `headerEnd?: HTMLElement | null` and `cursorEnd?(item: T): HTMLElement | null` on
           `ListPickerRequest<T>` in `src/shared/page/list-picker.ts` ← 01 (the notes step only)
           existing: `qualify`, `BacklogRow`, `BacklogCommand`, `emptyState`, `sectionHeader`, `row`

Produces:  in `src/plugins/backlog/page/backlog-state.ts`:
           `export type CursorCommand = 'edit' | 'delete' | 'toggleAgentReady' | 'pickTag' | 'openInDocs';`
           `export function cursorCommands(row: BacklogRow): readonly CursorCommand[];`
           in `src/plugins/backlog/page/followup-editor.ts`:
           `FollowupEditorDeps.hints: HTMLElement;` — the footer's content, appended once (was `hints(): HTMLElement[]`)
           `FollowupEditorDeps.fieldHint: HTMLElement;` — the `⌃P ⌃N` box hint the editor moves into the active
           box's frame
           `FollowupEditor.redrawHints` is removed
           in `src/plugins/backlog/page/backlog-view.ts`: `BacklogView.keysChanged` is removed; the
           `keyHint` import from `src/shared/page/key-hint.ts` goes

Decisions: the user's rule for this task (interview 2026-10-27): read Backlog's scopes and binds in
           `src/plugins/keymap.ts` and its page part, and place each non-vim, non-leader bind by the four kinds —
           an edge prompt for a navigation chord, a cursor prompt for a row action, a control hint on a button,
           a box hint on a box or a pane header; Notes is covered only when `src/plugins/notes/page/` exists at
           run time · a hint shows only in its anchor's scope (plan.md Decisions) · vim's own keys need no anchor;
           a view may still anchor one (plan.md Decisions) · each anchor element is made once for the life of
           the view and moved on a redraw, never named again (drafter: task 01's keys plugin redraws every anchor
           on a keymap change, so `keysChanged` goes) · the list pane gains a header (`div.backlog-list-header`)
           above the filter frame: `/ filter  a new  R rescan  C commit`, then `⌥L detail ›` at its end (drafter:
           these four act on the open home, not one row) · the detail pane gains a sticky header
           (`div.backlog-detail-head`, `position: sticky; top: 0`) above the detail body: `‹ list ⌥H` at its
           start and `o docs` at its end (drafter) · the start edge reads `‹ list ⌥H` by the same rule tasks 07
           and 08 use: `‹ list` is a `span.ui-key-chevron` (task 01) that the view places before the
           `backlog.focusList` anchor element, which shows keys only; `⌥L detail ›` is the
           `backlog.focusDetail` anchor with label `detail`, then a `›` chevron element after it; task 01's
           rule hides each chevron while its anchor is hidden · the cursor prompt is one element
           (`span.backlog-row-actions`) holding five anchors in the order `i edit  d delete  t agent-ready
           T tag  o docs`; each draw moves it to the end of the row that carries `is-cursor`, and sets `hidden`
           on each anchor `cursorCommands` leaves out; with no cursor row it is detached (drafter) · the
           empty states keep their keys through anchors made once: `Open a features home from the side bar.`
           with `backlog.back` (`h`, keys only) and `Nothing is planned here.` with `backlog.create` (`a`, keys
           only), as today (DESIGN.md § Surfaces, Empty states) · the editor's footer becomes
           `⌘↩ save  ⎋ cancel  T tag`, three anchors with labels after the keys, in place of the text-then-Kbd
           parts `Save`, `Cancel`, `Next field`, `Pick a tag`; `⌃P ⌃N` (previous and next field, keys only) moves
           to the active box's frame (DESIGN.md § Keys and focus: a box hint on the focused box's frame) ·
           labels are the drafter's: `filter`, `new`, `rescan`, `commit`, `detail`, `list`, `docs`, `edit`,
           `delete`, `agent-ready`, `tag`, `save`, `cancel` · every `backlog.box` and `backlog.picker` bind is
           vim's, and `backlog.confirm`'s buttons are task 01's `createConfirmPrompt`, so they get no anchor here
           · task 01's contract for wave 2: a command counts as placed once the page load named an anchor for
           it in its scope, a disposed anchor included, and the view puts nothing in an anchor element

### Binds and anchors

From `src/plugins/keymap.ts` § Backlog. Options give the short scope; the view qualifies it as
`qualify('backlog', scope)` and the command as `qualify('backlog', command)`, as its `keysFor` does today.

| Scope | Keys | Command | Anchor: element, options |
|---|---|---|---|
| `backlog.list` | `/` | `backlog.filter` | list header (box hint); scope `list`, label `filter` |
| `backlog.list` | `a` | `backlog.create` | list header; scope `list`, label `new`; also the empty state's hint, keys only |
| `backlog.list` | `R` | `backlog.rescan` | list header; scope `list`, label `rescan` |
| `backlog.list` | `C` | `backlog.commit` | list header; scope `list`, label `commit` |
| `backlog.list` | `<A-l>` | `backlog.focusDetail` | list header's end (edge prompt, a `›` chevron element after it); scope `list`, label `detail` |
| `backlog.list` | `i` | `backlog.edit` | cursor prompt; scope `list`, label `edit` |
| `backlog.list` | `d` | `backlog.delete` | cursor prompt; scope `list`, label `delete` |
| `backlog.list` | `t` | `backlog.toggleAgentReady` | cursor prompt; scope `list`, label `agent-ready` |
| `backlog.list` | `T` | `backlog.pickTag` | cursor prompt; scope `list`, label `tag` |
| `backlog.list` | `o` | `backlog.openInDocs` | cursor prompt; scope `list`, label `docs` |
| `backlog.list` | `h` | `backlog.back` | vim; the no-home empty state's hint, keys only |
| `backlog.list` | `j k gg G l <CR> <C-j> <C-k> <C-S-j> <C-S-k>` | move, open, scroll | vim |
| `backlog.detail` | `<A-h>` | `backlog.focusList` | detail header's start (edge prompt, a `‹ list` chevron element before it); scope `detail`, keys only |
| `backlog.detail` | `o` | `backlog.openInDocs` | detail header's end (box hint); scope `detail`, label `docs` |
| `backlog.detail` | `j k <C-j> <C-k> <C-S-j> <C-S-k>` | scroll | vim |
| `backlog.editor` | `<D-Enter>` | `backlog.save` | editor footer; scope `editor`, label `save` |
| `backlog.editor` | `<Esc>` (page) | `backlog.cancelEdit` | vim; editor footer as today; scope `editor`, label `cancel` |
| `backlog.editor` | `T` (page) | `backlog.pickTag` | editor footer; scope `editor`, label `tag` |
| `backlog.editor` | `<C-p>` | `backlog.previousField` | active box's frame (box hint); scope `editor`, keys only |
| `backlog.editor` | `<C-n>` | `backlog.nextField` | active box's frame, after `<C-p>`; scope `editor`, keys only |
| `backlog.editor` | `<Esc>` (box) | `backlog.leaveBox` | vim |
| `backlog.box` | `<CR> <Esc>` | `backlog.boxAccept` `backlog.boxCancel` | vim |
| `backlog.confirm` | `y n <Esc>` | `backlog.confirmYes` `backlog.confirmNo` | the confirm prompt's buttons ← 01 |
| `backlog.picker` | `j k <CR> l <Esc>` | picker commands | vim |
| `any` | `<Leader>kb` `<Leader>vd` `<Leader>va` | | leader |

### What changes, by file

- `backlog-state.ts`: adds `CursorCommand` and `cursorCommands`: a `followup` row gives `edit`, `delete`,
  `toggleAgentReady`, `pickTag`, `openInDocs`, in that order; a `plan`, `feature` or `task` row gives
  `openInDocs` alone.
- `backlog-view.ts`: the `hint` helper and `keysFor` go, and an `anchor(element, command, scope, label?)`
  helper over `deps.keys.anchor` takes their place. The view makes the list header, the detail header, the
  cursor prompt, the two empty-state hints, the editor footer and the field hint once, at creation.
  `drawRows` places the cursor prompt and hands `emptyState` the kept hint elements; `editorHints` goes.
  `keysChanged` goes from `BacklogView`. `promptDeps` loses `onBaseChanged: () => undefined`; its
  `platform: deps.platform` line stays for task 10.
- `followup-editor.ts`: appends `deps.hints` to the footer once at creation; the `activated` callback also
  moves `deps.fieldHint` into the activated field's frame; `redrawHints` goes.
- `start.ts`: the `keys.onChanged(() => view.keysChanged())` follow goes.
- `backlog.css`: styles `.backlog-list-header`, `.backlog-detail-head`, `.backlog-row-actions`,
  `.backlog-edge`, `.backlog-edge--start`, `.backlog-edge--end` and the field hint, with existing tokens only;
  the `.backlog-list` grid rows gain one `auto` row for the header. No rule changes the order inside
  `.ui-key-prompt`.

GIVEN Backlog mode shows with the list focused WHEN the cursor is on a follow-up THEN its row ends in
`i edit  d delete  t agent-ready  T tag  o docs`, and the list header shows `/ filter  a new  R rescan
C commit` and `⌥L detail ›`
GIVEN the cursor is on a plan, feature or task row THEN its row ends in `o docs` alone
GIVEN the detail has focus THEN the detail header shows `‹ list ⌥H` and `o docs`, and the list's hints and
cursor prompt hide, keeping their space
GIVEN the follow-up editor is open WHEN the One line box is active THEN `⌃P ⌃N` shows on that box's frame,
and the footer shows `⌘↩ save  ⎋ cancel  T tag`
GIVEN no home is open THEN the rows show `Open a features home from the side bar.` with `h`

Tests:     in `backlog-state.test.ts` (each test builds its own row):
           `cursorCommands_Followup_EveryRowAction` — a `followup` row gives
           `['edit', 'delete', 'toggleAgentReady', 'pickTag', 'openInDocs']` ·
           `cursorCommands_Plan_OpenInDocsOnly` — a `plan` row gives `['openInDocs']` ·
           `cursorCommands_Task_OpenInDocsOnly` — a `task` row gives `['openInDocs']` ·
           the headers, edges, cursor prompt and editor hints are looks: task 12 (Final verification) checks
           them on screen

Done when: typecheck and lint pass; `grep -rn "keysFor\|keyHint\|keysChanged\|redrawHints" src/plugins/backlog/page --include='*.ts'`
           prints no line outside test files; the notes step below is done or its check is recorded as not
           met; the test gate runs the tests above
Commit:    one commit for the group: "Backlog names key anchors on its headers, edges, cursor row and editor"
           (when the notes step runs, the message adds "and Notes on its popup, toolbar and picker")

## Notes, when its page part exists

Run `test -d src/plugins/notes/page`. When it exits non-zero, write `notes: no page part at run time` in
this task's Proof and skip this section. When it exits 0:

1. Read every bind whose scope starts with `notes.` in `src/plugins/keymap.ts`, and the notes page files that
   draw each scope's surface. At plan time the notes plan named the scopes `notes.popup`, `notes.title`,
   `notes.markup`, `notes.picker` and `notes.confirm`. That plan folder is deleted when its run closes,
   and its table was written before the code landed, so the keymap file is the source.
2. For each bind that is neither vim's (plan.md Decisions) nor a leader sequence, name an anchor with that
   bind's scope, by kind:
   - a key that runs a button (send, discard, a markup tool, a colour) → a control hint inside that button,
     keys only, in place of any `keysFor`-then-Kbd hint it draws now
   - a key that acts on the selected field, image or row (`t` target, `#` tags, `s` session, `x` remove,
     `i` edit the box) → a cursor prompt at that field's or row's end, with a one-word label
   - a navigation chord (`<C-n>` / `<C-p>` between boxes) → a box hint on the active box's frame, keys only
   - a key that acts on the popup, a box or the picker as a whole (`/` filter in the picker) → a box hint in
     that surface's header, with a one-word label
3. Replace every `keys.keysFor` and `keys.onChanged` use in `src/plugins/notes/page/` with anchors, made
   once and disposed when the popup's view is disposed.
4. When a `notes.picker` bind needs a place in the picker, use task 01's slots: `ListPickerRequest<T>.headerEnd`
   for a key that acts on the whole picker (`/` filter), and `ListPickerRequest<T>.cursorEnd` for a key that acts
   on the cursor row. Make each element once, and hand the same element in each request.
5. List each notes bind and its anchor (element, scope, label) in this task's Proof, so task 10's self-test
   gate can be checked against it.

## Proof

Commit 01e08a9 · proof: diff read, Produces present; typecheck clean in backlog and notes; notes bind table below · concerns: backlog cursor prompt is detached while the detail has focus (no is-cursor row) instead of hidden-keeping-space as the spec's scenario says; Add follow-up ⌘↩ anchor has no scope so it shows while a notes picker is open

Notes binds and their anchors (step 5), for task 10's self-test:

| Scope | Keys | Command | Anchor element · scope · label |
|---|---|---|---|
| notes.popup | `i` | notes.editBox | `span.notes-hint` in `span.notes-cursor-prompt`, moved into the cursor row's `span.notes-row-keys` (title/body rows) · notes.popup · `edit` |
| notes.popup | `x` | notes.remove | same cursor prompt (images row with an image, session row with a session) · notes.popup · `remove` |
| notes.popup | `t` | notes.pickTarget | Target row's `span.notes-row-keys` · notes.popup · `pick` |
| notes.popup | `#` | notes.pickTags | Tags row's `span.notes-row-keys` · notes.popup · `pick` |
| notes.popup | `s` | notes.pickSession | Session row's `span.notes-row-keys` · notes.popup · `pick` |
| notes.popup | `<C-n>` `<C-p>` | notes.nextBox, notes.prevBox | `span.notes-box-hint` in the body frame, `hidden` unless the body box is focused · notes.popup · keys only |
| notes.popup, notes.title | `<D-Enter>` | notes.sendFollowup | inside the Add follow-up button · no scope · keys only |
| notes.popup (leader, optional) | `<Leader>nd` `<Leader>na` `<Leader>ns` | discard, appendFollowup, sendSession | inside their buttons · notes.popup · keys only |
| notes.title | `<Tab>` `<C-n>` / `<C-p>` | notes.nextBox / notes.prevBox | `span.notes-box-hint` in the title frame · notes.title · keys only |
| notes.markup | `s p t a b` | toolSelect, toolPen, toolText, toolArrow, toolBox | inside each tool button · notes.markup · keys only |
| notes.markup | `c` `C` | nextColour, prevColour | `span.notes-markup-keys` after the swatches · notes.markup · keys only |
| notes.markup | `u` `<C-r>` `<Esc>` | undo, redo, closeMarkup | inside Undo, Redo, Done · notes.markup · keys only (Esc is vim's, anchored as before) |
| notes.picker | `/` | notes.pickerFilter | `headerEnd` (one `span.notes-hint`, the same element on every picker request) · notes.picker · `filter` |
| notes.confirm | `y` / `n` | confirmYes / confirmNo | inside the Discard / Keep buttons · notes.confirm · keys only |
| — | j k h l `<CR>` `<Esc>` (popup, title, picker, box) | vim | none |
| any | `<Leader>nn`, popup `<Leader>nf` `<Leader>nc` | leader | none (nf is covered by the sendFollowup anchor) |
