# 11 — The docs tree says when nothing matches, when the index is empty, and when a filter is on

Status: done
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/docs/page/docs-state.ts` · test `src/plugins/docs/page/docs-state.test.ts` ·
           modify `src/plugins/docs/page/tree-view.ts` · modify `src/plugins/docs/page/docs-view.ts` (the
           `createTreeView` deps and the keys-changed listener only) · modify `src/plugins/docs/page/docs.css` ·
           modify `src/plugins/docs/main/selftest-script.ts`
Consumes:  `emptyState(text: string, hint?: HTMLElement | null): HTMLElement` in
           `src/shared/page/ui/empty-state.ts`; `DocsKeysFor` in `docs-state.ts`; `DocsViewDeps.keysFor`,
           `.kbd`, `.onKeysChanged` in `docs-view.ts` (all in the tree)
Produces:  `export type TreeLineHintPart = { keys: string } | { words: string };` in `src/plugins/docs/page/docs-state.ts`
           `export interface TreeLine { placement: 'empty' | 'above'; text: string; hint: readonly TreeLineHintPart[]; }`
           in `src/plugins/docs/page/docs-state.ts`
           `export interface TreeLineState { hasTree: boolean; isIndexEmpty: boolean; filter: string; rowCount: number; isFilterOpen: boolean; }`
           in `src/plugins/docs/page/docs-state.ts`
           `export interface TreeLineKeys { filter: string | null; clear: string | null; rescan: string | null; }`
           in `src/plugins/docs/page/docs-state.ts`
           `export function treeLine(state: TreeLineState, keys: TreeLineKeys): TreeLine | null` in
           `src/plugins/docs/page/docs-state.ts`
           `keysFor: DocsKeysFor` and `kbd(keys: string): HTMLElement` on `export interface TreeViewDeps` in
           `src/plugins/docs/page/tree-view.ts`
           `keysChanged(): void` on `export interface TreeView` in `src/plugins/docs/page/tree-view.ts`
Decisions: the three lines and their keys, as Kbd through `keysFor`, redrawn on a rebind (plan.md, Decisions,
           interview; `docs/features/docs-browser/design.md` § Tree); the text is built by a pure function in
           `docs-state.ts`, as `conflictText` and `noPlaceText` are; the empty-index line never shows before the
           first tree (brief); the `Filtered:` line hides while the filter box is open, since the box shows the
           filter itself (agent, reported to the lead)

## Pinned copy

Each key part draws as a Kbd from `keysFor`; each words part as plain text between them.

| Case | `placement` | `text` | `hint` |
|---|---|---|---|
| index empty | `empty` | `No docs in this index` | rescan keys, `to rescan` |
| filter matches nothing | `empty` | `No docs match "<filter>"` | filter keys, `then`, clear keys, `to clear it` |
| filter on, rows show, box closed | `above` | `Filtered: <filter>` | filter keys, `to change it` |

`<filter>` is the filter exactly as typed. The default keys read `/`, `Esc` (⎋ on macOS) and `R`.

## Behaviour

### `treeLine` (pure, `docs-state.ts`)

Rules in order, the first that holds wins:

1. `!state.hasTree` → `null` (no tree has been set: a session view before its first read, a machine view before its
   first index read lands).
2. `state.isIndexEmpty` → the index-empty line, whatever the filter.
3. `state.filter !== '' && state.rowCount === 0` → the no-match line.
4. `state.filter !== '' && !state.isFilterOpen` → the `Filtered:` line.
5. Otherwise `null`.

A hint whose keys any of its key parts needs is unbound (`null`) is `[]`, the text alone, as `noPlaceText` drops its
hint: the no-match hint needs both `filter` and `clear`; the others need their one key. The `filter !== ''` test
matches `acceptFilter`'s. One comment line above `treeLine` states what it returns; the table above is the
docs' copy, not a comment.

### Tree view (`tree-view.ts`)

- `TreeViewDeps` gains `keysFor: DocsKeysFor` and `kbd(keys: string): HTMLElement`, each with a one-line comment in
  the style of `DocsViewDeps`. `TreeView` gains `keysChanged(): void` — shows the line again with the keys bound now.
- A `hasTree` flag becomes true at the first `setTree` from a read that returned a document, whatever the tree
  holds; a failed read (a null document, whose status line already names the failure) leaves it false, so no tree
  line shows under that status. `docs-view.ts` tells the tree which case it is (the existing `hasRows` keeps its job:
  the first tree with rows expands its roots).
- The pane holds a line slot between the filter frame and the rows: `pane.append(status, filterFrame, line, list)`.
  The slot shows `treeLine({ hasTree, isIndexEmpty: tree.length === 0, filter: state.filter, rowCount: rows.length,
  isFilterOpen: filterScope !== null }, keys)` with keys `{ filter: deps.keysFor('filter', 'tree'), clear:
  deps.keysFor('boxCancel', 'box'), rescan: deps.keysFor('rescan', 'tree') }`:
  - `null` → the slot is a hidden element.
  - `empty` → `emptyState(text, hint)`, the doc pane's empty-state pattern (`doc-view.ts`'s `EMPTY_TEXT` and
    `emptyHint`).
  - `above` → a `div.docs-filtered` holding a `span.docs-filtered-text` with the text, then the hint.
  - The hint is a `span.docs-hint` built by a static helper taking the parts and `deps.kbd`: each key part a
    `deps.kbd(keys)`, each words part a text span; no hint element when the parts are empty.
- The line is worked out again at the end of `draw()`, in `openFilter` and `closeFilter` (the box opening or closing
  changes `isFilterOpen` without a draw) and in `keysChanged`. The slot element is replaced (`replaceWith`, as
  `doc-view.ts`'s `keysChanged` replaces its empty state) only when the new `TreeLine` differs from the one shown —
  placement, text and every hint part — so `j`/`k` redraws leave it alone.
- `acceptFilter` logs one more line, after `filtered the tree: <filter>`, when the accepted filter is not empty and no
  rows show: `no docs match "<filter>"` (the self-test's proof that the no-match case is reached). Its other lines are
  unchanged.

### Docs view (`docs-view.ts`)

- `createTreeView` gets `keysFor: deps.keysFor` and `kbd: deps.kbd`.
- The `deps.onKeysChanged` listener also calls `tree.keysChanged()`; its comment (a rebind reaches the empty state's
  key and the prompts that show keys while they show) names the tree's line too.
- Nothing else in this file changes. Task 10 (wave 2) adds `leafOpened` to this file after this task lands.

### CSS (`docs.css`)

- `.docs-tree` `grid-template-rows` gains one `auto` track for the line: `auto auto auto minmax(0, 1fr)` (status,
  filter, line, rows). The comment above `.docs-tree` gains: the line between the filter and the rows.
- `.docs-filtered`: the status line's look (`--wg-fg-tertiary`, `--wg-text-12`, padding `var(--wg-space-1)
  var(--wg-space-3)`), one line that never wraps (`display: flex`, `align-items: baseline`, `gap: var(--wg-space-2)`,
  `white-space: nowrap`, `min-width: 0`, `overflow: hidden`); `.docs-filtered-text` clips with an ellipsis
  (`overflow: hidden`, `text-overflow: ellipsis`, `min-width: 0`); `.docs-hint` keeps its keys and words whole
  (`display: inline-flex`, `align-items: baseline`, `gap: var(--wg-space-1)`, `flex: none`). Tokens only:
  `npm run lint` (`check-styles.mts`) refuses raw lengths and colours.
- The empty line takes `.ui-empty`'s own look; no docs rule overrides it.

### Self-test (`selftest-script.ts`)

- After the step `{ keys: ['/', 'Escape'], expect: '[docs] cleared the filter' }` that follows the Trash prompts in
  Docs mode (the one before `h h` collapses Rules), two steps:
  - `{ keys: ['/', ...'zqzq', 'Enter'], expect: '[docs] no docs match "zqzq"', checksFit: true }` — `zqzq` is in no
    fixture title or path (the temp home's random suffix is six characters; a four-letter run of these letters in it
    is negligible).
  - `{ keys: ['/', 'Escape'], expect: '[docs] cleared the filter' }`.
  The selection is unchanged by an empty filter, so the `h h` step after them still starts on neat.md.
- The script's narrative comment gains, after "/ and Esc clear the filter.": "/ filters to zqzq, which matches
  nothing, and Enter keeps it; / and Esc clear it."
- `SCROLLS_ITSELF` gains `'.docs-filtered'` (it clips with an ellipsis, as `.docs-status` does); its comment
  ("Paths and the status line end in an ellipsis") names the filtered line too.

GIVEN a session view before its first read WHEN its tree pane draws THEN no line shows (the status reads `Not read
yet`)
GIVEN an index read with no entries WHEN the tree is set THEN the line reads `No docs in this index` then the
rescan key, `to rescan`, in place of the rows
GIVEN a filter `zqzq` that matches nothing WHEN it is typed or accepted THEN the line reads `No docs match "zqzq"`
then the filter key, `then`, the clear key, `to clear it`; Enter also logs `[docs] no docs match "zqzq"`
GIVEN an accepted filter `neat` with rows WHEN the box is closed THEN a muted line above the rows reads
`Filtered: neat` then the filter key, `to change it`; with the box open, no line
GIVEN a rebind of `docs.filter` WHEN the keymap changes THEN the shown line's key reads the new bind

## Tests

`docs-state.test.ts`, in a new `describe('treeLine')`, `Subject_Case_Result` names as the file uses; each builds its
`TreeLineState` and keys (`{ filter: '/', clear: '⎋', rescan: 'R' }`) in the test:

- `treeLine_BeforeFirstTree_Null` — `hasTree: false` with `isIndexEmpty: true` and with a filter → `null`.
- `treeLine_EmptyIndex_RescanHint` — `hasTree: true, isIndexEmpty: true, filter: 'neat', rowCount: 0` →
  `{ placement: 'empty', text: 'No docs in this index', hint: [{ keys: 'R' }, { words: 'to rescan' }] }`.
- `treeLine_FilterMatchesNothing_ClearHint` — `filter: 'zqzq', rowCount: 0`, box open and closed → `{ placement:
  'empty', text: 'No docs match "zqzq"', hint: [{ keys: '/' }, { words: 'then' }, { keys: '⎋' }, { words: 'to clear
  it' }] }` both times.
- `treeLine_FilterWithRows_FilteredAbove` — `filter: 'neat', rowCount: 3, isFilterOpen: false` → `{ placement:
  'above', text: 'Filtered: neat', hint: [{ keys: '/' }, { words: 'to change it' }] }`.
- `treeLine_FilterBoxOpenWithRows_Null` — `filter: 'neat', rowCount: 3, isFilterOpen: true` → `null`.
- `treeLine_NoFilterWithRows_Null` — `filter: '', rowCount: 3` → `null`.
- `treeLine_KeyUnbound_TextAlone` — the no-match case with `clear: null`, the index-empty case with `rescan: null` and
  the filtered case with `filter: null` each give their text with `hint: []`.

The DOM wiring (`tree-view.ts`) has no unit test (the file has none, and the suite has no DOM); the self-test step
and the live checks carry it.

Done when: `npm run typecheck` and `npm run lint` pass; the test gate runs the tests above and the docs self-test
           steps above
Commit:    one commit for the group

## Live checks for task 15

Drive run with `docs.seed`, `key Space k d`, then `screenshot` the tree (`.docs-tree`) for each:

- Expected — no match: `key / z q z q`; the line `No docs match "zqzq"` shows with `/`, `then`, `⎋`, `to clear it`
  as Kbds and words, centred in the tree in place of the rows, in `fg-secondary`; `key Enter` keeps it; `key /
  Escape` clears it and the rows come back.
- Expected — filtered: `key / n e a t Enter`; one muted line `Filtered: neat` with the `/` Kbd and `to change it`
  sits between the filter frame's place and the rows, in the status line's tertiary colour and size. With the box
  open again (`key /`) the line is gone; `key Escape`.
- Low-confidence (a new grid track above the rows) — with no filter, `key G`: the rows scroll inside `.docs-rows`
  (`query` its box: no taller than `.docs-tree`), and with the `Filtered:` line shown they still do.
- Low-confidence (clipping in a narrow side bar) — `resize` to 420 px wide, `key Space k d` until the tree lies over
  the content, `key / . c l a u d e / r u l e s / Enter`: the `Filtered: .claude/rules/` line clips its text with an
  ellipsis, its Kbd and words stay whole, and nothing overflows the side bar.
- Low-confidence (a rebind reaching the line; the keymap file reload is wiring no test covers) — with the no-match
  line shown, write `.drive/<run>/home/.config/wigley-ai-gui/keymap.json` binding `docs.filter` to `f` in scope
  `docs.tree`; once the config reloads, the line's first Kbd reads `f` with no key pressed.

The empty-index line has no drive check: no drive action seeds an index with no entries, and
`treeLine_EmptyIndex_RescanHint` pins its text; the line shares its DOM path with the no-match line.

## Proof

d652347 · diff read, every Produces present plus hasIndex; document set before setTree in docs-view; checksFit is a SelfTestStep field · concerns: no-match line sits near the pane top, not vertically centred (.ui-empty centres horizontally only) — task 15 screenshot; hidden slots drop out of grid placement, rows scroll left to task 15's G check

