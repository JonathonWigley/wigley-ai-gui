# 11 — Main page and list pages

Status: done
Type: Task
Wave: 7 · Depends on: 03, 04, 05, 06, 07, 08, 09, 10
Plan: [plan.md](plan.md)

All paths are in wigley-ai-gui. `src/plugins/docs/` is written as `docs/` below, with one exception: "the repo's keymap doc" is `docs/keymap.md` at the repo root. This task consumes from 04, 05, 06, 07, 08 and 10, and it shares files with 03 and 09.

Files:     create `docs/page/list-page.ts`, `docs/page/list-pane.ts`, `docs/page/main-page.ts` · modify `docs/page/doc-view.ts`, `docs/page/docs-view.ts`, `docs/page/start.ts`, `docs/page/doc-history.ts`, `docs/page/docs.css`, `docs/tree.ts`, `docs/wiki-main.ts`, `docs/manifest.ts`, `docs/layouts/layout.d.ts`, `docs/layouts/default/layout.js`, `src/plugins/keymap.ts`, the repo's keymap doc · test `docs/page/list-page.test.ts`, `docs/page/list-pane.test.ts`, `docs/page/main-page.test.ts`, `docs/page/doc-view.test.ts`

The repo's keymap doc is in Files because the doc written ahead (`4b3aea5c`) changes only the `v` group, and it does not name `gh`.

Consumes:
- `DocHistory`, `DocPlace` ← 03. The table of link targets in `docs/wiki-main.ts` ← 03.
- `DocsChannel.invoke.recentChanges(paths: string[]): Promise<RecentChange[]>`, `RecentChange` ← 04
- From 05, in `docs/layouts/layout.d.ts`, word for word:
  - `MainEmptyInput { path: string }`, `MainEmptyKit.createMainHint(parent: HTMLElement): HTMLElement`
  - `RecentChangesInput { rows: { sha: string; subject: string; time: { text: string; title: string }; pages: { title: string; path: string }[] }[] }`, `RecentChangesKit.pageLink(parent: HTMLElement, title: string, path: string): HTMLElement`
  - `ListPageInput { title: string; count: number; groups: { title: string; rows: ListRowInput[] }[] }`, `ListPageKit.rows(parent: HTMLElement, groupIndex: number): HTMLElement`
  - `ListRowInput { title: string; path: string; time: { text: string; title: string } | null }`
- `wikiListEntries(target, entries): IndexEntry[]`, `TreeLeaf`, `TreeWikiLink` ← 06
- `article`, the frame slots in `doc-view.ts` ← 07
- `WikiMainSource`, `TreeView.showView`, `TreeView.selectEntry`, and the row `kind`, `owner` of `openWikiLink`'s table ← 08
- `refuseMissingPage(title: string): void` and `showAllPages(): void`, private in `createDocsView`, ← 08
- `DocView.open(target, options?)`, `DocViewDeps.followPlace(path, line)`, `openListed`, the two history records in `view.open`, `moveInHistory`, `div.docs-history` in the default `docPane` ← 10

Produces:
- `docs/wiki-main.ts`: `export function parseWikiTarget(text: string): WikiTarget | null`
- `docs/tree.ts`:
  - `export function newestLoadedFirst(entries: readonly IndexEntry[]): IndexEntry[]`
  - `export function findSkillEntry(name: string, entries: readonly IndexEntry[]): IndexEntry | null`
- `docs/page/list-page.ts`:
  - `export type ListTarget = Extract<WikiTarget, { type: 'kind' | 'owner' }>`
  - `export function listPlace(target: ListTarget): string`
  - `export function listTargetOfPlace(path: string): ListTarget | null`
  - `export interface ListPageContent { place: string; input: ListPageInput; entryIds: string[][] }`
  - `export function listPageContent(target: ListTarget, title: string, entries: readonly IndexEntry[], homeDir: string, now: number, paths: Paths): ListPageContent`
- `docs/page/list-pane.ts`:
  - `export function createListPane(deps: ListPaneDeps): ListPane`
  - `export interface ListPaneDeps { slot: HTMLElement; parts: DocsParts; openEntry(entryId: string): void }`
  - `export interface ListPane { show(content: ListPageContent): void; clear(): void; isShown(): boolean; move(by: 1 | -1): void; openCursor(): void; setFocused(isFocused: boolean): void; redraw(): void; dispose(): void }`
- `docs/page/main-page.ts`:
  - `export const MAIN_STARTER_TEXT: string`
  - `export interface LinkedPage { title: string; path: string }`
  - `export function linkedPages(tree: readonly TreeNode[], entryOf: (entryId: string) => IndexEntry | undefined): LinkedPage[]`
  - `export function recentRows(changes: readonly RecentChange[], pages: readonly LinkedPage[], now: number, paths: Paths): RecentChangesInput['rows']`
  - `export function createRecentReader(deps: RecentReaderDeps): RecentReader`
  - `export interface RecentReaderDeps { channel: PageChannel<DocsChannel>; pages(): LinkedPage[]; now(): number; paths: Paths; log: PluginLog; show(input: RecentChangesInput | null): void }`
  - `export interface RecentReader { refresh(): void; clear(): void }`
- `docs/page/doc-view.ts`:
  - `export type DocPage = { type: 'list'; content: ListPageContent } | { type: 'mainEmpty'; path: string }`
  - `DocView.showPage(page: DocPage, options?: { isHistoryMove?: boolean }): boolean`
  - `DocView.updateList(content: ListPageContent): void`
  - `DocView.shownPage(): DocPage | null`
  - `DocView.isBlank(): boolean`
  - `DocView.setRecentChanges(input: RecentChangesInput | null): void`
  - `DocView.listOpen(): void`
  - `DocViewDeps.openListEntry(entryId: string): void`
  - `DocViewDeps.createMain(): void`
  - `DocViewDeps.followWikiLink(href: string, title: string): boolean`
- `docs/page/docs-view.ts`:
  - `DocsView.openMain(): void`
  - `DocsViewCommands.listOpen(): void`
- Commands `docs.openMain`, `docs.listOpen`.

Log lines this task emits, each prefixed `[docs] ` in the page log. Task 12 expects them word for word:
- `opened the Main page`
- `Main page already shows`
- `showed the empty Main page`
- `Main page ready`: logged last, after any of the three above, in every `showMain` outcome that leaves the page shown
- `no Main page path`
- `created Main.md`
- `Main.md not created: <error text>`
- `listed <title>: <n> docs`
- `recent changes: <n> commits`
- `recent changes not read: <error text>`

A refused skill link in a rendered body takes task 08's toast and log, through task 08's `refuseMissingPage(title)`. `wiki:all` in a rendered body takes task 08's `showAllPages()`, which logs `sidebar shows All pages`. This task writes neither text. A doc that a list row or the Main page opens also logs the existing `opened <name>`.

Bind anchors, for task 12's placement check:

| Bind | Scope | Anchor |
|---|---|---|
| `gh` | `docs.tree` | the default `treePane` header's `main` hint |
| `gh` | `docs.doc` | the default `docPane`'s `main` hint in `div.docs-history` |
| `l`, `<CR>` | `docs.doc` | none: each is one of vim's own keys (`src/plugins/keys/page/vim-keys.ts`) |

## Decisions: a page with no file

**The state.** The doc pane is keyed by path through `shown`. A list page and the empty Main page have no file. So `doc-view.ts` holds a second state beside `shown`: `let page: DocPage | null = null`. `shown` and `page` are never both set. With `page` set, `openPath()` returns null. So a rename, a trash, the unsaved guard and the title bar treat the pane as a pane with no file, with no code change. `openChanged(null)` runs when a page replaces a doc, so the title bar shows no path. Change the comment on `DocsViewDeps.openChanged` and `DocViewDeps.openChanged`: null means the pane holds no file.

**The frame.** `pageFrame` draws once for the view's life. This task adds two slots inside `article`, so list pages stay in the same frame, per `../design.md` § Page. The article's order is `headerSlot`, `bannerSlot`, `promptSlot`, `bodySlot`, `recentSlot`, `pageSlot`, `editorSlot`.

- `recentSlot` is `element('div', 'docs-slot docs-recent-slot')`.
- `pageSlot` is `element('div', 'docs-slot docs-page-slot')`.
- Task 09's `article.append(editorSlot)` and `article.insertBefore(…, bodySlot)` still hold.
- `docs.css` gains `.docs-doc.is-editing .docs-recent-slot { display: none }`. A section edit does not set `is-editing`, so Recent changes stays under the rendered page, as `../design.md` § Section editing asks.
- `docs.css`: the selector list of `.docs-doc > .docs-slot > .ui-empty` gains `.docs-article > .docs-page-slot > .ui-empty`.

**`data-doc`.** `showDocState` sets `page` while `page` is not null. So `[data-doc='none'] .docs-doc-top` does not hide the top row, and the `‹ tree` edge and the history pair stay. Change the comment on `DocPaneKit` in `layout.d.ts` to name `page`: a list page or the empty Main page.

**`showPage(page, options)`** does these steps, in order:

1. `view.refuseWithUnsavedEdits()` is true: return false.
2. `openCount++`, which drops an open in flight.
3. Without `isHistoryMove`: record the place being left. This is the first record of task 10's `view.open`. Extract it to a private `recordPlaceLeft()`, and both call it.
4. `shown` and `editor` are set: `closeEditor(shown)`.
5. `shown` is set: `watchFile(null, shown.name)`, `shown = null`, `deps.openChanged(null)`.
6. Dispose the page drawn before, `removeEmpty()`, `showBanner(false)`, `drawHeader()`, and `drawBody({ fields: [], html: '', bodyStartLine: 1, liveFences: true })`. The header is then empty. Task 07's `drawAside` hides the column.
7. Set `page`, `showDocState()`, `pane.scrollTop = 0`, and draw the page.
8. A `list` page without `isHistoryMove`: `history.push({ path: content.place, line: null })`.
9. Return true.

`view.open`, on success: set `page = null` and dispose the drawn page, in the same step that sets `shown`. `view.clear` returns while `shown` is null, as today, so it leaves a page alone.

**`isBlank()`** returns `openCount === 0 && shown === null && page === null`. So it is false once any open is asked, also one that is still in flight.

**`updateList(content)`** runs only while a `list` page shows. It saves `pane.scrollTop`, calls `listPane.show(content)`, and sets `pane.scrollTop` back. It records no history.

**Other members of `DocView` with a page.**

- `redrawParts`: draws the page again when `page` is set, and draws `recentChanges` again when its input is set.
- `dispose`: disposes the list pane, the `mainEmpty` part and the `recentChanges` part.
- `view.scroll(by)`: with a list shown, calls `listPane.move(by)` and returns. So `j` and `k` move the cursor on a list page. `Ctrl+j` and `Ctrl+k` still scroll the pane.
- `view.listOpen()`: with a list shown, calls `listPane.openCursor()`. With no list shown, it reads `pane.ownerDocument.activeElement`. When that element is inside `pane`, it takes `activeElement.closest('a, button')`, and calls `.click()` on the result when it is not null. In any other case it does nothing: no focused element, one outside `pane`, or one with no `a` or `button` around it. So a focused `rowAction` div or the editor host gets no click. So the `<CR>` bind leaves Enter on a focused link or button working: `src/renderer/page-keys.ts` calls `preventDefault` on each key that a bind consumes, so the native activation does not run.
- `pane` `focusin` and `focusout`: call `listPane.setFocused`, in the pattern of `tree-view.ts`'s two listeners.
- `view.edit(line)`: first, with `page?.type === 'mainEmpty'`, calls `deps.createMain()` and returns. Task 09's `editSection` returns while `shown` is null, so `e` does nothing on a page.

Update the block comment above `DocView`, so it names the two pages and Recent changes.

## Decisions: history

A list page is in the history. Reason: a row opens a doc, and `Ctrl+o` then returns to the list, as vim's jump list does.

- **The form of a place.** `DocPlace.path` holds `listPlace(target)`, with `line: null`. `listPlace` gives `wiki:kind/<kind>` or `wiki:owner/third-party`, which is the link's own text. `DocPlace`'s type does not change. Change `DocPlace`'s comment in `doc-history.ts`: `path` is a file's path or a list page's `wiki:` place.
- **No other change to task 10's moves.** `view.open`'s records read `shown`, which is null on a list. The list's place is already the current entry, so a doc opened from a row pushes after it. `moveInHistory`'s same-path step reads `shown`, so a list place reaches `deps.followPlace`.
- **`followPlace`.** In `docs-view.ts`, `followPlace: (path, line)` calls `listTargetOfPlace(path)`. With a target: `openList(target, listTitles.get(path)!, { isHistoryMove: true })`. Otherwise: `openListed(path, line, null, { isHistoryMove: true })`, as task 10 settles.
- **The title.** `docs-view.ts` holds `listTitles = new Map<string, string>()`. `openList` sets `place → title` each time. A history place comes from an `openList` in this view, so the map holds it. Read it with a non-null assertion, as `takeFiles` does.
- **The cursor.** `ListPane` keeps one cursor per place for the view's life. So a move back shows the row the user opened.
- **The empty Main page** is not a place. `showPage` records the place left and pushes nothing, since `DocPlace` has no form for it and the page has nothing to return to.

## Decisions: the Main page

**The Main page is `Main.md`, opened as any doc.** `doc.open(targetFor(path, entryAt(path), null, null))`. So `i`, `e`, `:w`, the watch, the right column and the links all work with no new code, and its body stays editable. History needs no code: `doc.open` pushes by itself (task 10).

**`showMain(isPicked: boolean)`,** private in `createDocsView`. `path` is `wikiMain.path()`:

1. `path` is null: log `no Main page path`, and stop. In steps 2 to 4, log `Main page ready` after the line each names, and before `deps.leafOpened()`.
2. `doc.openPath()` is `samePath` with `path`, or the empty Main page shows while `exists()` is false: log `Main page already shows`. With `isPicked`, call `deps.leafOpened()`. Stop. A second open would close the editor.
3. `wikiMain.exists()` is false: `doc.showPage({ type: 'mainEmpty', path: deps.paths.tilde(path, deps.homeDir) })`. When it returns true: log `showed the empty Main page`. With `isPicked`, call `deps.leafOpened()`.
4. Otherwise: `doc.open(…)` as above. When it resolves true: log `opened the Main page`. With `isPicked`, call `deps.leafOpened()`.

**Start.** In `showFirstTime`, in the machine view only, after the calls task 08 places there: `void Promise.all([wikiMain.start(), firstRead.promise]).then(…)`. The `then` runs `showMain(false)` only when `askedOpens === 0 && doc.isBlank()`. The wait on `firstRead` gives the target its entry, so the chips and the read-only line are right. The two checks keep an `openDoc`, `gh` or leaf open that came first. `showFirstTime` runs once per view, so a return to Docs mode keeps the page shown, per `../design.md` § Main page and sidebar. A session view has no `wikiMain` and stays as today. Focus does not move.

**`gh`.** `DocsView.openMain()` in `createDocsView`:

1. `wikiMain` is null: return. Only the machine view has it.
2. `const number = ++askedOpens`.
3. `void Promise.all([wikiMain.start(), firstRead.promise]).then(…)`: when `number === askedOpens`, run `showMain(true)`. `openDoc` already uses `askedOpens`, so the newer ask wins in both ways.

`start.ts`: extract `showDocsMode()` from `openDoc`: `if (!mode.isShown()) mode.show()`. `openDoc` calls it, then `machineView.openDoc`. The command `openMain` calls it, then `machineView.openMain()`. The command does not use `onActiveView`. So `gh` on a session's Docs tab shows Docs mode and opens Main there. It leaves the session tab and its editor as they are. It does not call `openDoc` itself, for two reasons: `start.ts` does not hold the path, and `followFile` toasts `Not an indexed doc` where the empty Main page must show.

Focus does not move. `isPicked` closes a narrow window's overlay through `deps.leafOpened()`, as a leaf does.

**Key.** In `keymap.ts`, `{ keys: 'gh', scope: 'docs.tree', command: 'docs.openMain' }` after the `G` line of `docs.tree`, and `{ keys: 'gh', scope: 'docs.doc', command: 'docs.openMain' }` after the `<Esc>` `docs.backToTree` line. Give no `where`, so vim keeps `gh` inside a box. Manifest: `openMain: { label: 'open the Main page', group: 'doc', runsIn: 'page' }`.

**Anchors.** `gh` is not one of vim's own keys, so each scope needs an anchor.

- `TREE_HINTS` in `layout.js` gains `['openMain', 'main']`, after `['pickContext', 'folder']`.
- The default `docPane`: `kit.keyHint(history, 'openMain', { label: 'main' })`, first in task 10's `div.docs-history`.

**The repo's keymap doc.** In § Layers, the raw-key bullet gains this sentence: `gh` opens Docs mode's Main page, from any docs view. On a docs list page `j`/`k` move the row and `l`/`Enter` open it.

## Decisions: no `Main.md`

**The draw.** `doc-view.ts` draws `mainEmpty` into `pageSlot`, with `{ path }`. It uses `slotFor` for `createMainHint`, then `placeIfLeftOut`, in the pattern of `drawHeader`. The hint is one app element for the view's life:

- `element('span', 'docs-main-hint')`
- `anchors.push(deps.anchor(hint, 'edit', { scope: 'doc', label: 'create it' }))`
- `rowAction(hint, () => deps.createMain())`

So `i` creates the page, and the existing bind and its anchor carry the key. This task adds no bind for it.

**`createMain`**, private and async in `createDocsView`. `wikiMain` or its `path()` is null: return. Then, in a `try`:

1. `createDoc({ type: 'path', path })`. This existing call makes the `wiki` folder, passes the write guard, and rejects when the file exists. It writes an empty file.
2. `writeDoc(created.path, MAIN_STARTER_TEXT, '')`.
3. `entry = provisionalEntry(created.path, 'reference', document?.entries ?? [], deps.paths)`. `../design.md` § Main page and sidebar names `reference` as the kind of a file in the folder.
4. `applyDocChange({ type: 'created', entry }, null)`, which rebuilds the index.
5. `await wikiMain.reread()`, which also tries the watch again.
6. `await openInEditor(entry, created.line)`, as the existing create flows do.
7. Log `created Main.md`.

On a rejection: `toast(errorText(error), 'error')`, log `Main.md not created: <error text>`.

**The starting text**, pinned, in `MAIN_STARTER_TEXT`. It names no shelf, so the app holds no shelf name:

```
# Main page

Each `##` heading is a sidebar shelf, each `###` heading is a label inside it, and each link is a page. Edit this file to change the sidebar.
```

The value ends with one line break. The sidebar then shows `No pages in Main.md`, from task 08.

**A file that appears or goes.** Task 08's `changed` calls `showWikiTree`. This task adds to the same function, after it: when `doc.shownPage()?.type === 'mainEmpty'` and `wikiMain.exists()`, run `showMain(false)`. During `createMain`, `openInEditor`'s newer `doc.open` wins through `openCount`, so the page opens once, in the editor. A file that goes while it shows keeps today's flow for a gone doc.

## Decisions: Recent changes

**Where it draws.** `DocView.setRecentChanges(input)` keeps the input. It disposes the drawn part, and with a non-null input it draws `recentChanges` into `recentSlot`. `kit.pageLink(parent, title, path)` appends `element('a', 'md-link docs-recent-page')` with `href="#"`, the text `title`, and the `title` attribute `paths.tilde(path, homeDir)`. Its click runs `preventDefault`, then `deps.followFile(path, null, null)`. `recentSlot` is outside `body`, so `followLink` does not hear the click.

**When it shows.** Any route to `Main.md` shows it: a page row, a link, `gh`, history, the start. `docs-view.ts` wraps `openChanged` for `createDocView`:

- It calls `deps.openChanged(path)` first.
- Then, with `wikiMain` set: `path` is not null and is `samePath` with `wikiMain.path()`: `recent.refresh()`. Otherwise: `recent.clear()`.

**The refresh triggers.** Each runs `recent.refresh()` only while `doc.openPath()` is `samePath` with `wikiMain.path()`:

- a `runIndex` landing, after `showDocument`. This covers `R`, a change in the app, and the first read's rebuild.
- Task 08's `changed`, after `showWikiTree`, since the links changed.

`showDocument` itself does not refresh, since a star toggle runs it too.

**The paths asked.** `pages()` is `linkedPages(wikiTree, (id) => entriesById.get(id))`. `wikiTree` is the last shelves tree `showWikiTree` built, which it keeps in a local. `linkedPages` walks the tree in order. Each `TreeLeaf` gives `{ title: leaf.title, path: entry.path }`. It skips a leaf whose entry is gone. It keeps the first title of a path, so a later leaf of one entry adds nothing. A `TreeWikiLink` and a `TreeWikiLabel` give nothing. The call is `recentChanges(pages.map((page) => page.path))`. These are real paths, since every index entry holds one.

**`RecentReader`.**

- `refresh()`: `number = ++asked`. On an answer with `number === asked`: log `recent changes: <n> commits`, where `<n>` is the answer's length, and `show({ rows: recentRows(answer, pages, now(), paths) })`. The rows shown stay until the answer lands, so the list does not flash. It reads `pages()` once per refresh, and it uses that one list for the call and for the rows.
- A rejection with `number === asked`: log `recent changes not read: <error text>`, and `show(null)`. A failure draws nothing. Task 04's handler does not reject, so this covers only a channel failure.
- `clear()`: `asked++`, and `show(null)`.
- An empty answer draws the part with `rows: []`, and the default draws its `No commits touch these pages yet`.

**`recentRows`.** Each `RecentChange` gives one row, in the answer's order:

- `sha`, `subject`: as they are.
- `time`: `{ text: loadedAgo(change.at, now), title: loadedAt(change.at) }`. These are the functions in `docs/loaded-time.ts` behind `docs-row-time`.
- `pages`: for each path of `change.paths`, in order, the first page that is `samePath` with it. A path with no page gives nothing. A page shows once in a row.

## Decisions: list pages

**Opening.** `openList(target: ListTarget, title: string, options?: { isHistoryMove?: boolean }): boolean`, private in `createDocsView`:

1. `listTitles.set(place, title)`.
2. `doc.showPage({ type: 'list', content: listPageContent(target, title, document?.entries ?? [], deps.homeDir, deps.now(), deps.paths) }, options)`.
3. On true: log `listed <title>: <n> docs`, where `<n>` is `input.count`.
4. Return the result.

**Task 08's row.** Replace the row `kind`, `owner` of `openWikiLink`'s table, and remove its toast. The row is now: `openList(link.target, link.title)`. On true: `deps.leafOpened()`, and `focusDocAndLog()` when `focusDoc`. So `l` opens the list and stays in the sidebar. Enter opens it and focuses it.

**An index landing.** `showDocument`, after `showWikiTree`: with a `list` page shown, call `doc.updateList(listPageContent(…))`, with the place's target and title. So the count, rows and times stay true. A list page whose docs are all gone shows `0 docs`.

**`listPageContent`.**

- `place`: `listPlace(target)`.
- `input.title`: `title`, the link's text.
- `input.count` and the rows both come from `wikiListEntries(target, entries)`, so the count and the list agree with the sidebar's count.
- **Groups.** A kind list and a `wiki:owner/mine` list group by repo: the title is `entry.repo`, or `Global` when `entry.repo` is null. The `wiki:owner/third-party` list groups by plugin: the title is `entry.plugin`, the key `<plugin>@<marketplace>` that the tree shows as a plugin node's title (`pluginNodes` in `tree.ts`), or `Global` when `entry.plugin` is null (a synced skill has none). `Global` comes first, then the other groups by `compareTitles`, which is `buildTree`'s order. A group with no rows does not exist. Two clones of one repo share the repo's group, and each row shows. `listPageContent` reads `target.type === 'owner' && target.owner === 'third-party'` to pick the group key.
- **Rows in a group.** `newestLoadedFirst`: newest `lastLoaded` first, then the never-loaded, each by title then id. It extracts `[...entries].sort(byLoaded(byTitleThenId))` from `starredNode`, and `starredNode` calls it.
- `ListRowInput.title`: `entry.title`.
- `ListRowInput.path`: `paths.tilde(entry.path, homeDir)`, then `:<line>` when `entry.line` is not null.
- `ListRowInput.time`: `{ text: loadedAgo(entry.lastLoaded, now), title: 'Last loaded ' + loadedAt(entry.lastLoaded) }`, the same as `leafMarks`. Null when `entry.lastLoaded` is null.
- `entryIds[g][r]`: the id of group `g`'s row `r`.

**A row opens.** `openListEntry(entryId)`, in `createDocsView`: finds the entry in `entriesById`, and returns when it is gone. It runs `doc.open(targetFor(entry.path, entry, entry.line, null))`, and on true `tree.selectEntry(entry.id)`. So:

- a follow-up item opens at its line
- a hook or plugin opens its detail view
- a third-party doc opens read-only through `readOnlyOf`, as today
- the row needs no new rule for any of them

**`ListPane`.**

- `show(content)`: disposes what it drew. It makes one `element('ol', 'docs-list-rows')` per group. It draws `listPage` into `slot`, with `rows: (parent, groupIndex) => slots[groupIndex].place(parent)`, where `slots[i]` is `slotFor(lists[i], 'rows ' + i)`. An index out of range throws, so the part draws with `default`. It runs `placeIfLeftOut` on each slot, in group order. It draws one `listRow` per row into its group's list.
- **The cursor** is an entry id. `show` takes the place's remembered cursor when the content still holds it, else the first row, else null.
- **Each row** gets `rowAction(drawn.element, …)`. A click sets the cursor and calls `deps.openEntry`.
- **Classes.** The cursor's row takes `is-selected`, and also `is-cursor` while `setFocused(true)`. `show` and `move` call `scrollIntoView({ block: 'nearest' })` on it.
- `move(by)`: steps through all rows in group order, clamped at both ends. It logs nothing, as the tree's step does.
- `openCursor()`: with a cursor, calls `deps.openEntry`.
- `clear()`: disposes what it drew, and keeps the remembered cursors. `isShown()` is true between `show` and `clear`.
- `redraw()`: runs `show` again on the same content.

**Keys.** The user confirmed `l` and `<CR>` as the keys that open a list row. `{ keys: 'l', scope: 'docs.doc', command: 'docs.listOpen' }` and `{ keys: '<CR>', scope: 'docs.doc', command: 'docs.listOpen' }`, after the `i` line of `docs.doc`. Give no `where`, so vim keeps both keys inside a box. On a doc each clicks the focused link or button, or does nothing. Manifest: `listOpen: { label: 'open the row', group: 'doc', runsIn: 'page' }`. `docs-view.ts`: `listOpen: () => doc.listOpen()`. `start.ts`: `listOpen: onActiveView('listOpen')`. `j` and `k` keep their commands.

`commandOfKeysIn` now finds `docs.listOpen` for `docs.treeOpen` and `docs.treeToggle`. So with the tree out of sight, `l` and Enter open the list's row, and `runInDocPane` logs `tree out of sight: treeOpen ran docs.listOpen in the doc`. This is the wanted result. `TREE_COMMANDS_IN_SIGHT` does not change.

## Decisions: `wiki:` and `wigley:` links in a rendered body

`Main.md` renders as the Main page, so its links must act as its sidebar rows do. `resolveLink` gives `{ type: 'unsupported', href }` for each of these hrefs, and `followLink` toasts. `doc-view.ts` changes its `case 'unsupported'`: it calls `deps.followWikiLink(target.href, anchor.textContent)`, and it toasts as today only when that returns false.

**`parseWikiTarget`.** Extract the table of link targets in `wiki-main.ts` to this exported function, with no change to the table. `parseWikiMain` calls it. Null is the row "no item".

**`followWikiLink(href, title)`,** in `createDocsView`. A session view returns false, since a session's tab has no wiki. Otherwise it reads `parseWikiTarget(href)`:

| Result | Action | Returns |
|---|---|---|
| null, or `path` | none | false |
| `skill` | `findSkillEntry(name, entries)`. Found: `openListEntry(entry.id)`. Not found: `refuseMissingPage(title)`, which task 08 owns, with its toast and log | true |
| `kind`, `owner` | `openList(target, title)` | true |
| `all` | `deps.revealTree()`, then `showAllPages()`, which task 08 owns, per `../design.md` § Main page and sidebar. A body link needs `revealTree` since the user is in the doc, and task 08's sidebar row does not, since the user is in the sidebar | true |

**`findSkillEntry`.** Extract task 06's rule from `buildWikiTree` to this exported function, with no change to the rule. `buildWikiTree` calls it. So a sidebar row and a body link cannot pick two entries.

GIVEN the first show of Docs mode and a `Main.md` WHEN the first index read lands THEN `Main.md` shows and Recent changes draws under its body.
GIVEN a doc shown WHEN the user leaves Docs mode and returns THEN that doc still shows.
GIVEN an `openDoc` during the first show WHEN the first read lands THEN the asked doc shows, not `Main.md`.
GIVEN no `Main.md` WHEN `gh` fires THEN `mainEmpty` draws with the `~` path, and `i` creates the file from `MAIN_STARTER_TEXT` and opens it in the editor.
GIVEN a session's Docs tab WHEN `gh` fires THEN Docs mode shows `Main.md`, and the session's tab keeps its doc.
GIVEN `Main.md` shown WHEN `e` fires THEN a section editor opens, and Recent changes stays under the page.
GIVEN `Main.md` shown WHEN `i` fires THEN the whole-file editor opens and Recent changes hides.
GIVEN `Main.md` shown WHEN another doc opens THEN Recent changes goes.
GIVEN a `recentChanges` call that rejects WHEN the answer lands THEN no Recent changes part shows, and the log takes one line.
GIVEN `[All skills](wiki:kind/skill)` WHEN its sidebar row or its rendered link opens THEN the page shows the count the sidebar row shows, grouped by repo with `Global` first.
GIVEN `[Vendor docs](wiki:owner/third-party)` WHEN it opens THEN the rows group by plugin key, `Global` first for a doc with no plugin.
GIVEN a list page WHEN a follow-up row opens THEN the file opens at the item's line, and `Ctrl+o` returns to the list with that row as the cursor.
GIVEN a third-party list WHEN a row opens THEN the doc shows its read-only line.
GIVEN a list page WHEN the index lands THEN the rows draw again and the scroll and cursor stay.
GIVEN an editor with unsaved edits WHEN a list page is asked THEN the toast shows `UNSAVED_TEXT` and the doc stays.
GIVEN `[All pages](wiki:all)` in a rendered body WHEN it is clicked THEN the sidebar shows All pages.

Tests. Built data only, with shelf titles the test owns. `docs-view.ts` has no test file, so its wiring is checked in task 12's self-test group and in the live run below.

`docs/page/list-page.test.ts`, over `posixPaths`, home `/h`:

- `listPageContent_KindList_GroupsAndSorts`. Target kind `skill`. Entries:
  - `b`, repo `r2`, loaded `2026-11-05T10:00:00Z`
  - `a`, repo `r2`, never loaded
  - `z`, repo `r2`, loaded `2026-11-05T12:00:00Z`
  - `c`, repo null, never loaded
  - `d`, repo `r1`, never loaded
  - a third-party skill, and a mine hook

  Expected: count 5, and the groups `Global` `[c]`, `r1` `[d]`, `r2` `[z, b, a]`. `entryIds` runs parallel to the rows. The break is `Global` out of place, a wrong sort, or a count that disagrees with `wikiListEntries`.
- `listPageContent_Row` (`it.each`). The break is a row that cannot show its line, or a time of a never-loaded doc.

  | entry | expected `path` | expected `time` |
  |---|---|---|
  | `/h/a.md`, line null, never loaded | `~/a.md` | null |
  | `/h/f.md`, id `/h/f.md#L12`, line 12, never loaded | `~/f.md:12` | null |
  | `/h/a.md`, loaded 3 hours before `now` | `~/a.md` | `text` `3h`, `title` starts `Last loaded ` |

- `listPageContent_OwnerList_ListsThirdPartyOnly`. Two third-party entries with repo null and plugin null, and one mine entry. Expected: one group `Global`, count 2.
- `listPageContent_ThirdPartyList_GroupsByPlugin`. Owner `third-party`. Entries: `s`, plugin null, repo `r9`; `p`, plugin `x@m`, repo null; `q`, plugin `a@m`, repo null. Expected: groups `Global` `[s]`, `a@m` `[q]`, `x@m` `[p]`. The break is a third-party list grouped by repo, which shows `s` under `r9` and `Global` for the plugin docs.
- `listPlace_RoundTrips` (`it.each`):

  | input | result |
  |---|---|
  | kind `skill` → `listPlace` | `wiki:kind/skill` |
  | owner `third-party` → `listPlace` | `wiki:owner/third-party` |
  | `wiki:kind/skill` → `listTargetOfPlace` | kind `skill` |
  | `wiki:owner/third-party` → `listTargetOfPlace` | owner `third-party` |
  | `/a/b.md` → `listTargetOfPlace` | null |
  | `wiki:all` → `listTargetOfPlace` | null |

  The break is a file path read as a list.

`docs/page/list-pane.test.ts`, with `fakeDocsParts`:

- `show_TwoGroups_DrawsEachGroupsRowsInItsList`: two groups; the rows' parents are the two `ol.docs-list-rows`; the first row has `is-selected`.
- `move_ClampsAtBothEnds` (`it.each`), over three rows in two groups: `up` at the first stays; `down` twice reaches the third, across the group; `down` at the last stays.
- `show_Cursor` (`it.each`). The break is a cursor lost on a refresh or on a move back.

  | given | expected cursor |
  |---|---|
  | same place, cursor on row 2, same rows | row 2 |
  | same place, cursor's entry gone | row 1 |
  | another place, then back to the first place after `clear` | the first place's cursor |

- `openCursor_CallsOpenEntryWithTheCursor`, and `click_SetsTheCursorAndOpens`.
- `setFocused_TogglesIsCursorOnTheCursorRow`.

`docs/page/main-page.test.ts`:

- `linkedPages_WalksLeavesOnly`. A shelf holds a label, a leaf titled `One` for entry `e1`, a dangling link, a later leaf titled `Again` for `e1`, and a leaf for a gone entry. A second shelf holds a leaf titled `Two` for `e2`. Expected: `[{ title: 'One', path: <e1's> }, { title: 'Two', path: <e2's> }]`. The break is a dangling link asked of git, or a path asked twice.
- `recentRows_MapsPathsToTitles` (`it.each`). `now` is 3 hours after `at`. Each row has `time.text` `3h`, and `time.title` `loadedAt(at)`. The break is a real path that fails to match, or a page shown twice.

  | `change.paths` | pages | expected row pages |
  |---|---|---|
  | `['/r/a.md']` | `One` at `/r/a.md` | `One` |
  | `['/r/a.md', '/r/b.md']` | `One`, `Two` | `One`, `Two`, in the change's order |
  | `['/r/x.md', '/r/a.md']` | `One` at `/r/a.md` | `One` |
  | `['/r/a.md', '/r/a.md']` | `One` at `/r/a.md` | `One` |

- `createRecentReader`, over a fake channel with deferred calls:
  - `refresh_AsksThePagesPaths`: the call holds each page's `path`, in order.
  - `refresh_OlderAnswerLandsLate_DropsIt`: two refreshes, the second answer lands first. `show` runs once, with the second's rows.
  - `refresh_CallRejects_DrawsNothing`: `show` hears null, and the log holds `recent changes not read: boom`.
  - `clear_AnswerInFlight_DrawsNothing`: after `clear`, the answer does not reach `show`.
  - `refresh_EmptyAnswer_ShowsNoRows`: `show` hears `{ rows: [] }`, and the log holds `recent changes: 0 commits`.
- `MAIN_STARTER_TEXT_NamesNoShelf`: `parseWikiMain(MAIN_STARTER_TEXT)` equals `[]`. The break is a shelf name in the app's source.

`docs/page/doc-view.test.ts`, with `listRow` and `recentChanges` inputs recorded through a user layout, with `withUser`:

- `showPage_List_DrawsInTheArticleAndEmptiesTheDoc`: after a doc opens, `showPage` a list. `openPath()` is null, `data-doc` is `page`, `openChanged` hears null, `aside.hidden` is true, and the `listPage` root is inside `.docs-article`.
- `showPage_UnsavedEdits_Refuses`: returns false; the toast is `UNSAVED_TEXT`; `openPath()` is unchanged.
- `open_FromAListPage_DropsThePage`: `shownPage()` is null, and `.docs-page-slot` is empty.
- `isBlank` (`it.each`): new view, true; an open in flight, false; a doc shown, false; a page shown, false.
- `history_ListPlace_ReachesFollowPlace`: `showPage` a list with place `wiki:kind/skill`, `open` B, `historyBack`: `followPlace` hears `('wiki:kind/skill', null)`. `showPage` it with `isHistoryMove`, then `historyForward`: `followPlace` hears `(B, null)`. The break is a history move that pushes, which loses the forward entry.
- `history_MainEmpty_IsNoPlace`: `open` A, `showPage` `mainEmpty`, `open` B, `historyBack`: `followPlace` hears `(A, null)`.
- `scroll_ListShown_MovesTheCursorAndNotThePane`: `pane.scrollTop` is unchanged, and the second row has `is-selected`.
- `listOpen` (`it.each`): list shown, `openListEntry` hears the cursor's id; doc shown with `activeElement` a link in `pane`, the link hears one click and `openListEntry` no call; `activeElement` a `span` inside a button, the button hears the click; `activeElement` a plain div in `pane`, an `activeElement` outside `pane`, or none: no click and no call. The fake DOM exposes `activeElement` on the pane's `ownerDocument`.
- `updateList_ListShown_KeepsScrollAndHistory`: show a list, set `pane.scrollTop` to 80, call `updateList` with a content that has one more row; the scroll stays 80, the new row draws, and after `open` B, `historyBack` still reaches the list's place (one history entry for the list, not two).
- `edit_MainEmpty_CallsCreateMain`: `view.edit()` calls `createMain`, and no editor opens.
- `mainEmpty_LeavesOutTheHint_AppendsIt`: a user layout with its own `mainEmpty` that leaves out `createMainHint`; the hint is in the part's root.
- `setRecentChanges` (`it.each`): an input, `.docs-recent-slot` holds the part, and the slot is the next sibling of `bodySlot`; null, the slot is empty. The break is Recent changes placed above the body.
- `pageLink_Click_FollowsTheFile`: `followFile` hears `(path, null, null)`.
- `edit_MainDoc_KeepsRecentChanges` is not a test: the fake DOM cannot check CSS. Both `Main.md` GIVENs on `e` and `i` are checked in the live run, step 7.
- `followLink_WikiHref` (`it.each`): `followWikiLink` returns true, no toast; returns false, the toast is `This link does not open here: <href>`. `followWikiLink` hears the href and the link's text.
- `redraw_ListShown_DrawsThePageAgain`, in the pattern of `redraw_NoEditor_KeepsThePaneScrollAndFocus`.

Task 03's `parseWikiMain_Target` and task 06's `buildWikiTree_PageTarget` already own the two extracted rules. Add no test for `parseWikiTarget` or `findSkillEntry`.

Live run, through the project's `drive` skill. A layout's look earns a run, not a test:

1. Start the app and show Docs mode. `Main.md` shows, with the title first, then the rendered body, then Recent changes. Each row shows a time, a subject and page links. A click on a page link opens that page.
2. Press `Space v w` twice. Then Enter on a kind row with a count. The count on the page equals the sidebar's. Groups read by repo, with `Global` first. `j`, `k` and `l` move and open. `Ctrl+o` returns to the list.
3. Open a follow-up list and a row: the file opens at the item's line. Open the third-party list and a row: the read-only line shows.
4. Click `[All pages](wiki:all)` in the rendered body. The sidebar switches.
5. Open a session's Docs tab and press `gh`. Docs mode shows `Main.md`.
6. Seed a home with no `Main.md`, through the `drive` skill's fixtures. Do not touch the user's own file. The empty state shows with the `~` path. `i` creates the file and opens the editor. The sidebar shows `No pages in Main.md`. Confirm the tree header's six hints fit its width, and that the `main` hint shows in the doc's top row.
7. With `Main.md` shown, press `e`: a section editor opens. `query` `.docs-recent-slot` and read its `display`: not `none`. `:q`, press `i`: the whole-file editor opens. `query` it again: `display` is `none`. `:q`.
8. With a list shown and the cursor on the second row, scroll the pane, then press `R` on the tree. The rows draw again, the cursor row and the scroll hold, and `Ctrl+o` still returns the way it did.
9. Open `wiki:owner/third-party`: rows group by plugin key, `Global` first.
10. Capture one screenshot at each of steps 1, 2 and 6.

Ask task 12 to add a self-test group: the Main page at start, `gh` from a session tab, a list page with a row open and `Ctrl+o`, a `wiki:` link click, and the fixture state that draws `mainEmpty`.

Done when: `npm run lint` passes. `npm test` runs the tests above and passes. The live run passes. `grep -n "not drawn yet" src/plugins/docs/page/docs-view.ts` shows nothing. `grep -c "'gh'" src/plugins/keymap.ts` shows `2`.
Commit:    one commit for the group

## Proof

Commit fbf589cb · proof: Diff read; Produces found by grep (newestLoadedFirst, findSkillEntry, parseWikiTarget, createListPane, MAIN_STARTER_TEXT, createRecentReader, showPage, updateList, shownPage, isBlank, setRecentChanges, listOpen); tsc clean; worker: 7 test files 273 pass, lint, both greps, live steps 1-10 PASS on runs w11, w11b, w11c. · concerns: At first show focus stays on the tree, so i on the empty Main page does nothing and its hint hides until Alt+l. Ctrl+o/i are docs.doc scope only. A list's scroll is not remembered per place (cursor is). Main.md deleted while shown: gh logs already shows and the empty state does not draw. Header title reads Main.md with a provisional entry until rebuild. Focus after a recent link click falls to body. No layout.css rule for .docs-main-hint or .docs-recent-page. Live run's stand-in index had links: [], so section links on Main were not exercised live. Root AGENTS.md docs paragraph possibly stale.
