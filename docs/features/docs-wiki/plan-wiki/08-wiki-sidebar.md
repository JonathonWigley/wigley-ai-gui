# 08 — Docs mode's sidebar shows the wiki tree or All pages

Status: done
Type: Task
Wave: 4 · Depends on: 03, 04, 05, 06
Plan: [plan.md](plan.md)

All paths are in wigley-ai-gui. `src/plugins/docs/` is written as `docs/` below. This task shares `docs/contract.ts`, `docs/main/start.ts` and `docs/manifest.ts` with task 04, so it runs after task 04. It uses no name from task 04.

Files:     create `docs/page/wiki-main-source.ts` · modify `docs/main/view-watches.ts` (comments only) · modify `docs/page/tree-view.ts`, `docs/page/docs-view.ts`, `docs/page/start.ts`, `docs/page/docs-state.ts`, `docs/contract.ts`, `docs/main/start.ts`, `docs/main/doc-files.ts`, `docs/manifest.ts`, `src/plugins/keymap.ts`, `docs/layouts/layout.d.ts`, `docs/layouts/default/layout.js`, `docs/layouts/default/layout.css` · test `docs/page/wiki-main-source.test.ts`, `docs/page/tree-view.test.ts`, `docs/page/docs-state.test.ts`, `docs/main/doc-files.test.ts`

This task does not touch `DocView` and does not call `DocView.setEntries`. Task 07 adds that method, and task 09 wires it in `showDocument`.

Consumes:
- `parseWikiMain(text: string): WikiShelf[]`, `WikiShelf` ← 03
- From 06, in `docs/tree.ts`:
  - `buildWikiTree(shelves, entries, mainFolder, homeDir, paths): TreeNode[]`
  - `buildWikiFilterTree(entries, homeDir, paths): TreeNode[]`
  - `TreeWikiLink`, `TreeWikiLabel`, `TreeHeadingMatch`
- From 06, in `docs/page/docs-state.ts`:
  - `visibleRows(tree, state, pathOf, headingsOf, matcher): TreeRow[]`
  - `TreeRowAction`'s `{ type: 'openWikiLink'; focusDoc: boolean }`
  - `defaultExpandedIds(tree)`, which already expands every shelf
- From 06, in `docs/page/tree-view.ts`: `TreeView.setTree(tree, pathOf, headingsOf, hasIndex)`
- Part `sidebarSwitch`, input `{ view: 'wiki' | 'all' }` ← 05

Produces:
- `docs/page/wiki-main-source.ts`:
  - `createWikiMainSource(deps: WikiMainSourceDeps): WikiMainSource`
  - `WikiMainSourceDeps { viewId: string; channel: PageChannel<DocsChannel>; log: PluginLog; changed(): void }`
  - `WikiMainSource { start(): Promise<void>; path(): string | null; shelves(): readonly WikiShelf[]; isRead(): boolean; exists(): boolean; diskChanged(change: DocChange): void; reread(): Promise<void>; dispose(): void }`
- `docs/contract.ts`: channel call `wikiMainPath(): Promise<string>`
- `docs/main/doc-files.ts`: `DocFiles.wikiMainPath(): Promise<string>`
- `docs/page/tree-view.ts`:
  - `export type SidebarView = 'wiki' | 'all'`
  - `TreeView.setWikiTree(tree: TreeNode[], filterTree: TreeNode[], hasIndex: boolean): void`
  - `TreeView.showView(view: SidebarView): void`
  - `TreeView.shownView(): SidebarView`
  - `TreeView.selectedIn(view: SidebarView): TreeNode | null`
  - `TreeViewDeps.hasWiki: boolean`
  - `TreeViewDeps.openWikiLink(link: TreeWikiLink, focusDoc: boolean): void`
  - `TreeViewDeps.switchView(): void`
- `docs/page/docs-view.ts`: `DocsViewCommands.toggleWikiView(): void`
- `docs/manifest.ts`: command `toggleWikiView`
- `docs/layouts/layout.d.ts`:
  - `TreeRowInput.type: 'group' | 'entry' | 'wikiLink' | 'wikiLabel'`
  - `TreeRowInput.isDangling: boolean`
  - `TreeRowInput.count: number | null`
  - `TreePaneKit.sidebarSwitch(parent: HTMLElement): HTMLElement`
- `docs/page/docs-state.ts`:
  - `expandNewGroups(previous: readonly TreeNode[], next: readonly TreeNode[], expanded: ReadonlySet<string>): Set<string>`
  - `TreeLineState.isWikiView: boolean`

Log lines this task emits, each prefixed `[docs] ` in the page log. Task 12 expects them word for word:
- `sidebar shows the wiki`
- `sidebar shows All pages`
- `read Main.md: <n> shelves`
- `stars stay in All pages`
- `refused <title>: not in the index`

Other log lines:
- `no Main.md: <error text>`
- `not watching Main.md: <error text>`

Decisions:

**Which views.** `createDocsView` already computes `isMachine` from `deps.sourceId`. Use it. No new dep goes to `createDocsView`. Only the machine view creates a `WikiMainSource` and passes `hasWiki: true` to `createTreeView`. A session view passes `hasWiki: false`, and it never draws `sidebarSwitch`. `../design.md` § Session Docs tabs is the reason.

**The path of `Main.md`.** Main holds the path. `DocFiles.wikiMainPath` returns `realTarget(files, paths.join(homeDir, WIGLEY_AGENTS_FOLDER, 'wiki', 'Main.md'), paths)`. `realTarget` works when the file is absent. Reason: `~/wigley-agents` is a symlink on the user's Mac, and every index entry holds a real path. A `mainFolder` taken from the page's `homeDir` gives a relative link a path that no entry holds. The page calls `wikiMainPath` once, in `start`. `paths.parent` of the result is `mainFolder`. A rejected `wikiMainPath` gives the same state as a rejected read (below), and `path()` stays null.

**The read.** `WikiMainSource` reads through the channel's `readDoc`. It keeps the last text, which starts as `undefined` (a sentinel: unread, distinct from null). It parses each read with `parseWikiMain`, and calls `changed` when the text differs from the last text. So the first settle always calls `changed`, whether the file is present or absent. The order in which the index and the first read land is not fixed, and `hasIndex` depends on `isRead()`, so the first settle must redraw. The source logs `read Main.md: <n> shelves` at each read that calls `changed`. A rejected `readDoc` means no `Main.md`: `exists()` is false, `shelves()` is empty, `isRead()` is true, and the log takes `no Main.md: <error text>`. After the first settle, the last text of an absent file is null. So a file that goes away calls `changed`, and a file that appears calls `changed`. The first settle with an absent file calls `changed` once, from `undefined` to null, and logs `no Main.md: <error text>`. A newer read drops the answer of an older read.

**The watch.** The page calls `watchDoc` with a second id, `${viewId}:main`. For the machine view the id is `machine:main`. `createViewWatches` keys by the string it gets, so main's logic does not change. Its comments do: `docs/main/view-watches.ts` says "One watched file per view, each change sent as that view's `DocChange`" and "Closes the view's watch". Change them to say a watch id (`<viewId>:main` among them) in place of a view. Also change the comment on `DocChange.viewId` in `docs/contract.ts` to say it holds the watch id. Edit comments only, no code. `docFiles.watch` watches the parent folder, so the watch works while `Main.md` is absent and its folder exists. When the folder is absent, `watchDoc` rejects: log `not watching Main.md: <error text>`, and try the watch again at the next `reread`.

The start order and the retries:
- `start` calls `wikiMainPath` first. After it resolves, `start` calls `watchDoc` first, and then does the first read. A watch placed before the read cannot miss a write between the two.
- The source keeps a flag `isWatching`, false at the start. A `watchDoc` that resolves sets it true. `reread` calls `watchDoc` only while it is false, so a repeat is never sent.
- `reread` calls `wikiMainPath` again while `path()` is null, and one rule serves both failures: with a path, the source goes on to the watch and the read. Change the comment on `watchDoc` in `docs/contract.ts` to "One watched file per watch id; `path` null stops that watch". The `docChanged` listener in `createDocsView` passes each change to `wikiMain?.diskChanged`. `diskChanged` acts only on `viewId === ${viewId}:main`, and it calls `reread`. `dispose` calls `watchDoc(id, null)`.

**The write guard.** A `:w` on `Main.md` fires this watch. The sidebar holds no edit, so the source needs no `writingText` guard. The compare with the last text stops a second draw when a later read gives the same text. `doc-view.ts`'s own watch and its `writingText` do not change. `changeRefusal` already allows a write inside `~/wigley-agents`, so the path guard does not change.

**When the source reads.** `start` resolves once the first read settles, and it never rejects. A second `start` call returns the same promise. A `reread` before `start` runs `start`. `showFirstTime` calls `wikiMain?.start()` and `runIndex('loadIndex')` in the same turn, with no wait between them. `rescan` and every `runIndex` landing call `wikiMain?.reread()`, so a `Main.md` created outside the app shows after the next index run.

**One tree state per tree.** `tree-view.ts` holds one slot per `SidebarView`:

- The slot is `{ tree, filterTree, state: TreeState, hasRows, hasTree }`.
- `filterTree` is `TreeNode[] | null`. The `all` slot holds null. The `wiki` slot holds the result of `buildWikiFilterTree`.
- Selection, expanded ids and the filter text each live in their slot.
- The module's `tree`, `state`, `hasRows` and `hasTree` become reads of the shown slot.
- `setTree` writes the `all` slot and acts as it does today. `setWikiTree` writes the `wiki` slot. A slot that is not shown does not draw.
- The shown slot at creation is `wiki` with `hasWiki`, else `all`.
- `pathOf` and `headingsOf` stay one function each for the view, as both trees read the same entries. `setTree` sets them. `setWikiTree` takes neither. Each starts as a function that reads nothing (`() => ''`, `() => []`), which is used only while `document` is null.

**The tree the rows read.** A private `rowTree(slot)` returns `slot.filterTree` when `slot.filterTree` is not null and `slot.state.filter.trim()` is not empty. Otherwise it returns `slot.tree`. Each `visibleRows` call and each `treeRowAction` call takes `rowTree(slot)`. So `parentId` reads the tree that holds the row. This is what `../design.md` § Search needs: the wiki view's filter covers the user's whole own list, and it shows section headings through task 06's rows. `treeLine`'s `isIndexEmpty` is `rowTree(slot).length === 0`. So with no `Main.md`, the filter still finds the user's docs.

**Wiki expansion.** The first wiki tree with rows expands `defaultExpandedIds(tree)`, and selects `rows[0]`. Task 06 has a test that this expands every shelf and adds no label or link. Reason: a label is only a heading in the curated list. `defaultExpandedIds` does not change. A later wiki tree keeps the expanded ids and also expands each group id that was not in the previous tree (`expandNewGroups`). `expandNewStarred` stays with the `all` slot.

**A change to `Main.md`.** `changed` calls one function in `createDocsView`, `showWikiTree`, which calls `tree.setWikiTree`. Selection and expanded ids stay in the slot. `showDocument` calls `showWikiTree` too, after `tree.setTree`. `showWikiTree` passes `buildWikiFilterTree(next?.entries ?? [], deps.homeDir, deps.paths)` as `filterTree`. The `all` slot keeps today's behaviour.

**A selection that goes away.** In `draw`, in the `wiki` slot with no filter: when the selected id names no row, select `rows[0]`. This one rule covers a new wiki tree that drops the row. It also covers a filter that ends while a row of `filterTree` is selected, which the shelves do not hold. While a filter is on, the selection stays as it does in All pages.

**Before the index lands.** `showWikiTree` builds with `[]` shelves while `document` is null. `hasIndex` is `document !== null && wikiMain.isRead()`. So `buildWikiTree` never marks every row dangling over an empty entry list. With `path()` null, the shelves tree is `[]`.

**The empty wiki.** `treeLine` takes `isWikiView`. With `isIndexEmpty` and `isWikiView`, the text is `No pages in Main.md`, and the hint stays `{ command: 'rescan', words: 'to rescan' }`.

**The switch.** `showView` dismisses an open filter box through the code `dismissFilter` runs, then draws the new slot. `DocsViewCommands.toggleWikiView` in `createDocsView`:

1. On a session view: `toast("A session's Docs tab keeps its own tree", 'info')`, and stop.
2. Call `deps.revealTree()`. A switch that the user cannot see helps nobody, and `revealTree` does nothing while the tree shows.
3. Call `tree.showView`, then log `sidebar shows the wiki` or `sidebar shows All pages`.

Focus does not move. `TreeViewDeps.switchView` calls the same function.

**Key.** `{ keys: '<Leader>vw', scope: 'any', command: 'docs.toggleWikiView' }`, directly after the `<Leader>vt` line in `keymap.ts`. Manifest: `toggleWikiView: { label: 'switch the sidebar between the wiki and All pages', group: 'view', runsIn: 'page' }`. `start.ts`: `toggleWikiView: onActiveView('toggleWikiView')`. Do not add it to `TREE_COMMANDS_IN_SIGHT`. With no active docs view the command does nothing, as `onActiveView` does today. A leader sequence is out of the placement check. `docs/keymap.md` already lists `vw`.

**The filter's label.** Task 06 leaves this to this task. In `manifest.ts`, the `filter` command's label becomes `filter by title, path or heading`.

**The control.**

- `tree-view.ts` draws `sidebarSwitch` with `{ view: shownView }` into a slot `div.docs-switch-slot`, only with `hasWiki`. Without `hasWiki`, the slot has `hidden = true` and draws no part.
- Task 05 does not place this slot, so this task adds `sidebarSwitch(parent: HTMLElement): HTMLElement` to `TreePaneKit`.
- In `drawPane`, the slot is the first of the placed slots. So a layout that leaves all of them out gets it first. Change the order in the comment above `TreePaneInput` to `sidebarSwitch, status, filterBox, line, rows`.
- The default `treePane` calls `kit.sidebarSwitch(pane)` after the header and before `kit.status(pane)`.
- Set `rowAction(drawn.element, () => deps.switchView())` on the drawn root.
- Draw the part again on each `showView` and in `redraw`. `dispose` disposes it.

**Drawing the wiki rows.** Task 06's `rowInput` maps every non-group row to `'entry'`. This task widens it, after task 05:

| Node | `type` | `isDangling` | `count` | Other fields |
|---|---|---|---|---|
| `group` | `group` | false | null | as today |
| `entry` | `entry` | false | null | as today, so a wiki page row shows its time, star and mark as any leaf does |
| `headingMatch` | `entry` | false | null | as task 06 draws it: `detail` is `docTitle` |
| `wikiLink` | `wikiLink` | `node.isDangling` | `node.count` | `time: null`, `isStarred: false`, `mark: null`, `detail: null` |
| `wikiLabel` | `wikiLabel` | false | null | `time: null`, `isStarred: false`, `mark: null`, `detail: null` |

In the default `treeRow`:

- A `wikiLink` and a `wikiLabel` draw no caret icon.
- A dangling `wikiLink` takes class `docs-row--dangling`.
- A `wikiLabel` takes class `docs-row--label`.
- `rowEnd` draws `count` as `span.docs-row-count`, before `docs-row-time`, when `count` is not null. So `rowEnd` makes `span.docs-row-end` when `time` or `count` is not null.

Add the three classes to `layout.css`:

- `.docs-row-count`: the text token `.docs-row-time` uses.
- `.docs-row--dangling`: `--wg-fg-tertiary`.
- `.docs-row--label`: `--wg-fg-tertiary`, `--wg-text-12`.

**`l` and Enter.** `actOnSelected` calls `deps.openWikiLink(node, action.focusDoc)` on `action.type === 'openWikiLink' && node.type === 'wikiLink'`, after `draw()`, as the leaf branch does. A page with a `path` or `skill` target and an entry is a `TreeLeaf`, so `deps.openLeaf` opens it with no change. Task 06's `buildWikiTree` makes a `TreeWikiLink` with a `path` or `skill` target only when it is dangling. `openWikiLink` in `createDocsView` reads `isDangling` first, then the target:

| Row | `l` and Enter |
|---|---|
| dangling | `toast('Not in the docs index: <title>', 'info')`, log `refused <title>: not in the index` |
| `all` | `tree.showView('all')`, log `sidebar shows All pages`. No `leafOpened`: the user is still in the sidebar |
| `kind`, `owner` | `toast('This list page is not drawn yet', 'info')`. Task 11 replaces this row |

A row click runs `view.open()` as today, so it opens with `focusDoc` false.

**`treeOpenedOver`, `picked()`, narrow.** `deps.leafOpened` is the only call to `mode.picked()`, and `openLeaf` runs it, so a wiki page row closes a narrow window's overlay as any leaf does. `treeOpenedOver`, `showTreeEdge`, `onWindowResize` and `runInDocPane` do not change. `TREE_COMMANDS_IN_SIGHT` does not change.

**Shared with task 11.** `createDocsView` holds two private functions, and `openWikiLink` calls them: `refuseMissingPage(title)` shows the dangling row's toast and writes its log line, and `showAllPages()` switches to All pages and logs `sidebar shows All pages`. Task 11 calls both.

**`s` on a wiki row.** `toggleStar`, in the wiki view: `toast('Stars stay in All pages', 'info')`, log `stars stay in All pages`, for every row type. The star set does not change. The `all` view is as today.

**The cursor prompt.** Task 06 keeps `isPrompted` as `node.type === 'entry'`. So a page row is prompted, and a `wikiLink`, a `wikiLabel` and a `headingMatch` are not. In the `wiki` slot, the prompt places a second element, built by `rowActionsElement` over `['rename', 'rename'], ['trash', 'trash']`. So the prompt never offers a star there. In the `all` slot, the prompt is as today. Change the comment on `TreeRowKit.cursorPrompt` in `layout.d.ts` so that it says the wiki view leaves out `s star`.

**`r`, `d`, `a`, `A`.** A page row is a `TreeLeaf`, so `changeable` and `selectedFolder` need no mapping. Task 06 already refuses the other node types in `changeableEntry` and gives null in `selectedFolder`. `a` is as today. Every change runs `applyDocChange`, which rebuilds both trees. A row whose file moved or went to the Trash then shows dangling, since `Main.md` is the user's file and this task does not rewrite it.

**`selectEntry`.** It runs today's steps on each slot on its own, and then draws the shown slot once.

- The `all` slot is as today.
- The `wiki` slot looks for the id `entry:<entryId>` in `rowTree(slot)`. This is the id of the entry's first leaf in the shelves and its leaf in `filterTree`. When the tree holds it, the slot selects it and expands the groups above it.
- A wiki tree with no such row keeps its selection.
- A slot that does not hold the row does not stop the other slot.

**The Starred row.** `starChange` reads `tree.selectedIn('all')` before and after `showDocument`, in place of `tree.selected()`, so an unstar from another view moves the `all` cursor while the wiki shows. `selectedIn` runs `visibleRows` over `rowTree(slot)` of that slot, and finds `state.selectedId` in the result.

**First selection.** Opening on Main is task 11. It selects no row. The first row of the wiki tree stays selected.

**Comments.** Update the block comment above `TreeView` so that it names the two views, the second tree and the switch.

GIVEN a `Main.md` text and a later different text WHEN the watch fires for `machine:main` THEN `changed` runs once and `shelves()` holds the new shelves
GIVEN the same text on two reads WHEN the second read lands THEN `changed` does not run again
GIVEN `readDoc` rejects WHEN `start` runs THEN `exists()` is false, `shelves()` is empty and `isRead()` is true, and `changed` ran once
GIVEN `watchDoc` rejects at `start` WHEN `reread` runs twice THEN the first `reread` calls `watchDoc` again, it resolves, and the second `reread` does not call it
GIVEN `wikiMainPath` rejects at `start` WHEN `reread` runs THEN `wikiMainPath` is called again
GIVEN a read text WHEN a later `readDoc` rejects THEN `changed` runs once and `exists()` is false
GIVEN a change with another view's id WHEN `diskChanged` runs THEN no read starts
GIVEN `~/wigley-agents` is a symlink WHEN `wikiMainPath` runs THEN it returns the path through the link's real target, with or without the file
GIVEN the wiki view with a selected row and a collapsed group WHEN `showView('all')` then `showView('wiki')` runs THEN the row stays selected and the group stays collapsed
GIVEN the `all` view with a filter WHEN the view switches to `wiki` THEN the wiki rows show unfiltered, and the filter returns on the switch back
GIVEN the wiki view with a filter that a doc outside `Main.md` matches WHEN the rows draw THEN that doc's row shows under its repo and kind groups
GIVEN the wiki view with a selected row of `filterTree` that the shelves do not hold WHEN the filter ends THEN the first row is selected
GIVEN a new wiki tree that drops the selected row WHEN `setWikiTree` runs THEN the first row is selected
GIVEN a new wiki tree that adds a group WHEN `setWikiTree` runs THEN the new group is expanded and the collapsed group stays collapsed
GIVEN a dangling wikiLink WHEN the row draws THEN the input holds `isDangling: true` and the row is not prompted
GIVEN a wikiLink with a count WHEN the row draws THEN the input holds that count
GIVEN a wikiLabel WHEN the row draws THEN the input's `type` is `wikiLabel` and the row is not prompted
GIVEN a selected page row in the wiki view WHEN the row draws THEN its prompt offers rename and trash and no star
GIVEN an entry in the shelves and in All pages WHEN `selectEntry` runs THEN each slot selects it, and `selectedIn('all')` returns the leaf while the wiki shows
GIVEN a session view's tree WHEN it draws THEN no `sidebarSwitch` draws, and `setTree` shows its tree

Tests:
- `docs/page/wiki-main-source.test.ts` (new). Build the text in the test, with shelf names the test owns, per `../design.md`'s no fixed shelf names. `describe('createWikiMainSource')`, one `it` per GIVEN on the source above, over a fake channel with deferred reads. Add one race: an older read that lands after a newer read draws nothing.
- `docs/main/doc-files.test.ts`: a table `wikiMainPath` over `createMemoryFiles`, rows for a plain home folder, a linked `wigley-agents` folder, and a missing `wiki` folder. Each row holds a literal expected path.
- `docs/page/tree-view.test.ts`: one `it` per GIVEN on `showView`, `setWikiTree`, the row input, the prompt and `selectEntry` above. The file's deps gain `hasWiki`, `openWikiLink` and `switchView`. Add one `it`: `l` on a `wikiLink` calls `openWikiLink` with that link and `focusDoc` false, and Enter gives `focusDoc` true. The break is a missed wire, which leaves a link row dead.
- `docs/page/docs-state.test.ts`: add a row to the existing `treeLine` table for `isWikiView`. Add `expandNewGroups` as one table.
- The full key flow is a self-test group in task 12. The final verification task (14) holds any live check.

Done when: the type check passes. The test gate runs the tests above. `grep -n "docs.toggleWikiView" src/plugins/keymap.ts` shows one `<Leader>vw` line. `grep -n "setEntries" src/plugins/docs/page/docs-view.ts` shows nothing.
Commit:    one commit for the group

## Proof

Commit d7270be4 · proof: diff read, every Produces present by search, tsc and lint clean, Done-when greps hold (one <Leader>vw line, no setEntries in docs-view.ts) · concerns: Space v w with the filter box focused leaves focus on a hidden input; an unstar elsewhere can also move the wiki cursor; with no entries a wiki filter shows No pages in Main.md; dangling and label row colours unseen on screen; wikiRowActions anchors are built in session views too; Docs mode opens on the wiki, so self-test groups expecting All pages fail until task 12
