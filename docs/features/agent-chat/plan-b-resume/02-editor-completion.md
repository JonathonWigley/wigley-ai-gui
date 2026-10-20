# 02 — Editor completion option

Status: not started
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     modify `src/contracts/editor.ts` · modify `src/renderer/codemirror-vim/codemirror-vim-host.ts` ·
           modify `src/renderer/codemirror-vim/editor-theme.ts` · create `src/renderer/codemirror-vim/prefix-completion.ts` ·
           modify `package.json` · modify `package-lock.json` · modify `scripts/check-layers.mts` ·
           test `src/renderer/codemirror-vim/prefix-completion.test.ts`
Consumes:  in the tree: `EditorHost`, `EditorEvents`, `TextEditor`, `CreateEditorHost` (`src/contracts/editor.ts`);
           `createCodeMirrorVimHost`, `editorExtensions(events, leaving)`, `vimEditorOf` (`codemirror-vim-host.ts`);
           `editorTheme`, `colour(token)` (`editor-theme.ts`); the `LAYERS` entry `'src/renderer/codemirror-vim'`
           (`scripts/check-layers.mts`); `@codemirror/autocomplete` 6.20.3 in `node_modules` (plan.md Preconditions)
Produces:  in `src/contracts/editor.ts`:
           ```ts
           // While the editor is in insert mode and the text from the document's start to the cursor is `prefix`
           // followed by no whitespace, offers the `words()` that start with the text typed after `prefix`, ignoring
           // case, in the order `words()` gives them. Accepting one replaces that text with `prefix`, the word and
           // one space. `offered` hears the offered words each time the list changes while it is open; `accepted`
           // hears the word accepted.
           export interface EditorCompletions {
             prefix: string;
             words(): readonly string[];
             offered(words: readonly string[]): void;
             accepted(word: string): void;
           }
           export interface EditorOptions { completions?: EditorCompletions }
           ```
           `create(parent: HTMLElement, doc: string, events: EditorEvents, options?: EditorOptions): TextEditor;` on
           `EditorHost`, replacing today's three-parameter `create`
           in `src/renderer/codemirror-vim/prefix-completion.ts`:
           `export interface PrefixMatch { from: number; to: number; words: string[] }`
           `export function prefixMatch(textBeforeCursor: string, prefix: string, words: readonly string[]): PrefixMatch | null`
           `"@codemirror/autocomplete": "6.20.3"` in `package.json` `dependencies` and in `package-lock.json`
           `packages[""].dependencies`
Decisions: the user approved `@codemirror/autocomplete` 6.20.3 as a direct dependency pinned exactly; it is already on
           disk as `codemirror`'s dependency, so this task adds the two lines by hand and runs no `npm install`; the
           lockfile's `node_modules/@codemirror/autocomplete` entry (version `6.20.3`, its `resolved` and `integrity`)
           stays byte for byte. If any npm command would download or change another package, stop and ask the user ·
           both lines sit in alphabetical order among the existing dependencies (before `@modelcontextprotocol/server`) ·
           `scripts/check-layers.mts`: `'@codemirror/autocomplete'` joins the `packages` of `'src/renderer/codemirror-vim'`
           only · no import of `@codemirror/view` or `@codemirror/state` (not direct dependencies): keys go through
           `EditorView.domEventHandlers` from `codemirror` ·
           `prefixMatch`: null when `textBeforeCursor` does not start with `prefix`, when the text after `prefix` holds
           any whitespace (`/\s/`, newlines included), or when no word matches; otherwise `from: 0`,
           `to: textBeforeCursor.length`, `words` = the words starting with the typed text compared lower-cased, in
           input order, a repeated word kept once ·
           the host adds completion only when `options.completions` is given, so forms' boxes are unchanged: the
           extension is `autocompletion({ override: [source], defaultKeymap: false, icons: false })`, placed ahead
           of `vim(...)` in `editorExtensions`' list so its keys run first; `source` returns null unless vim is in
           insert mode (`cm.state.vim.insertMode`) and `prefixMatch` returns a match, else `{ from, to, filter: false,
           options }` with each option's `label` `prefix + word` and an `apply` function that dispatches
           `insertCompletionText(state, prefix + word + ' ', from, to)` with the `pickedCompletion` annotation (so the
           popup closes) and then calls `accepted(word)` ·
           `offered(words)` runs from the source when its non-null word list differs from the last list reported
           since the popup last closed (a closed popup resets it), so `/`, `f`, `a` offering one list reports once ·
           keys while the popup is open (`completionStatus(view.state) === 'active'`), in a keydown handler that
           calls `preventDefault` on a key it handles: `Tab` → `acceptCompletion`; `Ctrl+n` and `ArrowDown` →
           `moveCompletionSelection(true)`; `Ctrl+p` and `ArrowUp` → `moveCompletionSelection(false)`. Every other key,
           Enter included, goes on as today (plan A: Enter in insert mode adds a line; the newline then ends the
           match and the popup closes). With the popup closed the handler handles nothing ·
           the popup keydown handler (Tab, Ctrl+n, Ctrl+p, arrows) is its own `EditorView.domEventHandlers` extension,
           placed ahead of `vim(...)` beside `autocompletion(...)`, so the popup keys run before vim's ·
           leaving insert mode (the host's `vim-mode-change` listener reporting a mode other than `insert`) runs
           `closeCompletion(view)` · `editor-theme.ts` styles `.cm-tooltip.cm-tooltip-autocomplete` with
           `bg.pane` background, a `1px solid` `border` border, `editor.fg` text and the editor's mono font, and its
           selected option `& > ul > li[aria-selected]` with `surface.selected` background and `editor.fg` text
GIVEN `prefixMatch('/', '/', ['model', 'compact'])` THEN `{ from: 0, to: 1, words: ['model', 'compact'] }`
GIVEN `prefixMatch('/mo', '/', ['model', 'compact'])` THEN `{ from: 0, to: 3, words: ['model'] }`
GIVEN `prefixMatch('/MO', '/', ['model'])` THEN `{ from: 0, to: 3, words: ['model'] }`
GIVEN `prefixMatch('/wigley:f', '/', ['wigley:feature', 'wigley:make'])` THEN `words: ['wigley:feature']`
GIVEN `prefixMatch('/m', '/', ['model', 'model', 'mcp'])` THEN `words: ['model', 'mcp']`
GIVEN `prefixMatch('/mo x', '/', ['model'])`, `prefixMatch('/mo\n', '/', ['model'])`, `prefixMatch('hi /mo', '/',
      ['model'])`, `prefixMatch('', '/', ['model'])` or `prefixMatch('/zz', '/', ['model'])` THEN `null`
GIVEN the edited `package.json` and `package-lock.json` WHEN `git diff --stat -- package.json package-lock.json` runs
      THEN each shows exactly one added line, and `npm ls @codemirror/autocomplete` lists `@codemirror/autocomplete@6.20.3`
      at the top level
Tests:     `src/renderer/codemirror-vim/prefix-completion.test.ts`:
           `prefixMatch_PrefixAlone_OffersEveryWord`, `prefixMatch_TypedText_KeepsWordsStartingWithIt`,
           `prefixMatch_IgnoresCase`, `prefixMatch_NamespacedWord_Matches`, `prefixMatch_RepeatedWord_KeptOnce`,
           `prefixMatch_NotAtStartOrHasWhitespaceOrNoMatch_ReturnsNull` (the five inputs above, each asserted `null`)
           — each with the values above. The popup, its keys inside vim and its look are live checks (task 09) and
           the chat self-test steps (task 07): CodeMirror needs a DOM, and Vitest runs in `node`
Done when: the typecheck and `npm run lint` pass; the diff and `npm ls` check above hold; the test gate runs the tests above
Commit:    one commit for the group

## Proof
