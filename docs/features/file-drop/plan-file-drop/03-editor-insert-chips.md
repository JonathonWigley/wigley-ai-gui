# 03 — Editor insert and file chips

Status: not started
Type: Task
Wave: 2 · Depends on: 02
Plan: [plan.md](plan.md)

Files:     modify `src/contracts/editor.ts` · modify `src/renderer/codemirror-vim/codemirror-vim-host.ts` ·
           create `src/renderer/codemirror-vim/chip-decorations.ts` · test `src/renderer/codemirror-vim/chip-decorations.test.ts` ·
           modify `src/renderer/codemirror-vim/editor-theme.ts` · modify `src/renderer/renderer.ts` ·
           modify (the fakes typecheck rejects — typed `TextEditor`, `EditorHost` or an interface extending one —
           gain `insert` and `charBeforeCursor`): `src/plugins/primer/page/primer-commands.test.ts`,
           `src/plugins/primer/page/primer-view.test.ts`, `src/plugins/forms/page/forms-commands.test.ts`,
           `src/plugins/forms/page/forms-view.test.ts`, `src/plugins/forms/page/round-view.test.ts`,
           `src/plugins/notes/page/popup.test.ts`, `src/shared/page/editor-boxes.test.ts`. Fakes cast with
           `as unknown as` or `{} as` (`backlog-view.test.ts`, `chat-commands.test.ts`, `list-picker.test.ts`,
           `settings-view.test.ts`, `doc-view.test.ts`) compile without the members and stay as they are.
Consumes:  `export function fileChipsIn(text: string, paths: Paths): FileChipRange[];` ← 02 ·
           `export interface FileChipRange { from: number; to: number; path: string; name: string }` ← 02 ·
           `icon(name: string): HTMLElement` (existing, `src/shared/page/ui/icon.ts`) ·
           `Paths` (existing, `src/contracts/paths.ts`)
Produces:  in `src/contracts/editor.ts`:
           `TextEditor.insert(text: string): void;` with plan.md's comment: types `text` at the cursor (replacing a
           selection), keeping focus and the vim mode; reports `changed`
           `TextEditor.charBeforeCursor(): string;` with plan.md's comment: the character just before the point
           `insert` puts text at (in normal mode, the character under the cursor); `''` at the start of the text
           `export interface FileChipDrawing { paths: Paths; fileIcon(): HTMLElement; }`
           `export type CreateEditorHost = (keymap: EditorKeymap, run: (binds: EditorBind[], editor: TextEditor) => boolean, log: Log, chips: FileChipDrawing) => EditorHost;`
           in `src/renderer/codemirror-vim/chip-decorations.ts`:
           `export function fileChipExtension(drawing: FileChipDrawing): Extension` ·
           `export function snapHead(chips: readonly { from: number; to: number }[], previous: number, next: number, lineEnd: number, isInsert: boolean): number` ·
           `export function widenRange(chips: readonly { from: number; to: number }[], from: number, to: number): { from: number; to: number }`
Decisions:
- **How the host gets `Paths`**: `CreateEditorHost` gains a fourth parameter `chips: FileChipDrawing`. `fileIcon`
  is injected because DESIGN.md makes `icon` the one module naming the icon font, and the adapter's layer
  (`src/renderer/codemirror-vim`) may not import `src/shared/page/ui`. The one call site,
  `src/renderer/renderer.ts` (`createCodeMirrorVimHost(...)`), hoists the paths choice
  (`config.platform === 'windows' ? windowsPaths : posixPaths`) into a `const paths` above the host, passes
  `{ paths, fileIcon: () => icon('file') }`, and `services.paths` reads that same `paths`. One file icon for every
  chip, folders included.
- **`insert`** lives in `hostView`'s shared editor, so box and document editors both have it. It dispatches one
  transaction — the change and the new selection together — with `userEvent: 'input.paste'` and
  `scrollIntoView: true`, so `reportUserChanges` reports `changed` once; it never calls `view.focus()`. The
  insertion point and range by vim mode:
  - insert mode: the main selection's range (an empty caret, or a CodeMirror selection it replaces)
  - normal mode: the empty point after the character under the block cursor, as vim's `p`: `head + 1` when the
    cursor sits on a character of its line, `chip.to` when it sits on a chip, `head` on an empty line or an empty
    text
  - visual mode (characterwise, linewise and blockwise alike): `selection.main`'s range only, so one dropped file
    gives one path whatever the visual kind; the insert is dispatched first, then `Vim.exitVisualMode(cm)` (the
    adapter's existing call, as `insertAtEnd` uses it), so vim leaves visual mode for normal over the new document,
    as vim's `p` over a selection does (design § Routing)
  - a read-only document editor: nothing changes and nothing is reported

  The text put in is `text`, plus one trailing space when the character just after the replaced range exists and
  is not whitespace (`/\s/`), so a path never runs into the word after it; the leading space stays
  `insertionText`'s (and `docLinksText`'s) job, through `charBeforeCursor`. Where the cursor ends:
  - insert mode: after the inserted text and its added space
  - normal mode (and visual, once it drops to normal): on the last inserted chip's one character, its `from` as
    `fileChipsIn` finds it in the inserted text (offset by the insertion point); when the text holds no chip, on its
    last character (not the added space)
- **`charBeforeCursor`** lives beside `insert` in `hostView`'s shared editor: the one character before the
  insertion point `insert` would use in the current mode (`doc.sliceString(at - 1, at)`), `''` at 0 — in normal
  mode the character under the cursor, in insert and visual mode the one before `selection.main.from` — so a target
  hands it to `insertionText`. One private helper computes the insertion point for both members. A fake returns
  `''` unless its test needs otherwise.
- **File chips only in boxes**: `boxExtensions` adds `fileChipExtension(chips)`; `documentExtensions` does not.
- **`fileChipExtension`**: decorations rebuilt from `fileChipsIn(doc, drawing.paths)` on every doc change — a
  `Decoration.replace` per range with a widget, the same set handed to `EditorView.atomicRanges`, so CodeMirror's
  own motions step over a chip. Because vim moves and deletes through its own dispatches, a
  `EditorState.transactionFilter` applies the two pure rules below to every transaction except `setText`'s
  (`HOST_REPLACE`) and `insert`'s own (which sets its selection itself):
  - `widenRange` — against the chips of the state before (`fileChipsIn` on `tr.startState.doc`): each changed range
    `tr.changes.iterChangedRanges` gives in the old document whose old side is non-empty — a pure deletion, or a
    replacement such as vim `c`, `r` or a paste over a selection, which deletes its old range too — and in visual
    mode the selection, with an end strictly inside a chip (`chip.from < end < chip.to`) widens to that chip's edge:
    `from` to `chip.from`, `to` to `chip.to`. So `x` on a chip, and Backspace after one, delete it whole.
  - `snapHead` — against the chips of the new document (`fileChipsIn` on `tr.newDoc`), with `previous` the old head
    mapped through `tr.changes` (`tr.changes.mapPos(oldHead)`) and `next` the new head: an empty selection's head
    strictly inside a chip moves to `chip.to` when it moved forward (`next > previous`), else to `chip.from`; except
    in normal mode (`isInsert` false) when `chip.to` is the line's end (`lineEnd`), where it stays at `chip.from`,
    since the chip is then the line's last character. Typing before a chip shifts the chip with the text, so the
    caret never jumps over it.
- **What vim's register holds after `x` on a chip** (Decided): the whole chip is deleted; what the register holds
  is not specified and not tested. Vim computes `x`'s range and fills its register before it dispatches; the
  widening happens afterwards, in the transaction filter, so the register may hold one character of the path. The
  rules above rest on a normal-mode CodeMirror selection being an empty cursor at vim's cursor; check 10 drives
  that live.
- **The chip's look** (DESIGN.md: radii, Colour, Type, Icons): the widget is a `span.wg-file-chip` holding
  `drawing.fileIcon()` and a `span.wg-file-chip-name` with `name`; its `title` is the full path. Styled in
  `editorTheme` with tokens only: `display: inline-flex`, `alignItems: center`, `verticalAlign: middle`, `gap: var(--wg-space-1)`,
  `padding: 0 var(--wg-space-1)`, `borderRadius: var(--wg-radius-sm)` (tags and inline code), `backgroundColor:
  var(--wg-block-background)` (inline code's fill: a path is code-like), `color: var(--wg-fg)`, `whiteSpace:
  nowrap`, the box's own `font-mono`; the icon `color: var(--wg-fg-secondary)` at `icon-size`. No accent, no
  status colour.
- `widget.eq` compares `path`, so an unchanged chip keeps its DOM. `ignoreEvent()` returns `false` (CodeMirror's
  default), so a click on a chip puts the caret at its nearest edge.

GIVEN a Chat box in normal mode holding `look at`, the cursor on the final `t` (where Esc leaves it) WHEN
`insert(insertionText(['/x/y'], charBeforeCursor()))` runs THEN `charBeforeCursor()` returned `t`, the text is
`look at /x/y`, the cursor is on the chip's one character (offset 8), the box is still in normal mode and unfocused
if it was, and `changed` reports once
GIVEN a box in normal mode holding `ab`, the cursor on `a` WHEN `insert(insertionText(['/x/y'], 'a'))` runs THEN
the text is `a /x/y b` (the trailing space is `insert`'s, since `b` follows)
GIVEN a box in visual mode (characterwise, linewise or blockwise) WHEN a file is inserted THEN one path replaces
`selection.main`'s range and the box is in normal mode
GIVEN a box holding `see /Users/me/a.png` WHEN it draws THEN a pill with the file icon and `a.png` replaces the path;
`setText` of the same text draws the same pill
GIVEN the cursor on a chip in normal mode WHEN `x` THEN the whole path is deleted; WHEN `l` THEN the cursor lands on
the character after the chip
GIVEN a document editor (Docs) holding an absolute path THEN it draws no chip
GIVEN a box in insert mode holding `see /Users/me/a.png`, the caret at 0 WHEN the user types `ab` THEN the text is
`absee /Users/me/a.png` and the caret is at 2, not past the chip

Tests:     `chip-decorations.test.ts`, one chip `{ from: 4, to: 20 }` on a line ending at 30 unless the row says:
- `snapHead keeps the cursor off a chip's inside` — rows `(previous, next, lineEnd, isInsert) → head`:
  `(3, 5, 30, false)` → 20 · `(20, 19, 30, false)` → 4 · `(4, 5, 20, false)` → 4 · `(4, 5, 20, true)` → 20 ·
  `(3, 4, 30, false)` → 4 · `(24, 25, 30, false)` → 25
- `widenRange takes a chip whole` — rows `(from, to) → result`: `(4, 5)` → `(4, 20)` · `(19, 20)` → `(4, 20)` ·
  `(2, 6)` → `(2, 20)` · `(10, 12)` → `(4, 20)` · `(0, 3)` → `(0, 3)` · `(3, 25)` → `(3, 25)` · `(20, 22)` → `(20, 22)`
The `insert` modes, the drawn pill, vim stepping over it and typing before it need a live editor (the test
environment is `node` with no CodeMirror view): deferred to "10 — Final verification", checks 1, 3, 8, 9 and 10.

Done when: `npm run typecheck` and `npm run lint` pass; the test gate runs the tests above and the suites of the
           seven fake files listed under Files.
Commit:    one commit for the group

## Proof

