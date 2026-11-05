# 03 — Editor completion: fuzzy items and row drawing

Status: not started
Type: Task
Wave: 2 · Depends on: 01, 02
Plan: [plan.md](plan.md)

Files:     modify `src/contracts/editor.ts` · modify `src/renderer/codemirror-vim/prefix-completion.ts` · modify `src/renderer/codemirror-vim/codemirror-vim-host.ts` · modify `src/renderer/renderer.ts` · modify `src/plugins/chat/page/chat-view.ts` (compile-through only) · test `src/renderer/codemirror-vim/prefix-completion.test.ts`
Consumes:  `FuzzyMatcher` (`rank`) ← 01 · `const fuzzy = createFzfMatcher()` in `renderer.ts` ← 01
Produces:  in `src/contracts/editor.ts`:
           `export interface CompletionItem { word: string; aliases: readonly string[]; }`
           `EditorCompletions { prefix: string; items(): readonly CompletionItem[]; drawRow?(word: string, row: HTMLElement): void; offered(words: readonly string[]): void; accepted(word: string): void; }` (`words()` removed; the comment above the interface rewritten to say fuzzy, by word or alias, best first)
           `CreateEditorHost = (keymap, run, log, chips: FileChipDrawing, matcher: FuzzyMatcher) => EditorHost` (`matcher` is a new fifth parameter)
           in `src/renderer/codemirror-vim/prefix-completion.ts`: `export function prefixMatch(textBeforeCursor: string, prefix: string, items: readonly CompletionItem[], matcher: FuzzyMatcher): PrefixMatch | null` (`PrefixMatch.words` stays `string[]`, ranked) · `export function prefixCompletion(completions: EditorCompletions, matcher: FuzzyMatcher)`
Decisions: the editor contract names no chat or harness type: items are a word and its aliases, and the row is handed back by word (plan Architecture) · ranking by the matcher over one tier `[[word, ...aliases]]`, best first (round 4, Decided) · the row shows and inserts `prefix + word` (round 1) · no match highlighting (Decided)
Behaviour: `prefixMatch` keeps today's gates: the text starts with `prefix`, the typed part holds no whitespace, null when nothing matches. It ranks the items whose word or an alias matches the typed part; an empty typed part offers every item in `items()` order. Each word is offered once, at its first ranked position (the existing `prefixMatch_RepeatedWord_KeptOnce` claim); chat guarantees unique words (task 05). `offered` still hears each new ranked word list once per change. The popup row: `/word` is drawn by CodeMirror as today. When `drawRow` is given, the adapter hands it an element inside the row for the row's word, through `addToOptions` in the `autocompletion` config at `position: 60` (CodeMirror's label is 50, its detail 80). The row's word is the completion's `label` with `prefix` cut off. The row element is created per render; `drawRow` may append to it or replace its children. An exported `completionRowRender(completions, createElement: () => HTMLElement)` holds this step and returns `(completion) => HTMLElement | null`, null with no `drawRow`, so it is tested without a DOM.
Pinned:    the existing popup keys (Tab accepts, Ctrl+n/ArrowDown, Ctrl+p/ArrowUp), `filter: false`, insert mode only, `completionFor`'s one `Completion` per word, and the accepted text `prefix + word + ' '` stay as they are
GIVEN items `wigley:feature` (alias `feature`) and `make` WHEN the box holds `/feature` THEN the match offers `wigley:feature` only
GIVEN the box holds `/` WHEN matched THEN every item is offered in `items()` order
GIVEN the box holds `/wigley feat` WHEN matched THEN null (whitespace after the prefix)
Tests:     `prefix-completion.test.ts`, rewritten for items, passing a fake `FuzzyMatcher` written in the test (in-order subsequence over lower-cased text, input order kept, so the existing `prefixMatch_IgnoresCase` still holds). `src/renderer/codemirror-vim` may not import `src/renderer/fzf`, and fzf's ranking is task 01's to test: `prefixMatch_AliasMatches_OffersFullName` · `prefixMatch_EmptyTyped_OffersAllInOrder` · `prefixMatch_Whitespace_ReturnsNull` · `prefixMatch_NoPrefix_ReturnsNull` · `prefixMatch_FuzzyWord_Matches` (`/wgft` offers `wigley:feature`) · `prefixMatch_NothingMatches_ReturnsNull` · `completionRowRender_HandsWordAndElementToDrawRow` · `completionRowRender_NoDrawRow_ReturnsNull`; the existing tests' other claims carried over
Wiring:    `createCodeMirrorVimHost` takes `matcher` as its fifth parameter and passes it to `prefixCompletion(options.completions, matcher)`; `renderer.ts` passes its one `fuzzy` after the `chips` object
Compile-through: `chat-view.ts` maps its `completionWords(...)` strings to `{ word, aliases: [] }` items, so the build stays green until task 05
Done when: `npm run typecheck`, `npm run lint` and the tests above pass; the row-drawing path is checked live in task 07
Commit:    one commit for the group

## Proof

