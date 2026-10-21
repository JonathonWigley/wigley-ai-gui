# 05 — Document editor

Status: in progress
Type: Task
Wave: 3 · Depends on: 02
Plan: [plan.md](plan.md)

Files:
- modify `src/contracts/editor.ts`
- modify `src/renderer/codemirror-vim/codemirror-vim-host.ts`, `src/renderer/codemirror-vim/editor-theme.ts`
- create `src/renderer/codemirror-vim/document-ex-commands.ts` · test
  `src/renderer/codemirror-vim/document-ex-commands.test.ts`
- modify `src/plugins/forms/page/editor-boxes.test.ts` (its hand-built `EditorHost` gains `createDocument`)

Consumes:
- `findLanguageByFile(fileNameOrPath: string): LanguageDescription | null`,
  `loadLanguage(language: LanguageDescription): Promise<LanguageSupport>` in
  `src/renderer/codemirror-vim/languages.ts` ← 02
- `syntax.css` and its `tok-*` rules, loaded by `codemirror-highlighter.ts` ← 02
- `LAYERS` packages for `src/renderer/codemirror-vim` (`@codemirror/language`, `@codemirror/state`,
  `@codemirror/view`, `@lezer/highlight`) ← 01
- `TextEditor`, `EditorHost`, `VimMode`, `FocusOptions` in `src/contracts/editor.ts`; `createCodeMirrorVimHost`, its
  `hosted` list, `PendingKeys`, `vimEditorOf`, `redrawCursorOnResize`, `editorTheme` (tree)
- agent chat plan A's scoped editor binds (landed, `e0afe84`): `EditorBind.scope` and `EditorBind.mode` in
  `src/contracts/keymap.ts`; the host's one ex command per normal-mode key group (an insert-mode group maps a vim action
  of the same name, `<CR>` only), named `exBindName(index: number): string` in
  `src/renderer/codemirror-vim/ex-command-name.ts` (`wigleybind` + the index's digit words: `0` → `wigleybindzero`,
  `12` → `wigleybindonetwo`), whose binds in force the composition root picks through the `run` callback of
  `CreateEditorHost`

Produces (exactly as plan.md's File Structure):

```ts
// src/contracts/editor.ts
export interface DocumentOptions { fileName: string; readOnly: boolean; line: number; }
export interface DocumentEditorEvents {
  changed(text: string): void;
  write(): void;               // :w
  quit(force: boolean): void;  // :q, :q!
  writeQuit(): void;           // :wq, :x
  modeChanged(mode: VimMode): void;
}
export interface DocumentEditor extends TextEditor {
  setText(text: string): void;   // replaces the whole text, keeping the cursor line where it can
  goToLine(line: number): void;  // 1-based
}
// EditorHost gains
createDocument(parent: HTMLElement, doc: string, options: DocumentOptions, events: DocumentEditorEvents): DocumentEditor;

// src/renderer/codemirror-vim/document-ex-commands.ts
export type DocumentExEvent =
  | { kind: 'write' }
  | { kind: 'quit'; force: boolean }
  | { kind: 'writeQuit' };
// Each ex command a document editor answers: vim's full name and the shortest prefix that runs it.
export const DOCUMENT_EX_COMMANDS: readonly { name: string; prefix: string }[];
// The event an ex command `name` from DOCUMENT_EX_COMMANDS raises, given the text vim read after the name.
export function documentExEvent(name: string, argString: string | undefined): DocumentExEvent;
// Whether an ex name equals a DOCUMENT_EX_COMMANDS name or prefix.
export function documentExClash(exName: string): boolean;
```

Decisions:

- **Separate from the box editor** (design.md § Core services and seams, Document editor: "load text, go to line,
  read-only, the file's language, and `:w` / `:q` / `:wq` / `:q!` as save and close events. Form boxes keep their
  small interface"). `create` and `EditorEvents` do not change.
- **Extensions**, in this order: `vim({ status: true })`, `minimalSetup`, `lineNumbers()` (`@codemirror/view`),
  `EditorView.lineWrapping`, `EditorState.readOnly.of(options.readOnly)` (`@codemirror/state`), a `Compartment`
  holding the language (empty until it loads), `syntaxHighlighting(classHighlighter)` (`@codemirror/language`,
  `@lezer/highlight`; it replaces `minimalSetup`'s fallback `defaultHighlightStyle`), `editorTheme`,
  `EditorView.editorAttributes.of({ class: 'wg-document-editor' })`, the update listener reporting `changed`, and
  the same blur handler the box editor has (it drops unfinished keys through `PendingKeys.discardIn`).
- **Language** (design.md: "The editor highlights markdown, JSON, TOML and YAML by file extension"):
  `findLanguageByFile(options.fileName)`; when found, `loadLanguage` and then reconfigure the compartment with the
  support. A markdown file therefore gets GFM with fenced-code languages (02's `loadLanguage`). An editor destroyed
  before its language loads ignores the result. No language found: plain text, no error.
- **Read-only**: the `EditorState.readOnly` facet. `@replit/codemirror-vim` 6.4.0's adapter drops every edit it
  dispatches when `view.state.readOnly` is true (`dispatchChange`: `if (view.state.readOnly) return;`, verified in
  the published `dist/index.js`), and CodeMirror blocks typed input under the same facet. `setText` still replaces
  the text (it dispatches directly). Ex events fire in a read-only editor too; the docs view decides what a write
  means there.
- **Start line and goToLine**: `line` is 1-based and clamped to `1 … doc.lines`. The cursor goes to that line's
  start and the view scrolls it to the top (`EditorView.scrollIntoView(pos, { y: 'start' })`), matching plan.md's
  "`i` … swaps to the document editor at the top visible line".
- **setText** is already on `TextEditor` (a box editor's, which dispatches `replaceText` and keeps focus and the vim mode); a
  document editor's refines it. It replaces the whole text in one transaction and puts the cursor at the start of the line it was on,
  clamped to the new line count. It does not report `changed`: `changed` reports only the user's edits, as
  `EditorEvents.changed` does (the transaction carries the `HOST_REPLACE` user event the update listener skips, as the host's `replaceText` does for a
  box).
- **Look**: document editors fill their parent's height and scroll inside (`'&.wg-document-editor': { height:
  '100%' }`). `editorTheme` gains gutter colours shared by every editor that shows a gutter: `.cm-gutters`
  background `editor.bg`, text `editor.gutter`, no border. Spacing is the implementer's choice, checked live.
- **Hosted like a box**: a document editor joins the host's `hosted` list (entries `{ view, editor }`), so `contains`, `typeInto`, pending-key
  reports, focus handling (`leaveFocusedEditor`) and `destroy` treat it exactly as a box. `focus(options)` and
  `blur()` behave as the box's. Agent chat's editor binds therefore apply to document editors too: the bind in force for
  the current scope runs with this `DocumentEditor` as the context's `editor` (task 07 sets the scope while
  editing).
- **Ex commands** (`@replit/codemirror-vim` 6.4.0 bundles its vim engine from `@replit/codemirror-vim-core` 0.1.0;
  verified in that package's published `vim.js`): its default ex map has `write` (prefix `w`), whose handler calls
  `CodeMirror.commands.save`, which the 6.4.0 adapter leaves `undefined`; it has no `quit`, `wq` or `xit`. The
  dispatcher reads the name with `/^(\w+|!!|@@|[!#&*<=>@~])/`, so `:q!` arrives as name `q` with `argString` `!`;
  it resolves a typed name by trying its longest prefix in the command map first, and accepts a hit only when the
  typed name is a prefix of the command's full name (so `:wq` needs its own entry, or `w` would catch it and fail).
  `Vim.defineEx(name, prefix, fn)` sets `exCommands[name] = fn` and `commandMap_[prefix]`, replacing a default.
  So `DOCUMENT_EX_COMMANDS` is, in this order: `{ write, w }`, `{ quit, q }`, `{ wq, wq }`, `{ xit, x }`.
  `documentExEvent`: `write` → `{ kind: 'write' }`; `quit` → `{ kind: 'quit', force }` where `force` is true when
  `argString`, trimmed, starts with `!`; `wq` and `xit` → `{ kind: 'writeQuit' }` (a `!` after them changes
  nothing). The host defines each once, at creation, through `Vim.defineEx(name, prefix, (cm, params) => …)`; the
  handler finds the hosted document editor whose `getCM(view) === cm` (as `hostedEntryOf` finds a box) and calls
  its `events.write()`, `events.quit(force)` or `events.writeQuit()`. Run in a box editor, the four do nothing:
  `:w` in a form box saves nothing today and stays so.
- **No ex name clash**: the host names each key group's ex command `exBindName(i)`. The host adds no runtime check: the `wigleybind` stem cannot equal any `name` or
  `prefix` in `DOCUMENT_EX_COMMANDS` (`write`, `w`, `quit`, `q`, `wq`, `xit`, `x`). `documentExClash(exName)` (true
  when `exName` equals one of them) exists for the test `no bind ex name clashes`, which fails if a later change to
  `exBindName` would replace `:w` or `:q`.
- `editor-boxes.test.ts`'s fake host (its only hand-built `EditorHost`) gains `createDocument: () => { throw new Error('not used by forms'); }` so it
  still satisfies `EditorHost`.

GIVEN a document editor WHEN the user types `:w` and Enter THEN its `write` event fires once
GIVEN a document editor WHEN the user types `:q!` THEN `quit(true)` fires; `:q` fires `quit(false)`
GIVEN a document editor WHEN the user types `:wq` or `:x` THEN `writeQuit` fires
GIVEN a form box WHEN the user types `:w` THEN no document editor hears it and nothing happens
GIVEN `readOnly: true` WHEN the user presses `dd` THEN the text is unchanged
GIVEN `line: 40` WHEN the editor opens THEN line 40 sits at the top with the cursor on it
GIVEN `README.md` WHEN the editor opens THEN markdown highlights, with a `ts` fence inside it highlighted as TypeScript

Tests:

`src/renderer/codemirror-vim/document-ex-commands.test.ts`:
- `maps each command to its event` — `documentExEvent('write', undefined)` is `{ kind: 'write' }`;
  `('quit', undefined)` is `{ kind: 'quit', force: false }`; `('wq', undefined)` and `('xit', undefined)` are
  `{ kind: 'writeQuit' }`.
- `reads a bang as forced quit` — `('quit', '!')` and `('quit', ' !')` are `{ kind: 'quit', force: true }`;
  `('quit', '')` is `force: false`.
- `ignores a bang on write-and-quit` — `('wq', '!')` is `{ kind: 'writeQuit' }`.
- `finds an ex name clash` — `documentExClash` is true for `w`, `write`, `q`, `wq`, `xit` and `x`; false for
  `wigleybindzero` and `wr`.
- `no bind ex name clashes` — `documentExClash(exBindName(i))` is false for every `i` from 0 to 99.

The editor itself needs a browser DOM, which the Vitest suite does not run (`environment: 'node'`): the ex keys, the
document editor's open and close and read-only are self-test steps in [09-selftest.md](09-selftest.md) (`:w`, `:q`
refused with edits, `:q!`, `:wq`), and its look — gutter, line numbers, highlighting, scroll to the start line — is
in [11-final-verification.md](11-final-verification.md).

Done when: `npm run typecheck`, `npm run lint` and `npm test` pass; the existing self-test passes (form boxes behave
as before, `:w` in a box does nothing).

Commit: one commit for the group — `Document editor: full-file vim editor with line numbers, the file's language,
read-only, and :w :q :q! :wq :x as events`

## Proof

