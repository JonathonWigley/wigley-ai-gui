# 08 — Backlog page: the table, review pane, chunk strip and assistant pane

Status: not started
Type: Batch
Rung: deep · crosses into scoped-agents' pane lifecycle (outer panes, the focus hand-off, mode hide) and async channel reads and messages, over a rewrite of every page file
Wave: 5 · Depends on: 03, 04, 07
Plan: [plan.md](plan.md)

One spec over five items, landed as one commit: **A** the reducer, **B** the layout contract and `default`, **C** the
view, page start, manifest, keymap and contract, **D** the deletions, **E** the self-test script. Every path below is
under `wigley-ai-gui/`.

Files:
- modify `src/plugins/backlog/page/backlog-state.ts` (A)
- test `src/plugins/backlog/page/backlog-state.test.ts` (A — rewritten)
- modify `src/plugins/backlog/layouts/layout.d.ts` (B)
- modify `src/plugins/backlog/layouts/default/layout.js` (B)
- modify `src/plugins/backlog/layouts/default/layout.css` (B)
- modify `src/plugins/backlog/page/layout/read-layout.ts` (B)
- test `src/plugins/backlog/page/layout/read-layout.test.ts` (B)
- modify `src/plugins/backlog/page/layout/backlog-kit.ts` (B)
- modify `src/plugins/backlog/page/backlog-view.ts` (C)
- test `src/plugins/backlog/page/backlog-view.test.ts` (C — rewritten)
- modify `src/plugins/backlog/page/start.ts` (C)
- test `src/plugins/backlog/page/start.test.ts` (C)
- modify `src/plugins/backlog/page/backlog.css` (C)
- modify `src/plugins/backlog/manifest.ts` (C)
- modify `src/plugins/backlog/contract.ts` (C)
- modify `src/plugins/keymap.ts` (C)
- modify `src/plugins/backlog/main/start.ts` · modify `src/plugins/backlog/main/homes.ts` (D — the `plans`, `features`, `uncommitted` fills)
- test `src/plugins/backlog/main/start.test.ts` · test `src/plugins/backlog/main/homes.test.ts` (D — fixtures)
- test `src/plugins/notes/main/start.test.ts` · test `src/plugins/notes/main/note-homes.test.ts` (D — fixtures)
- delete `src/plugins/backlog/page/followup-editor.ts` (D)
- modify `src/plugins/backlog/main/backlog-tools.ts` · test `src/plugins/backlog/main/backlog-tools.test.ts` (D — `assistantPlace`'s defaults)
- modify `src/plugins/backlog/main/selftest-script.ts` (E)
- modify `src/plugins/backlog/main/selftest-fixture.ts` · test `src/plugins/backlog/main/selftest-fixture.test.ts` (E — a
  `moved` and a `stale` item)
- modify `src/plugins/docs/main/selftest-fixture.ts` (E — the stand-in index's follow-up entries for the new file)
- modify `docs/features/layouts/design.md` (C — the `backlog` row of the owners table)
- modify `docs/features/followups.md` (D — two follow-ups on code this task deletes)

Consumes:
- `ScopedAgentsPageExports { addAgentPane(spec: AgentPaneSpec): AgentPane }`, `AgentPaneSpec`, `AgentPane` ← 03, from
  `src/plugins/scoped-agents/contract.ts`, and its page `DependencyKey` `scopedAgentsPageKey` ← 03
- `rowKey(repo: string, title: string): RowKey` in `src/plugins/backlog/row-key.ts` ← 05
- `isReady(tags: readonly string[]): boolean`, `AGENT_READY` in `src/plugins/backlog/ready.ts` ← 07 (the page keeps no
  copy)
- the contract members 06 kept for the old page, each marked `// Removed in 08: main no longer serves this.`: the
  `readDoc`, `applyEdit` and `commit` invokes, `BacklogEdit`, `BacklogPlan`, `BacklogTask`, `BacklogFeature`,
  `BacklogHome.plans`, `features` and `uncommitted` ← 06 (this task deletes them, D)
- the backlog assistant registered under agent id `'assistant'`, scope `'global'` ← 07
- `RowKey`, `BacklogStaleness`, `BacklogChunk`, `ChunkEdit`, `ChunkStart` ← 05, 06, 07 (`src/plugins/backlog/contract.ts`)
- `BacklogChannel.invoke` `staleness()`, `commitsSince(key)`, `chunks()`, `editChunks(edit)`, `startChunks(chunkIds)`,
  `sweep(repo)` and `BacklogChannel.messages` `stalenessRead`, `chunksChanged` ← 05, 06, 07
- `BacklogPlace` in its new shape (`selectedKey`, `repo`, `filter`, `marked`, `isReadyOnly`, `isChunkedHidden`,
  `isStaleFirst`, `isDoneShown`, `isAssistantShown`) ← 07
- the backlog settings `tags`, `layout`, `launchBrief`, `repoFolders` ← 05 (this task changes none)
- main's chunk rules and refusal texts ← 06 (`06-backlog-chunks.md` § Edit rules; an emptied chunk is deleted)
- tree members: `sessionsSelectRowCommand` (`src/plugins/sessions/contract.ts`; its run activates the session, and
  sessions main's `activated` message shows Sessions mode), `GitCommit` (`src/contracts/git.ts`), `createSplit`,
  `createHScroller`, `inputFrame`, `textBoxInput`, `createLayoutParts`, `appSlot`, `keyRunner`, `kitCommandsOf`,
  `api.panes.setOuterPanes`, the gallery's no-side-bar mode (`src/plugins/gallery/page/start.ts`)

Produces:
- in `src/plugins/backlog/page/backlog-state.ts`:
  - `export type BacklogFocus = 'table' | 'review' | 'strip' | 'assistant'`
  - `export type StalenessLevel = BacklogStaleness['level']`
  - `export interface BacklogRow { key: RowKey; repo: string; path: string; item: FollowupItem; chunk: BacklogChunk | null }`
  - `export interface BacklogState` (members in A below)
  - `export type BacklogAction` (members in A below)
  - `export function initialBacklogState(): BacklogState`
  - `export function allRows(state: BacklogState): BacklogRow[]`
  - `export function visibleRows(state: BacklogState, matcher: FuzzyMatcher): BacklogRow[]`
  - `export function selectedRow(state: BacklogState, matcher: FuzzyMatcher): BacklogRow | null`
  - `export function repos(state: BacklogState): string[]`
  - `export function shownChunks(state: BacklogState): BacklogChunk[]`
  - `export function stripChunk(state: BacklogState): BacklogChunk | null`
  - `export function actedKeys(state: BacklogState, matcher: FuzzyMatcher): RowKey[]`
  - `export function actedChunk(state: BacklogState, matcher: FuzzyMatcher): BacklogChunk | null`
  - `export function addEdit(state: BacklogState, matcher: FuzzyMatcher): Extract<ChunkEdit, { type: 'add' }> | null`
  - `export type CursorCommand = 'activate' | 'mark' | 'addToChunk' | 'removeFromChunk' | 'startChunk' | 'toggleHeadless' | 'renameChunk' | 'toggleCommits' | 'openInDocs'`
  - `export function cursorCommands(row: BacklogRow): readonly CursorCommand[]`
  - `export type EmptyReason = 'filter' | 'allDone' | 'readyNone' | 'allChunked' | 'nothing'`
  - `export function emptyReason(state: BacklogState, matcher: FuzzyMatcher): EmptyReason | null`
  - `export function stalenessNote(staleness: BacklogStaleness | undefined): string`
  - `export function placeOf(state: BacklogState, isAssistantShown: boolean): BacklogPlace`
  - `export function backlogReducer(state: BacklogState, action: BacklogAction, matcher: FuzzyMatcher): BacklogState`
- in `src/plugins/backlog/layouts/layout.d.ts`: `BacklogLayout` with the parts `table`, `filters`, `tableRow`, `empty`,
  `review`, `reviewItem`, `commits`, `strip`, `chunkCard`, `newChunk`, `pickerRow`; the inputs and kits in B below
- in `src/plugins/backlog/page/layout/backlog-kit.ts`: `export type BacklogBaseScope = 'table' | 'review' | 'strip'`,
  `export type BacklogKitScope = BacklogBaseScope | 'picker'`
- in `src/plugins/backlog/page/backlog-view.ts`: `export interface BacklogView` and `BacklogViewDeps` (C below),
  `export type BacklogCommand = Exclude<CommandsRunIn<typeof backlogManifest, 'page'>, 'showMode' | 'selectRow' | 'selectChunk'>`
- in `src/plugins/backlog/contract.ts`: `export const backlogSelectChunkCommand: CommandKey<string, 'backlog.selectChunk'>`

Decisions:
- Backlog is read-and-start only; every follow-up edit goes through the assistant (plan.md Decisions 1) — so the
  editor, delete, tags, tag picker and commit leave the page with their parts, scopes and keys (Decisions, last line).
- One table across every repo: repo │ task (title and one line) │ ready │ staleness │ chunk (Decisions 2); the review
  pane always shows the cursor item's full text and staleness note, and `gl` toggles the commits since written in it
  (Decisions 2).
- Chunks are one repo each and keyed by `RowKey` (Decisions 4); the page never writes them: every change goes through
  `editChunks` / `startChunks`, and main is the one writer (design review 3). The page does not pre-check a chunk rule
  (one repo, started chunk); it shows main's refusal text as an error toast.
- A started chunk's rows dim and Enter on them activates the session (Decisions 6).
- `W` sends the sweep for the filtered repo (Decisions 8). With no repo filter `W` toasts `Filter to one repo first`
  and sends nothing (settled here: the plan names only the filtered repo).
- `S` starts every unstarted chunk the strip shows: with a repo filter on, only that repo's (settled here, so the key
  acts on what the user sees; plan.md's key line says the same).
- The assistant pane comes from `addAgentPane` (03), in a right column with its own `Split` (Architecture, design
  review 1); Backlog's layout draws none of it: scoped-agents' `askBox` part draws its ask box.
- The mode registers no side bar (Decisions, last line). The core's `toggleSideBar` throws `Mode "main" has no side
  bar` on such a mode (`src/renderer/shell/modes.ts`), so `showMode` follows gallery's: it shows the mode, and pressed
  again while it shows does nothing. Alt+h at the table's left edge reaches no side bar: the core logs its own
  `no pane left`.
- Keys (Decisions 9), checked against `docs/keymap.md` and every bind in the same scopes (C below). `Space v b`, `v r`,
  `v c`, `v s` are free in the `v` group, whose binds are `vt vw vd vi va vu vy`. `gl` shares only the `g` prefix with
  `gg` in its scopes, as practice's `gt`/`gT` do beside `gg`.
- Every non-vim bind gets an anchor in each scope it fires in (AGENTS.md § Key hints, Every other bind has an anchor):
  the anchors are named in B and C.
- 06 removed main's handlers for `readDoc`, `applyEdit` and `commit` and kept their contract members, marked, so the
  page compiled between waves (`06-backlog-chunks.md` § Removals in main); this task deletes those members with the
  page code that read them.

### A — the reducer (`backlog-state.ts`)

State, replacing every member today:

```ts
interface BacklogState {
  homes: readonly BacklogHome[]; message: string | null; isLoaded: boolean;
  staleness: Readonly<Record<RowKey, BacklogStaleness>>;
  chunks: readonly BacklogChunk[];
  focus: BacklogFocus;              // 'table' at start
  selectedKey: RowKey | null;
  stripCursor: string | null;       // a shown chunk's id, or null for the strip's New chunk cell
  repo: string | null;              // null: every repo
  filter: string;
  marked: readonly RowKey[];
  isReadyOnly: boolean; isChunkedHidden: boolean; isStaleFirst: boolean; isDoneShown: boolean;
  isCommitsShown: boolean;
}
```

Actions: `loaded {read}`, `placeRestored {place}`, `stalenessRead {entries}`, `chunksChanged {chunks}`,
`move {to: 'down'|'up'|'top'|'bottom'}`, `select {key}`, `focus {focus}`, `setFilter {text}`, `setRepo {repo: string | null}`,
`toggleDone`, `toggleReadyOnly`, `toggleChunkedHidden`, `toggleStaleFirst`, `toggleMark`, `clearMarks`,
`stripMove {by: 1 | -1}`, `stripSelect {chunkId: string | null}`, `toggleCommits`.

Rules:
- Every row key is `rowKey(repo, title)` from `src/plugins/backlog/row-key.ts` (05), the key main builds.
- `allRows`: every follow-up item of every home, homes in load order grouped by repo (each repo where its first home
  falls, the homes of one repo in load order), then file order, then item order. A key a row already holds (two homes
  of one repo, one title) keeps the first row. This is the order of 05's `backlogRows` word for word, so the table and
  `read_backlog_state` list rows in one order. `chunk` is the chunk whose `repo` is the row's and whose `titles` hold its title.
- `visibleRows`: `allRows` less a done item unless `isDoneShown`, a row of another repo while `repo` is set, an item
  with `isReady(tags)` false while `isReadyOnly`, a row with a chunk while `isChunkedHidden`, and a row the filter
  misses. The filter matches as today: trimmed, fuzzy on the title and each tag, plain substring (`matchesSubstring`)
  on the one line; a filter of only spaces is none. `isStaleFirst` sorts the result stably by level rank: `stale` 0,
  `moved` 1, `unknown` 2, `fresh` 3, a row with no staleness entry 4.
- `repos`: the repos in `allRows` order, each once. `shownChunks`: `chunks` in their order, only the `repo` filter's
  repo while it is set. `stripChunk`: the shown chunk whose id is `stripCursor`, else null.
- `actedKeys`: the `marked` keys a row of `allRows` holds, in `allRows` order; with none, the selected row's key while
  focus is `table`; else empty.
- `actedChunk`: focus `strip` → `stripChunk`; focus `table` → the selected row's chunk; else null.
- `addEdit`: null when `actedKeys` is empty; else `{ type: 'add', keys: actedKeys, chunkId: stripChunk?.id ?? null }`
  (the strip's cursor chunk, or a new one named after the first title by main — Decisions 9 `c`).
- `cursorCommands(row)` in prompt order: a row in a started chunk → `activate`, `toggleCommits`, `openInDocs`; a row in
  an unstarted chunk → `mark`, `addToChunk`, `removeFromChunk`, `startChunk`, `toggleHeadless`, `renameChunk`,
  `toggleCommits`, `openInDocs`; a row in no chunk → `mark`, `addToChunk`, `toggleCommits`, `openInDocs`. "Started" is
  `chunk.sessionId !== null`.
- `emptyReason`: null while a row shows; else, first that holds: `filter` (trimmed filter not empty); `allDone` (the
  repo filter's items are all done, at least one, and done is hidden); `readyNone` (`isReadyOnly`); `allChunked`
  (`isChunkedHidden`); `nothing`.
- `loaded`: sets `homes`, `message`, `isLoaded`; keeps `selectedKey` while a visible row holds it, else selects the
  row now at its old index, clamped, or null (today's `reselect`); drops a `marked` key no row of `allRows` holds.
  Every reselect (here and in each action below that "reselects") that ends with `selectedKey` null while focus is
  `review` sets focus `table`.
- `stalenessRead`: merges `entries` over `staleness`, each key replaced; selection kept by key.
- `chunksChanged`: replaces `chunks`; `stripCursor` stays while a shown chunk holds it, else moves to the shown chunk
  at the old index, clamped, else null; reselects as `loaded` does (hide-chunked may hide the selected row).
- `move`: in `table` over `visibleRows` (`top` / `bottom` the ends), clamped; in any other focus nothing.
- `focus`: `review` only with a row selected (else unchanged); `table`, `strip`, `assistant` always.
- `setFilter`, `setRepo`, each toggle: reselect as `loaded` does; `setRepo` and `toggleChunkedHidden` also re-place
  `stripCursor` as `chunksChanged` does.
- `toggleMark`: in `table`, adds or removes the selected row's key in `marked`; otherwise nothing. `clearMarks`
  empties `marked`.
- `stripMove`: over the strip's cells, `shownChunks` then the New chunk cell (null), clamped, no wrap.
  `stripSelect`: sets `stripCursor` when null or a shown chunk's id, else unchanged.
- `toggleCommits`: flips `isCommitsShown`; it stays across cursor moves.
- `placeRestored`: puts back `repo` (null when no row holds that repo), `filter`, the four toggles and `marked`
  (pruned as `loaded` prunes); selects `place.selectedKey` when a visible row holds it, else the first visible row; focus
  `table`. `isAssistantShown` is the view's (C).
- `placeOf(state, isAssistantShown)` returns the plan.md `BacklogPlace` with `marked` copied.
- `stalenessNote` copy, pinned (`<date>` is `writtenAt`'s first 10 characters, the commit's date in ISO 8601):
  - no entry: `Staleness not read yet.`
  - `unknown`: `Unknown: not in git history.`
  - otherwise `<Level>: written <date>`, then, joined by ` · `: `names no paths` when `namedPaths` is empty, else
    `<n> commit(s) since on <k> named path(s)` (`0 commits`, `1 commit`, `2 commits`; `1 named path`, `2 named paths`); then
    `gone: <gonePaths joined ', '>` when any; then `last: <lastCommit.subject>` when `lastCommit` is set. `<Level>` is
    `Fresh`, `Moved` or `Stale`. Example: `Moved: written 2026-10-20 · 3 commits since on 2 named paths · last: Fix the strip`.
  - `writtenAt` null with a level other than `unknown` (05 gives `stale` for a gone path with no history):
    `<Level>: not in git history yet`, then the parts above less the commits part (no history to count from): `names no
    paths` when `namedPaths` is empty, `gone: …`, `last: …`. Example: `Stale: not in git history yet · gone: src/gone.ts`.

### B — the layout contract and `default`

Removed parts (each with its input and kit): `homes`, `list`, `detail`, `editor`, `repoHeader`, `homeRow`,
`groupHeader`, `followupRow`, `planRow`, `featureRow`, `taskRow`, `followupDetail`, `docDetail`, `confirmBody`; types
`EditorInput`, `RepoHeaderInput`, `HomeRowInput`, `GroupHeaderInput`, `FollowupRowInput`, `PlanRowInput`,
`FeatureRowInput`, `TaskRowInput`, `FollowupDetailInput`, `DocDetailInput`, `ConfirmBodyInput`, `HomesKit`, `ListKit`,
`DetailKit`, `EditorKit`, `DocKit`, `ConfirmBodyKit`. Kept: `BacklogPane`, `BacklogKit`, `RowKit`, `PickerRowKit`,
`PickerRowInput`, `pickerRow`, `CompleteBacklogLayout`.

New and changed parts, each `(parent, [input,] kit)`, and what `default` draws with (the app's design-system
primitives through `BaseKit`):

| Part | Input | Kit | `default` draws |
|---|---|---|---|
| `table` → `BacklogPane` | none | `TableKit`: `status`, `filterBar`, `filterBox`, `rows` | `div.backlog-pane`; a header (`kit.keyHint` box hints `filter` "filter", `rescan` "rescan", `sweep` "sweep", `startAllChunks` "start all"; `kit.edge` end `panes.focusRight` "review"); `kit.status`; `kit.filterBar`; `kit.filterBox`; a column head of `kit.el` cells `Repo`, `Task`, `Ready`, `Staleness`, `Chunk` in the row grid; `kit.rows` |
| `filters` → `HTMLElement` | `FiltersInput { repo: string \| null; isReadyOnly; isChunkedHidden; isStaleFirst; isDoneShown: boolean; marked: number }` | `BacklogKit` | `kit.button` per filter (variant `primary` while on, `ghost` while off, `keys: null`): `repo ?? 'All repos'` → `backlog.pickRepo`, `Ready` → `backlog.toggleAgentReadyOnly`, `Hide chunked` → `backlog.toggleChunkedHidden`, `Stale first` → `backlog.toggleStaleFirst`, `Done` → `backlog.toggleDone`; then `kit.tag` `<n> marked` (accent) while `marked > 0` |
| `tableRow` → `HTMLElement` | `TableRowInput { repo; title; oneLine: string; tags: readonly string[]; done: boolean; isReady: boolean; staleness: StalenessLevel \| null; chunk: { name: string; isStarted: boolean } \| null; isMarked: boolean }` | `RowKit` (`cursorActions`) | `kit.row` (`density: 'list'`, `tag: 'li'`, label title, detail one line); leading a repo cell (`kit.icon` `check` while marked, then the repo as text); trailing (`kit.rowTrailing`) three cells: `kit.tag` `ready` accent while `isReady`; `kit.tag` of the level word in tone `fresh` success, `moved` warning, `stale` error, `unknown` neutral, or `…` neutral while null; the chunk's name as text with `kit.icon` `link-external` while started; then `kit.cursorActions` |
| `empty` → `HTMLElement` | `EmptyInput { reason: EmptyReason; filter: string }` | `BacklogKit` | `kit.emptyState` with the text below; `nothing` adds `kit.keyHint` `toggleAssistant` |
| `review` → `BacklogPane` | none | `ReviewKit`: `body` | `div.backlog-pane`; a sticky head (`kit.edge` start `panes.focusLeft` "table"; box hints `openInDocs` "docs", `toggleCommits` "commits"); `kit.body` |
| `reviewItem` → `HTMLElement` | `ReviewItemInput { repo; title; oneLine; shownPath; body: string; tags: readonly string[]; done: boolean; level: StalenessLevel \| null; note: string; chunk: { name: string; isStarted: boolean } \| null }` | `BacklogKit` | `h2` title; `kit.tag` per tag (`agent-ready` accent); `p.backlog-staleness backlog-staleness--<level or 'reading'>` holding `note`; `kit.inlineMarkdown` one line; `kit.el` the repo and `shownPath` in `fg-tertiary`; the chunk line `In chunk <name>` (`, started` while started); `kit.markdown` body |
| `commits` → `HTMLElement` | `CommitsInput { commits: readonly { shortSha: string; subject: string; date: string }[] \| null; problem: string \| null }` | `BacklogKit` | `kit.sectionHeader` `Commits since written`; one `kit.row` per commit (`density: 'list'`, label subject, detail `<shortSha> · <date>`); `kit.emptyState` `Reading commits…` while `commits` is null, `No commits since it was written.` for none, `problem` when set |
| `strip` → `BacklogPane` | none | `StripKit`: `chunks`, `renameBox` | `div.backlog-pane`; a header (`kit.sectionHeader` `Chunks`; box hints `renameChunk` "rename", `toggleHeadless` "headless", `startChunk` "start", `startAllChunks` "start all"); `kit.renameBox`; `kit.chunks` |
| `chunkCard` → `HTMLElement` | `ChunkCardInput { repo; name: string; count: number; isHeadless: boolean; isStarted: boolean }` | `BacklogKit` | `kit.card` `backlog-chunk`: the name, `kit.tag` repo (neutral), `<count> item(s)`, `kit.tag` `headless` accent while on, `kit.statusDot` `running` and `started` while started |
| `newChunk` → `HTMLElement` | none | `BacklogKit` | `kit.card` `backlog-chunk backlog-chunk--new`: `New chunk` |
| `pickerRow` | kept; `picker` is `'Repos'` | kept | kept |

Empty texts, pinned: `filter` `No rows match "<filter>".`; `allDone` `Every follow-up here is done.`; `readyNone`
`No agent-ready follow-ups here.`; `allChunked` `Every follow-up here is in a chunk.`; `nothing`
`No follow-ups yet: ask the assistant to add one.`

Slots (app-owned, each placed once per draw, `<slot> placed twice` as today, a left-out slot appended at the part
root's end): `status` → `div.backlog-status`; `filterBar` → `div.backlog-filter-bar`, into which the app draws
`filters` on each render; `filterBox` → the filter frame (`backlog-filter`); `rows` → `ol.backlog-rows`; `body` →
`div.backlog-review-body`, into which the app draws `reviewItem`, then `commits` while shown; `chunks` → the
HScroller's element (`ui-h-scroller backlog-chunks`), whose track takes one `chunkCard` per shown chunk, then
`newChunk`; `renameBox` → the rename frame (`backlog-rename`), hidden while no rename is open; `cursorActions` as today.
The app sets the click and toggles `is-selected`, `is-cursor`, `is-marked` and `is-started` on each `tableRow` root,
and `is-cursor` on the strip cursor's card; a row and a card give `kit.row` / `kit.card` no click. Kit scopes: `table`,
`filters`, `tableRow`, `empty` `backlog.table`; `review`, `reviewItem`, `commits` `backlog.review`; `strip`,
`chunkCard`, `newChunk` `backlog.strip`; `pickerRow` `backlog.picker`. The contract's head comment is rewritten to
these; its last paragraph names the parts drawn once per layout set (`table`, `review`, `strip`) and on every render
(the rest).

`layout.css` (default): the table pane's tracks (`auto auto auto auto minmax(0, 1fr)`: header, filter bar, filter
box, column head, rows); the row grid shared by the column head and each `tableRow` (repo `8rem`, task
`minmax(0, 1fr)`, ready `4rem`, staleness `5.5rem`, chunk `9rem`) through `.backlog-cell--<column>`; `is-started` rows
in `fg-tertiary`; the review head as today's detail head; the strip as one row of cards (`backlog-chunk`, `radius-md`,
`space-2` apart, the cursor card the focus ring). `read-layout.ts`'s `LAYOUT_PARTS` lists exactly the eleven parts.

### C — the view, start, manifest, keymap and contract

Contract (`contract.ts`): `BacklogFocus` and `backlogOpenHomeRowCommand` are deleted; `backlogSelectRowCommand` keeps its
id with `arg` a `RowKey` ("Selects the table row whose key is `arg` and focuses the table, as a click on the row
does"); `backlogSelectChunkCommand` (`{ id: 'backlog.selectChunk' }`) puts the strip cursor on the chunk whose id is
`arg` and focuses the strip, as a click on its card does. `BacklogChannel.invoke` loses `readDoc`, `applyEdit` and
`commit` (D). The head comment drops the commit and editor.

Manifest (`manifest.ts`), after this task:
- description `Adds Backlog mode: every repo's follow-ups in one table, their staleness, and chunks started as sessions.`
- `dependsOn.page` `['docs', 'scoped-agents']` and `reads.page` `['sessions']` (plan.md Boundary rules;
  `dependsOn.main` and `reads.main` as 07 left them). The page imports `sessionsSelectRowCommand` from
  `src/plugins/sessions/contract.ts` and only runs it by key, as docs' page reads sessions (`src/plugins/docs/manifest.ts`);
  `scripts/check-layers.mts` admits a page import of a plugin's `contract.ts` only through `dependsOn.page` or
  `reads.page`. The page imports nothing of chat: `mountChat` is reached through scoped-agents.
- commands kept: `showMode` (label `backlog`), `listDown`, `listUp`, `listTop`, `listBottom`, `filter`, `rescan`,
  `toggleDone`, `toggleAgentReadyOnly`, `openInDocs`, `lineDown`, `lineUp`, `halfPageDown`, `halfPageUp`, `scrollTop`,
  `scrollEnd`, `...LIST_PICKER_COMMANDS`, `boxAccept`, `boxCancel`, `selectRow` (label `select this row`, arg `string`).
- commands removed: `open`, `back`, `toggle`, `create`, `edit`, `delete`, `toggleAgentReady`, `pickTag`, `commit`,
  `save`, `cancelEdit`, `leaveBox`, `nextField`, `previousField`, `confirmYes`, `confirmNo`, `openHomeRow`.
- commands added (all `runsIn: 'page'`), label and group: `activate` `open the row's session, or the review` (list);
  `mark` `mark or unmark the row` (chunks); `addToChunk` `add to the strip's chunk, or a new one` (chunks);
  `removeFromChunk` `take out of its chunk` (chunks); `renameChunk` `rename the chunk` (chunks); `startChunk`
  `start the chunk` (chunks); `startAllChunks` `start every shown unstarted chunk` (chunks); `toggleHeadless`
  `turn the chunk's headless on or off` (chunks); `toggleCommits` `show or hide the commits since written` (review);
  `sweep` `send the staleness sweep to the assistant` (chunks); `toggleAssistant` `show or hide the assistant` (view);
  `pickRepo` `pick a repo` (view); `toggleChunkedHidden` `hide or show chunked rows` (view); `toggleStaleFirst`
  `sort stale first` (view); `stripLeft` `previous chunk` (strip); `stripRight` `next chunk` (strip); `selectChunk`
  `select this chunk` (strip, arg `string`, no key).
- scopes: `table` `In the backlog table`, `review` `In the backlog review pane`, `strip` `In the backlog chunk strip`,
  `box` `In a backlog box` (the filter and the rename), `picker` `In a backlog list picker`. Removed: `homes`, `list`,
  `detail`, `editor`, `confirm`.
- settings: unchanged by this task (`tags`, `layout`, `launchBrief`, `repoFolders`); the head comment says `tags` is
  read for notes and `layout` names the layout.

Keymap (`src/plugins/keymap.ts`), the `── Backlog ──` block and the leader and Ctrl+n entries:
- removed: every bind in `backlog.homes`, `backlog.list`, `backlog.detail`, `backlog.editor`, `backlog.confirm`
  (`j k gg G l <CR> C R h / a i d t T o`, the scroll chords, `<D-Enter> <Tab> <S-Tab> <Esc>` ×2, `T`, `y n <Esc>`).
- kept: `<Leader>kb` `backlog.showMode`, `<Leader>vd` `backlog.toggleDone`, `<Leader>va` `backlog.toggleAgentReadyOnly`
  (scope `any`); `backlog.box` `<CR>` `boxAccept`, `<Esc>` `boxCancel`; `'backlog.picker'` in `LIST_PICKER_SCOPES`.
- added, scope `any`: `<Leader>vb` `backlog.toggleAssistant`, `<Leader>vr` `backlog.pickRepo`, `<Leader>vc`
  `backlog.toggleChunkedHidden`, `<Leader>vs` `backlog.toggleStaleFirst`.
- added, `backlog.table`: `j` listDown, `k` listUp, `gg` listTop, `G` listBottom, `<CR>` activate, `/` filter, `R`
  rescan, `o` openInDocs, `x` mark, `c` addToChunk, `u` removeFromChunk, `r` renameChunk, `s` startChunk, `S`
  startAllChunks, `H` toggleHeadless, `gl` toggleCommits, `W` sweep.
- added, `backlog.table` and `backlog.review`: `<C-j>` lineDown, `<C-k>` lineUp, `<C-S-j>` halfPageDown, `<C-S-k>`
  halfPageUp (they scroll the review beside the table, as the list's did the detail).
- added, `backlog.review`: `j` lineDown, `k` lineUp, `gg` scrollTop, `G` scrollEnd, `o` openInDocs, `gl` toggleCommits.
- added, `backlog.strip`: `h` stripLeft, `l` stripRight, `<CR>` activate, `r` renameChunk, `s` startChunk, `S`
  startAllChunks, `H` toggleHeadless.
- Ctrl+n's per-view list: `backlog.homes`, `backlog.list`, `backlog.detail`, `backlog.editor` out; `backlog.table`,
  `backlog.review`, `backlog.strip` in.

View (`backlog-view.ts`), rewritten.
- `BacklogViewDeps`: `channel`, `markdown`, `matcher`, `paths`, `homeDir`, `uiState`, `timers`, `log`, `toast`, `keys`,
  `platform`, `state`, `commands`, `openDoc(path, line?)`, `setScope(scope: BacklogBaseScope)`, `setResizeTarget`,
  `setFocusTarget`, `setOuterPanes(panes: OuterPanes | null)`, `pushScope(scope: 'box' | 'picker')`, `picker`, `run`,
  `runKey`, `isShown()`, `showMode()`, `addAgentPane(spec: AgentPaneSpec): AgentPane`, `setContext(detail: string)`,
  `savedPlace`, `placeChanged`. Gone: `editor`, `drops`, `tags`, `addOverlay`, `revealSideBar`, `homePicked`,
  `homeShown`.
- `BacklogView`: `sheet`, `load()`, `reload()`, `stalenessRead(entries)`, `chunksChanged(chunks)`, `shown()`,
  `hidden()`, `focusMain()`, `setLayouts(shown)`, `dispose()`, `commands: Record<BacklogCommand, () => void>`,
  `selectRow(key)`, `selectChunk(id)`. Gone: `sideBar`, `sideBarHidden`, `sideBarOpenedOver`, `focusSideBar`,
  `mayStop`, `openHomeRow`.
- Elements: three splits, each `createSplit` with the view's `uiState`, `keys.anchor` and `timers`: `tableSplit` (row,
  `stateKey: 'tableWidth'`, `initial: 640`, `min: 400`, `endMin: 280`) holding the table pane | the review pane;
  `stripSplit` (column, `sizedPane: 'end'`, `stateKey: 'stripHeight'`, `initial: 120`, `min: 72`, `endMin: 200`)
  holding `tableSplit` over the strip pane; `assistantSplit` (row, `sizedPane: 'end'`, `stateKey: 'assistantWidth'`,
  `initial: 380`, `min: 280`, `endMin: 520`) holding `stripSplit` | `div.backlog-assistant`, which holds the agent
  pane's `element`; `assistantSplit` starts `setEndHidden(true)`. The sheet holds `assistantSplit`.
- The agent pane, created once: `addAgentPane({ owner: backlogManifest.id, agentId: 'assistant', heading: () => 'Backlog assistant', hint:
  'Ask to add, rewrite or drop follow-ups in any repo, or to group them into chunks.', setShown, resizeTarget:
  assistantSplit, tookKeys, leave })`, then `pane.scopeOpened('global')`. `setShown(shown)` calls
  `assistantSplit.setEndHidden(!shown)`, then, while `state.isLoaded`, `deps.placeChanged(placeOf(state, shown))`: 03
  calls `setShown` on each toggle (the `toggleAssistant`, `sweep` and restore opens alike) and not on `modeHidden`, so
  the place follows the pane and a mode hide keeps `isAssistantShown`. The store subscription passes
  `pane.isShown()` as the second argument of `placeOf`. `tookKeys` sets focus `assistant` (logs `assistant focused`) and sets no scope or
  target, as Practice's `interviewer` focus does; `leave` gives the keys to the last host pane (`table`, `review` or
  `strip`). Focus leaving `assistant` for a host pane calls `pane.hostTookKeys()`. `shown()` calls
  `setOuterPanes(pane.outerPanes)`; `hidden()` calls `pane.modeHidden()` then `setOuterPanes(null)`; `setLayouts` calls
  `pane.redraw()`; `dispose` disposes the pane and the three splits.
- Focus target: `table` right → `review` (with a row selected), `review` left → `table`, `table` down → `strip`,
  `strip` up → `table`, `review` down → `strip`; every other move returns false, so right from `review` or `strip`
  reaches the assistant through the outer panes while it shows. Resize target by focus: `table` → `tableSplit`;
  `review` → `assistantSplit.nudge(d) || tableSplit.nudge(d)`; `strip` → `stripSplit.nudge(d) ||
  assistantSplit.nudge(d)`. Each `setScope` is followed by `setResizeTarget` and `setFocusTarget`, as today; focus
  `assistant` sets none of them.
- The strip's `HScroller` (`createHScroller()`, `src/shared/page/ui/h-scroller.ts`): after each strip draw the view
  calls `scroller.refresh()`, then `scroller.reveal(card)` with the cursor card when `stripCursor` changed since the
  last draw (the New chunk card for null). `dispose` disposes it with the pane and the three splits.
- Narrow window: below 640px wide (today's `@media (max-width: 640px)` in `backlog.css`), `tableSplit` stacks the review
  under the table, `minmax(0, 2fr) minmax(0, 3fr)`, as today's `.backlog-split` stacks the detail. `stripSplit` is a
  column already. `assistantSplit` keeps its row axis; its `min` and `endMin` clamp the two widths as the split does at
  any width.
- Focus main (`focusMain()`): gives the keys to the last host pane (`table`, `review` or `strip`), as `leave` does,
  with `pane.hostTookKeys()` when focus was `assistant`.
- Reads: `load` and `reload` invoke `load` (a read overtaken by a later one dropped, as today), then `staleness()`
  (dispatched as `stalenessRead`) and, on the first load only, `chunks()` (dispatched as `chunksChanged`); the first
  load puts `savedPlace` back and, when `savedPlace.isAssistantShown`, opens the pane: with `toggle()` while
  `deps.isShown()`; else it sets `pendingOpen`, and the next `shown()` clears it and calls `toggle()` once when
  `pane.isShown()` is false (`toggle()` always takes the keys, so a restore under Chat or Sessions must not run it).
  `rescan` invokes `rescan` the same way. `shown()` invokes `staleness()` again (dispatched as `stalenessRead`), so a
  commit with no follow-up file change shows when Backlog is shown (main reads staleness only when `staleness()` is
  invoked). The channel's `stalenessRead` and `chunksChanged` messages reach
  `stalenessRead` / `chunksChanged` (start wires them).
- Failures, one rule: `load` and `rescan` keep today's `readQuietly`. Every other channel invoke that rejects logs
  `<invoke name> failed: <errorText>` (`editChunks failed: No chunk c1`) and changes no state. The writes
  (`editChunks`, `startChunks`, `sweep`) also toast the text in `error`; the reads (`staleness`, `chunks`) toast
  nothing and keep the last state; `commitsSince` draws `commits` with `problem` the text. A per-chunk `refusal` in a
  resolved `startChunks` is not a rejection (below).
- Commits: while `isCommitsShown` and a row is selected, `commitsSince(key)` is invoked once per selected key (a reply
  overtaken by a later selection drawn nowhere) and drawn as `commits`; `shortSha` is the sha's first 7 characters,
  `date` the commit's `at` first 10.
- Commands: `activate` → focus `table`: a started row runs `sessionsSelectRowCommand` with its chunk's `sessionId`
  through `runKey` (logs `opened session <name>`), else focuses `review`; focus `strip`: a started cursor chunk the
  same, else nothing. `mark` → `toggleMark`, logs `marked <title>` or `unmarked <title>`. `addToChunk` → `editChunks(addEdit)`: on success `clearMarks`,
  `chunksChanged` with the reply, `stripSelect` the chunk holding the first key, logs `added <n> to <chunk name>`; a
  rejection follows the failure rule and keeps the marks. `removeFromChunk` → `editChunks({ type: 'remove', keys:
  actedKeys })`; on success `clearMarks` and logs `took <n> out of chunks`; a rejection follows the failure rule and
  keeps the marks. `renameChunk`, `startChunk` and `toggleHeadless` with no `actedChunk` do nothing and log nothing.
  `renameChunk` → with an `actedChunk`, opens the rename box (pushed `box` scope, the box holding the chunk's name, selected; logs
  `renaming <name>`); `boxAccept` sends `{ type: 'rename', chunkId, name }` with the trimmed text (an empty text renames
  nothing) and logs `renamed <name>`; `boxCancel` closes it. One pushed box at a time: the filter or the rename.
  `startChunk` → `startChunks([actedChunk.id])`; `startAllChunks` → `startChunks` with every shown unstarted chunk's
  id (`shownChunks`: with a repo filter on, only that repo's chunks, the ones the strip shows; with none shown it sends
  nothing); a chunk whose launch is still in flight comes back as the per-chunk refusal `<name> is starting` (06), so
  the page keeps no guard of its own, and a chunk whose session closes as it starts comes back as `<name>'s session
  closed as it started`; both toast as any other refusal; each `ChunkStart` with a `sessionId` logs `started <name>` and toasts `Started <name>` in `success`, each with a
  `refusal` logs `start refused <name>` and toasts the refusal in `error`. `toggleHeadless` →
  `{ type: 'setHeadless', chunkId, headless: !chunk.headless }`, logs `headless <name> on|off`. `toggleCommits` logs
  `commits shown` / `commits hidden`. `sweep` → with `repo` set, `sweep(repo)`, then, on success (a rejection follows the failure rule), opens the pane when hidden
  (`toggle()`) and calls `pane.refresh()`, logs `sweep sent <repo>`; with no repo, toasts `Filter to one repo first` in
  `error`. `toggleAssistant` → while Backlog shows, `pane.toggle()`; while hidden, `showMode()` then opens the pane if
  closed (Practice's `toggleInterviewer`); logs `assistant shown` / `assistant hidden`. `pickRepo` (scope `any`) first
  calls `showMode()` while Backlog is hidden, then opens the list picker titled `Repos` over `All repos` then `repos(state)` (rows drawn by `pickerRow`); a choice dispatches `setRepo`
  and logs `repo <repo>` or `repo all`. `toggleChunkedHidden` logs `chunked hidden|shown`; `toggleStaleFirst` logs
  `stale first on|off`; `toggleDone` and `toggleAgentReadyOnly` keep today's lines (`done shown|hidden`,
  `agent-ready only on|off`, the latter dispatching `toggleReadyOnly`). `stripLeft` / `stripRight` → `stripMove`, logs
  `strip on <chunk name>` or `strip on new chunk`. `openInDocs` → `openDoc(row.path, row.item.line)` for the selected
  row. The scroll commands scroll the review pane and log as today with `the review` (`scrolled the review to the
  end`).
- Logs kept: `shown`, `loaded <n> homes`, `not loaded: …`, `selected <title>`, `filter <text>`, `no row <key>`; each
  focus change logs `table focused`, `review focused`, `strip focused` or `assistant focused`; `selectChunk` on an id
  no shown chunk holds logs `no chunk <id>`.
- Title bar: `setContext(state.repo ?? 'All repos')` once when the view is made and again whenever the repo filter
  changes; start.ts maps it to `{ title: 'Backlog', detail }`.
- `layouts/design.md` owners table, the `backlog` row's third cell becomes: `the table and its filters, rows and empty
  text, the review pane with its item and commits, the chunk strip with its chunk and New chunk cards, and the picker
  rows`.
- The cursor prompt holds one anchor per `CursorCommand` in scope `table`, labels `session`, `mark`, `chunk`,
  `unchunk`, `start`, `headless`, `rename`, `commits`, `docs`, each hidden unless `cursorCommands` lists it.

Start (`page/start.ts`): the mode is `{ id: 'main', title: 'Backlog', icon: 'checklist', element: view.sheet, shown,
hidden, focusMain }` with no `sideBar` and none of the side bar callbacks; `hidden` calls `view.hidden()`; `showMode`
is gallery's (shows, else nothing). It reads `scopedAgentsPageKey` through `api.dependency` and passes
`addAgentPane`; wires `api.channel.on('stalenessRead', …)` and `on('chunksChanged', …)`; returns `selectRow`,
`selectChunk` and no `mayStop`. `backlog.css` drops the homes, editor and side bar rules and lays out
`.backlog-table`, `.backlog-review` (scrolls), `.backlog-strip` and `.backlog-assistant` as `.backlog-list` and
`.backlog-detail` are today.

### D — the deletions

- `page/followup-editor.ts` deleted; nothing imports it after C.
- `BacklogPlace`: 07 added the new fields as optional; they become required and the old page's fields go, so the
  type is plan.md's shape exactly. In `main/backlog-tools.ts`, `assistantPlace(place)` keeps its null for `undefined`
  and drops each `??` default the required fields make dead; its test drops the rows that fed a partial place.
- `contract.ts`: every member 06 marked `// Removed in 08: main no longer serves this.` is deleted — the `readDoc`,
  `applyEdit` and `commit` invokes, `BacklogEdit`, `BacklogPlan`, `BacklogTask`, `BacklogFeature`, and
  `BacklogHome.plans`, `features` and `uncommitted` — with their comments, and the file's head comment loses the
  editor, the commit, plans and features. `grep -rn "Removed in 08" src` prints nothing after.
- Main stops filling `plans: []`, `features: []` and `uncommitted: false` wherever 06 left the fill (`main/start.ts`,
  `main/homes.ts`), and every `BacklogHome` fixture drops the three fields: `backlog/main/start.test.ts`,
  `backlog/main/homes.test.ts`, `notes/main/start.test.ts`, `notes/main/note-homes.test.ts`, and the page tests
  rewritten in A and C.
- `docs/features/followups.md`: the items **Backlog applied save closes another editor** and **Backlog `/` with no home
  open does nothing and leaves the letters as commands** are removed (each list item whole): the code they name
  (`backlog-view.ts`'s applied save and editor, `openFilter` with no open home) is deleted here.

### E — the self-test script (`main/selftest-script.ts`)

The fixture (`selftest-fixture.ts`) gains one row per staleness level it lacks, so the git glue (`firstAdded`, `log`,
the gone-path check) meets a real repo in the self-test and in 10's check 2:
- The git home's `followups.md` becomes, exactly (the plan file and task files stay):

  ```
  # Follow-ups — backlog-repo

  **Contents**

  - **Ready item** — *agent-ready*: waits for an agent
  - **Plain item** — needs a look
  - ~~**Shipped item**~~ — landed
  - **Moved item** — reads `src/app.ts`
  - **Stale item** — reads `src/gone.ts`

  ## Ready item

  Waits for an agent.

  ## Plain item

  Needs a look.

  ## ~~Shipped item~~

  Landed.

  ## Moved item

  Its code changed after it was written.

  ## Stale item

  Its file is gone.
  ```

- `src/app.ts` (`export const app = 1;\n`) joins `FILES`. The first commit (`FIXTURE_COMMIT_SUBJECT`) runs with
  `setEnv` `{ GIT_AUTHOR_DATE: '2026-10-20T10:00:00Z', GIT_COMMITTER_DATE: '2026-10-20T10:00:00Z' }`. Then the fixture
  writes `src/app.ts` as `export const app = 2;\n`, runs `add --all`, and commits with subject
  `FIXTURE_CHANGE_SUBJECT = 'Change the app'` under the same two names set to `2026-10-21T10:00:00Z`. The fixed dates
  matter: 05 keeps a commit only while its committer date (`%cI`) is later than `writtenAt`, and two commits in one
  second would leave Moved item `fresh`. `runGit` gains an optional fourth parameter `setEnv`, passed to
  `processes.run` as `{ setEnv }`. The head comment says five follow-ups and the two commits.
- Levels this gives (05's rules): Ready item and Plain item `fresh` (written 2026-10-20, name no paths); Moved item
  `moved` (`src/app.ts` held by the repo folder, one commit since: `Change the app`); Stale item `stale` (`src/` is in
  the repo folder, `src/gone.ts` is not); First follow-up `unknown` (the list home is outside git).
- Docs' stand-in index (`src/plugins/docs/main/selftest-fixture.ts`, the `followup(line, …)` entries) follows the
  file: Ready item line 11, Plain item 15, Shipped item 19, and two new entries `followup(23, 'Moved item', 'reads
  \`src/app.ts\`', 'open', [])` and `followup(27, 'Stale item', 'reads \`src/gone.ts\`', 'open', [])`.

Table order, done hidden: Ready item, Plain item, Moved item, Stale item, First follow-up (done shown: Shipped item
after Plain item). `settings: {}`, so `repoFolders` is empty and a `selftest-repo` chunk's start is refused. Each
`expect` is a line the step's keys cause: a `selected …` line only when the selection changes. Groups, each `why`
pinned in substance:

1. `open` — `Space k b` → `[backlog] shown` (checksFit); `R` → `[backlog] loaded 2 homes`; `G` → `[backlog] selected
   First follow-up`; `gg` → `selected Ready item`; `j` → `selected Plain item`; `j` → `selected Moved item`; `j` →
   `selected Stale item` (checksFit, screenshot `table`). Proves one table across both repos with the struck item
   hidden; the screenshot shows the four staleness levels.
2. `filters` — `Space v d` → `done shown`; `k k` → `selected Shipped item`; `Space v d` → `done hidden`; `Space v a` →
   `selected Ready item`; `Space v a` → `agent-ready only off`; `Space v r` → `[backlog] picker shown: Repos`; `G
   Enter` → `repo selftest-repo`; `Space v r`, then `gg Enter` → `repo all` (the selection stays on First follow-up);
   `Space v s` → `stale first on`; `gg` → `selected Stale item`; `j j` → `selected First follow-up` (why: stale, then
   moved, then unknown rank above fresh, so the levels main read from git are in place); `Space v s` → `stale first
   off`; `/ plain` → `selected Plain item`; `Enter` → `filter plain`; `/ Escape gg` → `selected Ready item`. Proves done,
   ready, repo, stale-first and `/` each narrow or reorder the one table.
3. `review` — `j j` → `selected Moved item`; `<A-l>` → `review focused`; `gl` → `commits shown`; `G` → `scrolled the
   review to the end` (screenshot `review`: Moved item's note and its one commit, `Change the app`); `gg` → `scrolled
   the review to the top`; `gl` → `commits hidden`; `<A-h>` → `table focused`. Proves the review pane's keys, the
   commit list, and the focus moves between it and the table.
4. `chunks` — `gg` → `selected Ready item`; `x` → `marked Ready item`; `j x` → `marked Plain item`; `c` → `added 2 to
   Ready item` (screenshot `chunk`); `<A-j>` → `strip focused`; `H` → `headless Ready item on`; `H` → `headless Ready
   item off`; `r` → `renaming Ready item`; `Pair Enter` (typed into the selected text) → `renamed Pair`; `<A-k>` →
   `table focused`; `Space v c` → `chunked hidden` with `alsoExpect` `/^\[backlog\] selected Stale item$/` (Plain item
   at index 1 is hidden, and Stale item is now at index 1); `Space v c` → `chunked shown`. Proves marks, a new chunk
   from them, the strip's headless and rename, and hide-chunked.
5. `start refused` — `<A-j>` → `strip focused`; `l` → `strip on new chunk`; `<A-k>` → `table focused`; `G` →
   `selected First follow-up`; `c` → `added 1 to First follow-up`; `s` → `start refused First follow-up`. Proves `s`
   asks main and shows its refusal for a repo with no folder.
6. `unchunk` — `u` → `took 1 out of chunks`; `gg x j x u` → `took 2 out of chunks`. Leaves no chunk for the next run
   (an emptied chunk is dropped by main, 06), and the selection on Plain item, so the next run's `G` changes it.
7. `assistant` — `Space v b` → `assistant shown` with `alsoExpect` `/^\[backlog\] assistant focused$/` (checksFit,
   screenshot `assistant`); `<A-h>` → `table focused`; `Space v b` → `assistant hidden`. Proves the pane opens beside
   the table with the keys and gives them back. No step sends an ask or `W`: each launches a session.

The result drops `followWrites` and checks no write: 06 removed `applyEdit` and `commit` from main, so the page has
no write path left, and `problems` runs only after `result` settles, which `open` creates before any step. `result` is
`fixture.then(() => { deps.reload(); return []; }, (error) => [`fixture not ready: ${errorText(error)}`])`.
`CREATED`, `RENAMED`, `COMMIT_SUBJECT`, `LIST_FOLLOWUPS`, `LIST_WITH_OUTSIDE_ITEM`, `FILE_CHECKS`, `CHECK_TIMEOUT_MS`,
`followWrites` and the old groups go, and `git` leaves `BacklogSelfTestDeps` (and main's wiring of it) when nothing
else reads it; `processes` stays for `writeBacklogFixture`. The
shown line stays `[backlog] loaded 2 homes`.

GIVEN rows in two repos WHEN the page loads THEN one table lists both repos' open items in load order, the struck item hidden
GIVEN a repo filter, `Space v a`, `Space v c` or `/` WHEN applied THEN only matching rows show and the selection stays on its row or moves to the row at its place
GIVEN staleness `stale` on one row and `fresh` on another WHEN `Space v s` is on THEN the stale row sorts first
GIVEN two marked rows and the strip cursor on New chunk WHEN `c` THEN `editChunks` gets `{ type: 'add', keys: [both], chunkId: null }` and the marks clear
GIVEN no mark WHEN `c` on a row THEN the add carries that row's key alone
GIVEN a chunk edit main rejects WHEN `c` THEN the rejection's text toasts as an error and the marks stay
GIVEN a row in a started chunk WHEN Enter THEN `sessions.selectRow` runs with the chunk's sessionId
GIVEN the assistant pane shown WHEN `Alt+l` from the review THEN the core moves into the pane through its outer panes, and the view's focus is `assistant`
GIVEN Backlog showing WHEN `Space k b` again THEN nothing changes and no error is thrown
GIVEN no repo filter WHEN `W` THEN `Filter to one repo first` toasts and `sweep` is not invoked
GIVEN a saved place with `isAssistantShown` WHEN the page reloads THEN the first load restores the filters, marks and selected row and opens the pane
GIVEN a saved place with `isAssistantShown` and another mode shown WHEN the first load lands THEN `toggle` is not called, and the next `shown()` calls it once
GIVEN the pane closed WHEN `Space v b` opens it THEN `placeChanged` gets `isAssistantShown: true`; WHEN Backlog is hidden THEN no place write sets it false
GIVEN a repo filter and unstarted chunks in two repos WHEN `S` THEN `startChunks` gets only the filtered repo's chunk ids
GIVEN a `remove` main rejects WHEN `u` THEN `editChunks failed: <text>` is logged, the text toasts as an error, and the marks stay

Tests:
- `backlog-state.test.ts`, rewritten. Kept, re-pointed at `BacklogRow` with repo: `visibleRows_DoneHidden_LeavesStruckItemOut`,
  `visibleRows_DoneShown_ListsStruckItem`, `visibleRows_Filter_MatchesTitleOneLineAndTagsIgnoringCase`,
  `visibleRows_FuzzyTitle_KeepsOrder`, `visibleRows_OneLineIsSubstringOnly "$filter"`,
  `backlogReducer_Reload_KeepsSelectionByTitle`, `backlogReducer_SelectedItemDeleted_ClampsSelection`. Changed:
  `visibleRows_AgentReadyOnly_KeepsTaggedFollowupsAndHidesPlans` → `visibleRows_ReadyOnly_KeepsTaggedRows`; `emptyReason`
  `is $reason with $state` gets one row per new reason; `placeRestored: $name` gets rows for a held and a gone repo, a
  pruned mark and a gone selected key. Deleted (their behaviour leaves): the pending-select, move-editor-baseline,
  editor, open-home, back, focus-homes, plan-expand, `editorEdit_*`, `draftOf`, `withTagToggled` tests. New:
  `allRows_TwoReposDuplicateTitle_KeysByRepoFirstRowKept`; `visibleRows_RepoFilter_KeepsThatRepo`;
  `visibleRows_ChunkedHidden_DropsChunkedRows`; `visibleRows_StaleFirst_OrdersByLevelStably` (a table of five rows, one
  per level and one unread, asserting the order `stale moved unknown fresh unread`); `chunksChanged_StripCursorGone_MovesToSameIndex`;
  `stripMove_PastEnds_Clamps` (cells: two chunks then New); `actedKeys_MarksElseCursor` (marked keys in `allRows` order;
  none → cursor key in `table`, `[]` in `strip`); `addEdit_StripCursor_ChunkIdOrNull`; `cursorCommands_ByChunkState`
  (no chunk, unstarted, started → the three lists in A); `focus_ReviewWithNoRow_Unchanged`;
  `stalenessNote_ByLevel` (a table: no entry, unknown, fresh with no paths → `Fresh: written 2026-10-20 · names no
  paths`, fresh with 2 paths and no commits → `Fresh: written 2026-10-20 · 0 commits since on 2 named paths`, moved
  with 1 commit and 1 path and a last subject, stale with two gone paths, stale with `writtenAt` null and one gone path
  → `Stale: not in git history yet · gone: src/gone.ts` → each exact string in A);
  `allRows_ReposInterleaved_GroupsByRepo` (homes A1, B, A2 → rows A1, A2, B);
  `stalenessRead_Merge_ReplacesEachKeyKeepsSelection`; `loaded_GoneMarkedKey_Pruned`;
  `reselect_After_$action` (`it.each` over `toggleChunkedHidden`, `setRepo`, `toggleReadyOnly`: a hidden selected row
  moves the selection to the row at its index);
  `reselect_NoRowLeftWhileReview_FocusesTable`; `moveAndToggleMark_OutsideTable_DoNothing` (focus `review` and
  `strip`).
- `read-layout.test.ts`: the `homeRow` case reads `tableRow`; `one row part` reads `tableRow`.
- `backlog-view.test.ts`, rewritten over a fake `addAgentPane` recording its spec and calls. Kept in substance, re-pointed:
  `a partial layout draws its own rows and default for the rest` (a user `tableRow`), `a reload keeps the open filter text
  and focus`, `scrollEnd_DetailShown_ScrollsItToTheEndAndLogs` → `scrollEnd_ReviewShown_ScrollsItToTheEndAndLogs`,
  `selectRow_SelectsTheRowAndFocusesTheItems` → `selectRow_SelectsTheRowAndFocusesTheTable`, `rowClick_RunsItsCommandWithItsKey:
  item row`. Deleted: the editor draft and box tests, `a box the editor pane leaves out is appended`, `a plan's detail
  reads its moved copy`, the follow-up editor drop target group, `focusTarget_EditorOpen_IgnoresEveryMove`,
  `rowClick_…: home row`, `openHomeRow_DispatchesThenCallsHomePicked`. New: `focusTarget_Moves` (a table of from,
  direction, to/false per C); `resizeTarget_ByFocus` (which split each focus nudges first); `assistantPane_TookKeys_FocusAssistantNoScopeSet`;
  `assistantPane_ShownHidden_SetsAndClearsOuterPanes`; `addToChunk_Rejected_ToastsTextKeepsMarks`;
  `addToChunk_Applied_ClearsMarksAndSelectsChunk`; `activate_StartedRow_RunsSessionsSelectRow`;
  `startChunks_MixedResults_ToastEach`; `sweep_NoRepo_ToastsAndSendsNothing`; `sweep_Repo_SendsOpensPaneAndRefreshes`;
  `commits_OvertakenReply_DrawsOnlyTheLatest`; `rename_BoxAccept_SendsTrimmedName`; `selectChunk_Unknown_LogsNoChunk`;
  `restore_BacklogHidden_TogglesOnceOnNextShown`; `assistantPane_SetShown_WritesPlace` (open → `isAssistantShown:
  true`; `hidden()` writes no `false`); `removeFromChunk_Rejected_ToastsTextKeepsMarks`; `sweep_Rejected_LogsAndToasts`
  (the pane is not opened); `commits_Rejected_DrawsProblem`; `commits_Reply_SlicesShaTo7AndDateTo10`;
  `commits_ReplyAfterHidden_DrawsNothing` (`gl` hides the list before the reply); `rename_EmptyText_SendsNothing`;
  `rename_BoxCancel_ClosesTheBox`; `selectChunk_Known_SetsStripCursorAndFocusesStrip`;
  `startAllChunks_RepoFilter_StartsOnlyShownChunks`; `chunkCommands_NoActedChunk_DoNothing` (`r`, `s`, `H` on a row in
  no chunk: no invoke, no log); `strip_CursorChanged_RefreshesThenReveals` and `dispose_DisposesTheScroller` (a fake
  scroller); `pickRepo_BacklogHidden_ShowsModeFirst`; `setContext_AtStart_AllRepos`;
  `focusMain_FromAssistant_GivesKeysToLastHostPane`; `shown_InvokesStalenessAgain`.
- `selftest-fixture.test.ts`: `GIT_RUNS` gains `add --all` and `commit --quiet -m Change the app` after the first commit;
  a new test asserts the two commits' `setEnv` dates (`FakeProcesses.runs[].setEnv`).
- `start.test.ts`: the lifecycle tests kept with a fake `scopedAgentsPageKey` dependency;
  `reload_restores_the_open_home_and_selected_row` → `reload_RestoresFiltersMarksAndSelectedRow`;
  `reload_ChangeBeforeTheFirstLoad_KeepsTheLastPagesPlace` kept with the new place; `mayStop_$case` deleted; new
  `showMode_WhileShown_DoesNothing` (no throw, mode still shown).
- `backlog/main/start.test.ts`, `backlog/main/homes.test.ts`, `notes/main/start.test.ts`, `notes/main/note-homes.test.ts`:
  fixtures only (D); no test added or removed.

Dropped (pinned by a test above, so not in 10): the ordering and filter rules, the chunk edit sent per key, refusal
toasts, the focus and resize chains, the place restore.

Deferred to `10-final-verification.md`: the table, review, strip and assistant pane as drawn (the screenshots `table`,
`review`, `chunk`, `assistant`), a chunk start that launches a session and Enter on its rows, `W`'s sweep reaching the
assistant, the layout's look at a narrow window.

Done when: `npm run typecheck` passes; `npm test -- src/plugins/backlog src/plugins/notes src/shared/layouts/layout-contracts.test.ts`
passes, and `npm test -- src/plugins/docs/main/selftest-fixture.test.ts` passes; `npm run lint` passes;
`npm run selftest -- --plugin backlog --plugin docs` passes (docs' stand-in index changed with the fixture).
Commit: one commit for the group.

## Proof

