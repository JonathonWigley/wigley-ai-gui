# 07 — Page wiring: star key, row times, doc view line

Status: not started
Type: Batch
Wave: 3 · Depends on: 05, 06
Plan: [plan.md](plan.md)
Repo: wigley-ai-gui

Files:     modify `src/contracts/plugin.ts` (`PageServices` only) · `src/renderer/renderer.ts` (the page services object
           only) · `src/plugins/docs/manifest.ts` · `src/plugins/keymap.ts` · `src/plugins/docs/page/start.ts` ·
           `src/plugins/docs/page/docs-view.ts` · `src/plugins/docs/page/tree-view.ts` ·
           `src/plugins/docs/page/doc-view.ts` · `src/plugins/docs/page/docs-state.ts` · `src/plugins/docs/page/docs.css`
           test `src/plugins/docs/page/docs-state.test.ts`
Consumes:  `export const STARRED_ROOT_ID = 'owner:starred';` in `src/plugins/docs/tree.ts` ← 05
           `buildTree(entries: readonly IndexEntry[], homeDir: string, paths: Paths, starred: ReadonlySet<string>): TreeNode[]`
             in `src/plugins/docs/tree.ts` ← 05; Starred leaf ids `owner:starred/entry:<entryId>` ← 05
           `loadedAgo(iso: string, now: number): string`, `loadedAt(iso: string): string`,
             `loadedLine(iso: string, now: number): string` in `src/plugins/docs/loaded-time.ts` ← 06
           `interface StarredDocs { ids(): ReadonlySet<string>; has(entryId: string): boolean; toggle(entryId: string): void; applyChange(change: DocChangeRecord): void; onChanged(listener: () => void): Disposable }`
             and `createStarredDocs(uiState: UiState, paths: Paths): StarredDocs` in
             `src/plugins/docs/page/starred-docs.ts` ← 06
           `lastLoaded: string | null;` (member of `IndexEntry`) ← 04
           `Clock` in `src/contracts/ambient.ts` (exists) · `icon(name)` in `src/shared/page/ui/icon.ts` (exists) ·
           `row({ trailing, … })` in `src/shared/page/ui/row.ts` (exists)
Produces:  `clock: Clock;` (member of `PageServices`) in `src/contracts/plugin.ts`
           command `toggleStar` in `docsManifest.commands` in `src/plugins/docs/manifest.ts`
           `{ keys: 's', scope: 'docs.tree', command: 'docs.toggleStar' }` in `src/plugins/keymap.ts`
           `toggleStar(): void;` (member of `DocsViewCommands`) in `src/plugins/docs/page/docs-view.ts`
           `starred: StarredDocs;` and `now(): number;` (members of `DocsViewDeps`) in `src/plugins/docs/page/docs-view.ts`
           `export interface LeafMarks { time: { text: string; title: string } | null; isStarred: boolean }` and
             `leafMarks(leaf: TreeLeaf): LeafMarks;` (member of `TreeViewDeps`) in `src/plugins/docs/page/tree-view.ts`
           `loadedOf(entryId: string): string | null;` (member of `DocViewDeps`) in `src/plugins/docs/page/doc-view.ts`
           `export function expandNewStarred(previous: readonly TreeNode[], next: readonly TreeNode[], expanded: ReadonlySet<string>): ReadonlySet<string>`
             in `src/plugins/docs/page/docs-state.ts`
           log lines `[docs] starred <entry title>` and `[docs] unstarred <entry title>` from `docs-view.ts` (task 08
             waits for them)
Decisions:
- The page has no clock today. `PageServices` (`src/contracts/plugin.ts`) holds `editor`, `markdown`, `toast`, `log`,
  `timers`, `paths`, `homeDir` and `uiState`; `clock` is a `MainServices` member only. The plan's "the page's
  `services.clock`" needs it added. Add `clock: Clock;` to `PageServices` with the comment "Epoch milliseconds, for
  times drawn relative to now." In `src/renderer/renderer.ts`, the `services` object (built beside `timers`) gains
  `clock: { now: () => Date.now() }`, as `src/main/main.ts` builds main's clock. Decided: `AGENTS.md` names the clock
  an ambient service that reaches a plugin through `api.services`, and the design review settled "ambient service
  injected". `page-api.test.ts` casts its services and needs no change.
- Command, pinned by lead: `toggleStar: { label: 'star or unstar the doc', group: 'tree', runsIn: 'page' }` in
  `docsManifest.commands`, after `pickContext`. Key, pinned by lead (round 1 Q4): `{ keys: 's', scope: 'docs.tree',
  command: 'docs.toggleStar' }` in the Docs section of `src/plugins/keymap.ts`, after the `docs.pickContext` line. No
  other bind uses `s` in `docs.tree` or in `any` (grep at plan time). `docs/keymap.md` lists no per-scope raw keys,
  so it does not change; design doc § Recency and stars already names `s`.
- `start.ts`'s returned `commands` gain `toggleStar: onActiveView('toggleStar')`, after `pickContext`, so `s` acts on
  the active view as every tree command does. The renderer's `commands.requireRegistered` check fails at start when
  the bind names a command no part registers.
- Help and which-key read the command's label from the manifest (`src/plugins/keys/page/help-sections.ts`,
  `key-bar.ts`): no extra work.
- `s` on a leaf, pinned by lead: `toggleStar` toggles the selected leaf's `entryId` in the star set, on a Starred row or
  a usual row alike, then logs `starred <title>` or `unstarred <title>` (source `docs`), `<title>` the entry's
  `title`. On a group row, with no row selected, or for an entry `entriesById` no longer holds, it does nothing and
  logs nothing. Decided: a tree key with nothing to act on logs nothing today (`treeRowAction`'s `none`), and the design
  doc says `s` on a group "does nothing".
- One star set, pinned by lead (round 1, Decided): `page/start.ts` creates one `createStarredDocs(services.uiState,
  services.paths)` in `start`, before `machineView`, and hands it to every view through `createView` as
  `DocsViewDeps.starred`. `now` is `() => services.clock.now()`.
- Changes reach the star set once: `changedIn(view, change)` in `start.ts` calls `starred.applyChange(change)` once,
  before its loop over the other views. Verified: `changedIn` is the `changed` dep of every view, and a view calls
  `deps.changed(record)` only from `applyDocChange`, once per change it makes; `outsideChange` never calls it. So the
  call runs once per change, in the making view's call.
- Each view redraws on a star change: `createDocsView` subscribes `deps.starred.onChanged`; the listener calls
  `showDocument(document)` when `document` is not null, and does nothing before the first read. `dispose` disposes
  the subscription. `showDocument` passes `deps.starred.ids()` to `buildTree` in place of 05's empty set.
- Tree commands while the tree is hidden: add `'toggleStar'` to `TREE_COMMANDS_IN_SIGHT` in `start.ts`. With the tree
  hidden, `s` then moves focus to the doc and runs nothing, since `s` has no bind in `docs.doc`
  (`commandOfKeysIn` returns null). `hidden-tree-keys.ts` needs no change. Decided: starring acts on the selected row,
  which is out of sight then (design doc § Modes and layout: "a tree command whose keys run different commands
  there, or none, only moves focus").
- Leaf marks, pinned by lead (round 2 Q3, design doc): `docs-view.ts` gives the tree view `leafMarks(leaf)`. For the
  leaf's entry with a `lastLoaded`, `time` is `{ text: loadedAgo(lastLoaded, deps.now()), title: \`Last loaded
  ${loadedAt(lastLoaded)}\` }`; with `lastLoaded` null, or no entry, `time` is null. `isStarred` is
  `deps.starred.has(leaf.entryId)`, so a starred doc's Starred row and usual row both show the star. The time is read
  at each draw; nothing redraws on a timer (Decided).
- Row drawing in `tree-view.ts` `rowElement`, pinned by the user (round 3: the star in the caret slot):
  - A starred leaf's caret slot (`span.docs-row-caret`, empty for a leaf today) holds `icon('star-full')` with class
    `docs-row-star`. An unstarred leaf's caret slot stays empty, as today. A group's caret slot keeps its chevron.
  - For a leaf with a time, the row's `trailing` is one `span.docs-row-end` holding, left to right, the time
    `span.docs-row-time` (`textContent` `time.text`, `title` `time.title`) and the status dot as today. A leaf with
    no time keeps today's trailing (the status dot or nothing). A group keeps today's trailing.
- Tokens, by `DESIGN.md` (no raw values; `npm run lint` runs the style check): `.docs-row-end` is `align-items:
  center; display: inline-flex; gap: var(--wg-space-1_5);`. `.docs-row-time` is `font-size: var(--wg-text-12);
  font-variant-numeric: tabular-nums;`, its colour `fg-tertiary` from `.ui-row-trailing` ("dimmed"; DESIGN.md § Type:
  numbers that change use tabular numerals). `.docs-row-star` sits in the caret slot, which is already
  `var(--wg-icon-size)` wide and centres its icon; it is `color: var(--wg-fg-secondary);` (DESIGN.md § Icons:
  Codicons `fg-secondary` at rest). The star takes no status colour: a star is not a status (DESIGN.md § Colour).
- The Starred group draws no rollup (design review). Its role is `other` (05), and `treeRowStatus` returns no detail
  for `other`: no code change; a test pins it.
- First tree: `defaultExpandedIds` already expands every root but Third-party, so the Starred root starts expanded in a
  first tree. Its comment says "every root but Third-party (Starred and Mine among them), and each group child of
  Mine." A test pins it.
- A Starred group that shows in a later tree, pinned by the user (round 3, expanded): `expandNewStarred(previous, next,
  expanded)` returns `expanded` plus `STARRED_ROOT_ID` when `next` has a root with that id and `previous` has none;
  else it returns `expanded` unchanged. `tree-view.ts` `setTree` applies it to `state.expanded` on every tree after
  the first. Reason: today a root that first shows in a later tree starts collapsed, which would hide the doc the
  user just starred.
  Accepted edge: an in-app rename of the only starred doc draws one tree with no Starred root before the star set
  moves the star, so a Starred group the user had collapsed opens again. It is rare, and fixing it would move the
  expand into `toggleStar`.
- `selectEntry(entryId)` keeps selecting the leaf `entry:<entryId>`, the usual place (design review), since the
  Starred leaf ids carry the `owner:starred/` prefix. `openDoc` and `followFile` reach it unchanged. No code change.
- Unstarring from a Starred row, pinned by the user (round 3, select the usual row): when `toggleStar` removes the star of
  a selected leaf whose id is not `entry:<entryId>` (a Starred row), it calls `tree.selectEntry(entryId)` after the
  toggle, which has already redrawn the tree. Reason: the Starred row is gone, and today the
  selection would point at no row, so the next `j` jumps to the first row. The other choice is to leave the selection
  as it falls.
- The filter applies to the Starred group as to any group: `visibleRows` filters leaves by title and path whatever
  their parent. No code change.
- Doc view line, pinned by lead (round 2 Q3): `docs-view.ts` gives the doc view `loadedOf(entryId)`: the entry's
  `lastLoaded` through `loadedLine(lastLoaded, deps.now())`, or null when the entry has none or is gone. `doc-view.ts`
  `drawChips` appends `span.docs-loaded` with that text after the load chips and the status tags, in the chip row, and
  appends nothing for null. `.docs-loaded` is `align-self: center; color: var(--wg-fg-tertiary); font-size:
  var(--wg-text-12);`. Decided: "beside its load chips" (design doc) is the chip row; it redraws whenever the chips
  do (`refreshChips` on each `showDocument`), never on a timer.
- `doc-view.ts`'s header comment says "chips (load states, then plugin-source statuses, then the last-loaded line)".
  `tree-view.ts`'s `TreeView` comment adds "a leaf's star, last-loaded time and status mark at its end".

GIVEN a doc row selected WHEN the user presses `s` THEN the star set gains its entry id and the log says `starred <title>`
GIVEN a starred doc's row, Starred or usual, WHEN `s` THEN the star goes and the log says `unstarred <title>`
GIVEN a group row selected WHEN `s` THEN nothing changes and nothing is logged
GIVEN a star toggled in Docs mode WHEN a session's Docs tab shows THEN its tree shows the same star
GIVEN an in-app rename of a starred doc WHEN it lands THEN the star follows the new path, in every view
GIVEN an in-app trash of a starred doc WHEN it lands THEN its star is gone
GIVEN a leaf with `lastLoaded` WHEN the tree draws THEN its end shows the short time, dimmed, with `Last loaded <date and time>` on hover
GIVEN a starred leaf WHEN the tree draws THEN it shows the filled star, in Starred and in its usual place
GIVEN a doc with `lastLoaded` WHEN it opens THEN the chip row ends `Loaded 3h ago`, `Loaded just now` or `Loaded Mar 3`
GIVEN a doc never loaded WHEN it opens THEN no loaded line shows
GIVEN the tree hidden WHEN `s` THEN focus moves to the doc and nothing else runs
GIVEN no Starred group WHEN a doc is starred THEN the Starred group shows expanded

Tests:     in `page/docs-state.test.ts`:
           `defaultExpandedIds_StarredRoot_Expanded` — tree `[group owner:starred [leaf owner:starred/entry:/a],
             group owner:mine [group global], group owner:third-party]`: the set holds `owner:starred`, `owner:mine` and
             `global`, and not `owner:third-party`
           `treeRowStatus_StarredGroup_NoDetail` — a group with id `owner:starred`, role `{ type: 'other' }`, over a leaf
             whose `files` status is uncommitted: `{ mark: null, detail: null }`
           `expandNewStarred_StarredAppears_Added` — previous `[group owner:mine]`, next `[group owner:starred, group
             owner:mine]`, expanded `{ 'owner:mine' }`: the result holds `owner:starred` and `owner:mine`
           `expandNewStarred_StarredWasThere_Unchanged` — previous and next both hold `owner:starred`, expanded
             `{ 'owner:mine' }` (the user collapsed Starred): the result is `{ 'owner:mine' }`
           `expandNewStarred_NoStarred_Unchanged` — next holds no `owner:starred`: the result equals `expanded`
           The DOM wiring (the row's end, the doc view's line, the key) has no unit test: tree-view, doc-view and
             start.ts have none today. Task 08's self-test steps cover the key and the Starred group; task 10 checks the
             look live.
Done when: `npm run typecheck` passes; `npm test -- src/plugins/docs/page/docs-state.test.ts` passes with every test
           above (`npx` is denied on this machine); `npm run lint` passes, its style check included
Commit:    one commit for the group, in wigley-ai-gui, committed by path only (peer sessions may have uncommitted edits)

## Proof

