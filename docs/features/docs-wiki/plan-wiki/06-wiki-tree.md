# 06 — Wiki tree and search rows

Status: done
Type: Task
Wave: 2 · Depends on: 02, 03
Plan: [plan.md](plan.md)

Files:
- modify `src/plugins/docs/tree.ts`
- modify `src/plugins/docs/page/docs-state.ts`
- modify `src/plugins/docs/page/tree-view.ts`
- modify `src/plugins/docs/page/docs-view.ts`
- test: modify `src/plugins/docs/tree.test.ts`
- test: modify `src/plugins/docs/page/docs-state.test.ts`
- test: modify `src/plugins/docs/page/tree-view.test.ts`

This task does not change `buildTree`. It does not touch `layouts/layout.d.ts`, which task 05 changes in this wave.

Consumes:
- `IndexHeading`, `IndexEntry.headings` ← 02
- `WikiShelf`, `WikiTarget` ← 03
- `resolveLink(href, fromFile, homeDir, paths): LinkTarget` in `src/plugins/docs/links.ts` (exists)

Produces:
- in `src/plugins/docs/tree.ts`:
  - `export type TreeNode = TreeGroup | TreeLeaf | TreeWikiLink | TreeWikiLabel | TreeHeadingMatch`
  - `export interface TreeWikiLink { type: 'wikiLink'; id: string; title: string; target: WikiTarget; count: number | null; isDangling: boolean }`
  - `export interface TreeWikiLabel { type: 'wikiLabel'; id: string; title: string }`
  - `export interface TreeHeadingMatch { type: 'headingMatch'; id: string; title: string; entryId: string; line: number; docTitle: string; leafId: string }`
  - `export function buildWikiTree(shelves: readonly WikiShelf[], entries: readonly IndexEntry[], mainFolder: string, homeDir: string, paths: Paths): TreeNode[]`
  - `export function buildWikiFilterTree(entries: readonly IndexEntry[], homeDir: string, paths: Paths): TreeNode[]`
  - `export function wikiListEntries(target: Extract<WikiTarget, { type: 'kind' | 'owner' }>, entries: readonly IndexEntry[]): IndexEntry[]`
- in `src/plugins/docs/page/docs-state.ts`:
  - `visibleRows(tree, state, pathOf, headingsOf: (entryId: string) => readonly IndexHeading[], matcher): TreeRow[]`
  - `TreeRowAction` gains `{ type: 'openWikiLink'; focusDoc: boolean }` and `{ type: 'openHeading'; focusDoc: boolean }`
- in `src/plugins/docs/page/tree-view.ts`:
  - `TreeView.setTree(tree, pathOf, headingsOf, hasIndex)`
  - `TreeViewDeps.openHeading(match: TreeHeadingMatch, focusDoc: boolean): void`

## Decisions: buildWikiTree

**Shelves.** Each `WikiShelf` becomes a root `TreeGroup`:
- `id`: `shelf:<title>`. The second shelf with one title is `shelf:<title>#2`, the third `#3`. A title keeps a shelf's id when the user reorders `Main.md`, so the shelf keeps its expansion. The ids stay the same across rebuilds, as the comment above `TreeGroup` requires.
- `role`: the existing `OTHER_ROLE`.
- `folder`: the common folder of the shelf's leaf entries' paths, null when it has no leaf. The `group()` helper throws on no entries through `commonFolder`, so handle the empty case first.
- An empty shelf stays, with `children: []`. `Main.md` is the user's list.

**Labels.** A label has no children and does not expand, so it is not a `TreeGroup`. It is the new `TreeWikiLabel`, with `id` `<shelfId>/label:<itemIndex>`. Pages after a label stay siblings at the shelf's child depth, in file order. The label draws through the `treeRow` part: task 08 widens `TreeRowInput.type` and adds its look, after task 05.

**Page targets of `path` and `skill` become a `TreeLeaf` when an entry exists.** The leaf's `title` is the link text. `entryId` is the entry's `id`. A leaf's `id`:
- `entry:<entryId>` for the entry's first leaf in the wiki tree, which is the same id as `buildTree`'s leaf. So `TreeView.selectEntry`, `parentId` and a selection kept across the switch to All pages work with no change.
- `<shelfId>/<itemIndex>/entry:<entryId>` for a later leaf of the same entry. Each row id stays unique.

**A `path` target finds its entry as follows.**
1. Call `resolveLink(path, paths.join(mainFolder, 'Main.md'), homeDir, paths)`, the same resolver the rendered page uses. It handles `~/` (through `homeDir`), a relative path (through `mainFolder`), an absolute path, URI escapes, and a `#…` or `:<n>` suffix.
2. A result other than `{ type: 'file' }` (a URL, a scheme) has no entry. It is dangling.
3. Take only whole-file entries: `entry.id === entry.path`. A follow-up item and a hook do not count.
4. Prefer an entry whose `path` is `samePath` with the result. Else take an entry whose `walked` holds a path that is `samePath` with it. When several entries pass the same step, order them as the skill rule below does (`owner` `mine` first, then `source` `repo` first, then `id` in code-unit order) and take the first. So the leaf never depends on index order.

`walked` is what makes `~/wigley-agents/…` work on this machine. The live index holds `path` `/Users/…/Documents/ai-dev/wigley-agents/decisions.md` with `walked` `['/Users/…/wigley-agents/decisions.md']`. The leaf opens at the top of the doc: a line or fragment in the link is not used.

**A `skill` target finds its entry as follows.** Take the entries with `kind === 'skill'`, `title === name`, and a `plugin` key that starts with `wigley@`. The key check is necessary: the live index holds three skills titled `make`, two of them in another marketplace. When several pass, order them by `owner` `mine` first, then `source` `repo` first, then `id` in code-unit order. Take the first. There is no fallback to another plugin or to a global skill.

**A target with no entry** becomes a `TreeWikiLink` with `isDangling: true`, `count: null` and the item's `target`.

**`kind`, `owner` and `all` targets** become a `TreeWikiLink` with `isDangling: false`.
- `kind`: `count` is `wikiListEntries(target, entries).length`. A count of 0 is `0`, not dangling.
- `owner`: the same.
- `all`: `count` is null.

A `TreeWikiLink`'s `id` is `<shelfId>/link:<itemIndex>`.

**`wikiListEntries`** is the one predicate behind the count and the list page, so the two cannot disagree. Task 11 calls it.
- `kind`: entries with `owner === 'mine'` and `kind === target.kind`, the kinds the app does not know included.
- `owner`: entries with `owner === 'third-party'`.

Input order is kept. There is no follow-up double count. A follow-up file has no whole-file entry: each `#L` item is an entry, and the live index holds 0 `followup` entries with a null `line`. So the count is the number of items. Two clones of one repo count as two docs here, since the list page groups by repo and shows each.

The module holds no shelf name.

## Decisions: every use of a TreeNode

Each of these reads `entryId` after a group check, or lists the node types. Each changes as the table says.

| Member | File | After |
|---|---|---|
| `defaultExpandedIds` | `docs-state.ts` | No code change: each shelf is a root, so each shelf starts expanded. A label and a link are never added, since a root is always a group here. Add a test row |
| `parentId` | `docs-state.ts` | No code change: it descends only groups, and a link or a label inside a shelf has that shelf as its parent |
| `treeRowAction` | `docs-state.ts` | See the table below |
| `changeableEntry` | `docs-state.ts` | `node.type !== 'entry'` takes the group refusal (`groupText`, tone `info`), for all four other types. A page row is a `TreeLeaf`, so rename and trash act on it |
| `treeRowStatus` | `docs-state.ts` | A `headingMatch` returns `detail` `docTitle`. A `wikiLink` and a `wikiLabel` return null for `detail`: task 08 draws a link's `count` through its own row field. `mark` is null for all three |
| `statusCounts` | `docs-state.ts` | Read `files.get` only for `node.type === 'entry'` |
| `rowInput` | `tree-view.ts` | `type: node.type === 'group' ? 'group' : 'entry'`, so `TreeRowInput` stays unchanged in this wave. Task 08 widens it |
| `actOnSelected` | `tree-view.ts` | Add the `openHeading` branch below. An `openWikiLink` action has no branch here: no wiki tree is shown until task 08, which adds it |
| `selectedFolder` | `docs-view.ts` | A node that is neither group nor `entry` gives null: `A` starts in the home folder |
| `toggleStar` | `docs-view.ts` | No code change: `node?.type !== 'entry'` already returns |

`treeRowAction`:

| Node | `open`, `toggle` | `close` |
|---|---|---|
| `wikiLink` | `{ type: 'openWikiLink', focusDoc: key === 'toggle' }`, dangling links too: task 08 reads `isDangling` and refuses with the toast `../design.md` § Main page and sidebar names | select the parent |
| `wikiLabel` | `{ type: 'none' }` | select the parent |
| `headingMatch` | `{ type: 'openHeading', focusDoc: key === 'toggle' }` | `{ type: 'select', id: node.leafId }` |

A label row stays selectable, so `stepSelection` does not change.

## Decisions: search

`../design.md` § Search: the filter finds titles, filenames and section headings. In the wiki view it covers the user's own docs, and in All pages it also covers third-party docs.

**The whole mine list reaches the filter through a second tree.** The wiki tree holds only the pages `Main.md` links. So the wiki view holds two trees: the shelves, shown unfiltered, and `buildWikiFilterTree`, shown while the filter is on. `buildWikiFilterTree` is `buildTree(entries.filter(owner === 'mine'), homeDir, paths, new Set())`. It keeps the repo and kind groups a result reads under, and it adds no second grouping rule. A `TreeWikiLink` and a `TreeWikiLabel` never match a filter, so a filter over the shelves would show pages only.

All pages needs no second tree: its one tree is `buildTree` over all entries. Task 08 holds the two trees in `TreeView` and passes the right one to `visibleRows` and `treeRowAction` by whether `state.filter.trim()` is empty. This task only produces the function.

**`visibleRows` gains `headingsOf`, after `pathOf`.** Unfiltered, a `wikiLink` or a `wikiLabel` gives its row with `isExpanded: false`. Filtered, each gives no row. The other rules of the filter do not change: a filter of only spaces is none, and every group above a match shows as expanded.

**A heading match.** On a filtered `TreeLeaf`, a heading matches when `matchesSubstring(filter, heading.text)` is true and `fold(heading.text) !== fold(leaf.title)`. `fold(s)` is `s.toLowerCase()` with each backtick, each `*` and the closing `#` run (`/\s*#+\s*$/`) removed. Apply it to both sides: the entry's `title` is the raw `# ` line for a doc, and `IndexHeading.text` has the markers removed. The second check stops the doc's lead title from repeating the doc's own row. Headings use a substring, not the fuzzy matcher: a doc holds many headings, and a fuzzy match over them floods the list. This is the same reason the path check gives.

**The rows.**
- A leaf with a title match, a path match or a heading match gives its leaf row. A leaf that matches only by a heading still shows, as the row above its headings.
- Each matching heading follows the leaf as one row at `depth + 1`, in file order, with node `TreeHeadingMatch`:
  - `id`: `<leaf.id>/heading:<line>`
  - `title`: `heading.text`
  - `line`: `heading.line`
  - `docTitle`: `leaf.title`
  - `leafId`: `leaf.id`
  - `entryId`: `leaf.entryId`
- So the row names its title and its doc: `title`, and `detail` through `treeRowStatus`.
- A `TreeHeadingMatch` is in `TreeNode` so that each row is one type. Only `visibleRows` makes one. No tree holds one, and no builder returns one. State this in its comment.

**Ranking.** The rows stay in the tree's order, since a row sits under its groups, and a flat score would break the groups. One rule ranks inside a group's children: a leaf that matches only by a heading comes after its siblings that match by title or path, or that are groups. Each set keeps the tree's order. So a doc named for the query comes before a doc that only mentions it in a section. A tree with no heading matches keeps today's order exactly.

## Decisions: tree-view and docs-view wiring

Heading search works in the existing tree from this task on, so its wiring lands here.

- `TreeView.setTree` gains `headingsOf` after `pathOf`, and passes it to both `visibleRows` calls.
- `docs-view.ts` `showDocument` passes `(entryId) => entriesById.get(entryId)?.headings ?? []`.
- `TreeViewDeps.openHeading(match, focusDoc)`: `actOnSelected` calls it on `action.type === 'openHeading' && node.type === 'headingMatch'`, after `draw()`, as the leaf branch does.
- In `docs-view.ts`, `openHeading` finds the entry by `match.entryId`, and returns when it is gone. It calls `doc.open(targetFor(entry.path, entry, match.line, null))`, then does what `openLeaf` does after a successful open (`deps.leafOpened()`, and `focusDocAndLog()` for `focusDoc`). `openLeaf`'s shortcut for the doc already shown does not apply, since the row asks for a line.
- The `isPrompted` line stays `node.type === 'entry'`, so a heading row has no cursor prompt.
- The comment above `TreeView` and the comment above `visibleRows` state the heading rows. The `filter` command's label in `manifest.ts` stays for now, as task 08's concern.

## Behaviour

GIVEN `Main.md` names `~/wigley-agents/a.md` and the entry's `walked` holds that path WHEN `buildWikiTree` runs THEN the row is a leaf with the link's text as its title.
GIVEN a link to no listed doc WHEN `buildWikiTree` runs THEN the row is a `wikiLink` with `isDangling: true`.
GIVEN a filter that only a section heading holds WHEN `visibleRows` runs THEN the doc's row shows with one heading row under it.
GIVEN Enter on a heading row WHEN the view acts THEN the doc opens at that heading's line.

## Tests

Built data only. Test data uses shelf titles such as `Shelf A`. Follow the file's `method_Condition_Result` names.

`src/plugins/docs/tree.test.ts`. `HOME` is `/Users/u`, `MAIN` is `/dev/agents/wiki`, and paths are `posixPaths` unless a row says otherwise.

`buildWikiTree_PageTarget` (`it.each`), one shelf holding one page titled `Link text`. The break is a wrong resolve base, a dropped `walked`, a follow-up matched as a page, or a title taken from the entry.

| given | target | entries | expected node |
|---|---|---|---|
| `~/` through `walked` | path `~/agents/a.md` | `/dev/agents/a.md`, walked `['/Users/u/agents/a.md']` | leaf, entry `/dev/agents/a.md`, title `Link text` |
| relative to the main folder | path `../a.md` | `/dev/agents/a.md` | leaf, same |
| relative, fragment dropped | path `../a.md#part` | `/dev/agents/a.md` | leaf, same |
| absolute | path `/dev/agents/a.md` | `/dev/agents/a.md` | leaf, same |
| real path beats a walked path | path `/dev/agents/a.md` | `/x/b.md` walked `['/dev/agents/a.md']`; `/dev/agents/a.md` | leaf, entry `/dev/agents/a.md` |
| skill of the wigley plugin | skill `make` | skill `/m/make/SKILL.md`, title `make`, plugin `ng@n`; skill `/w/make/SKILL.md`, title `make`, plugin `wigley@w` | leaf, entry `/w/make/SKILL.md` |
| skill: clone before an install | skill `make` | title `make`, plugin `wigley@w`, `/i/make/SKILL.md` source `plugin`; `/w/make/SKILL.md` source `repo` | leaf, entry `/w/make/SKILL.md` |
| skill of another plugin only | skill `make` | title `make`, plugin `ng@n` | `wikiLink`, dangling, count null |
| no entry | path `../gone.md` | none | `wikiLink`, dangling, `target` as given, count null |
| only a follow-up item at that path | path `../f.md` | `id: '/dev/agents/f.md#L3'`, path `/dev/agents/f.md`, line 3 | `wikiLink`, dangling |
| URL | path `https://x.test` | none | `wikiLink`, dangling |

`buildWikiTree_WindowsPath_ComparedAsSamePath`, with `windowsPaths`: a path `C:\Dev\a.md` finds the entry at `c:\dev\a.md`. The break is a string compare.

`buildWikiTree_WikiLinkCount` (`it.each`). The entries are two mine `skill`, one third-party `skill`, one mine `hook`, one mine `followup` `#L1` and one mine `followup` `#L2` in one file. The break is a count over all owners, or a double count.

| target | count | dangling |
|---|---|---|
| kind `skill` | 2 | false |
| kind `followup` | 2 | false |
| kind `made-up` | 0 | false |
| owner `third-party` | 1 | false |
| all | null | false |

`buildWikiTree_Shape`, with exact ids. Input: shelves `S` (label `L`, a page to entry `/a.md`, a kind link), `S` again (a page to `/a.md`) and `Empty`. Output:
- root ids `shelf:S`, `shelf:S#2`, `shelf:Empty`
- under the first: `shelf:S/label:0`, `entry:/a.md`, `shelf:S/link:2`
- under the second: `shelf:S#2/0/entry:/a.md`
- `Empty` holds `[]` with `folder` null, and the first shelf's `folder` is `/`

The break is a duplicate row id, a dropped empty shelf, or `commonFolder` throwing on an empty shelf.

`buildWikiFilterTree_MineOnly`: mine and third-party entries give one root, `MINE_ROOT_ID`, with no `Starred` root and no third-party leaf. The break is a leak of third-party docs into the wiki view's search.

`src/plugins/docs/page/docs-state.test.ts`. Existing `visibleRows` calls gain `headingsOf`, `() => []`.

`visibleRows_HeadingMatch` (`it.each`), over root `root` holding leaves, in order, `b` (title `Beta`, entry `e:b`), `a` (title `Alpha`, entry `e:a`) and `c` (title `Gamma`, entry `e:c`). The headings of `e:b` are `{level:2,text:'Alpha notes',line:4}`. The headings of `e:a` are `{level:1,text:'Alpha',line:1}` and `{level:2,text:'Alpha two',line:9}`. The break is a heading-only doc hidden, a lead title repeated, a ranking lost, or a heading row without its depth.

| filter | expected row ids, with depth |
|---|---|
| `alpha` | `root` 0, `a` 1, `a/heading:9` 2, `b` 1, `b/heading:4` 2 |
| `notes` | `root` 0, `b` 1, `b/heading:4` 2 |
| `gamma` | `root` 0, `c` 1 |
| `delta`, with `c`'s title `` `Delta` `` and its first heading `{level:1,text:'Delta',line:1}` | `root` 0, `c` 1 (the lead heading is not repeated: backticks and case fold away) |
| empty, root expanded | `root` 0, `b` 1, `a` 1, `c` 1 (no heading row without a filter) |

`visibleRows_WikiRows` (`it.each`), over a shelf holding a label, a link and a leaf titled `Page`. The break is a label or link that vanishes unfiltered, or that shows under a filter.

| filter | expected row ids |
|---|---|
| empty, shelf expanded | shelf, label, link, leaf |
| `page` | shelf, leaf |
| `zzz` | none |

`visibleRows_HeadingMatch_NamesTitleAndDoc`: the heading node for `a/heading:9` in the table above equals `{ type:'headingMatch', id:'a/heading:9', title:'Alpha two', entryId:'e:a', line:9, docTitle:'Alpha', leafId:'a' }`.

`treeRowAction_WikiRows` (`it.each`, rows added to the existing `treeRowAction` table where its shape fits). Each row is exactly as the `treeRowAction` table above says. Cover: a link on `open` and on `toggle`, a dangling link on `toggle`, a label on `open` and on `close`, a link on `close`, a heading on `toggle` and on `close`. The break is a label that expands, or a heading whose `h` stops, since `parentId` holds no heading row.

`defaultExpandedIds`: one row added: a wiki tree of two shelves expands both, and adds no label or link id.

`changeableEntry`: rows added to the existing table: a `wikiLink`, a `wikiLabel` and a `headingMatch` give the group refusal.

`treeRowStatus`: rows added: a `headingMatch` gives `detail` as its `docTitle`, and a `wikiLink` and a `wikiLabel` give null. The break is a read of `role` or `entryId` on a node that has neither.

`src/plugins/docs/page/tree-view.test.ts`: the file's deps gain `openHeading`. Add `toggle_HeadingRow_CallsOpenHeading`: with a filter set and a heading selected, `toggle()` calls `openHeading` with that match and `focusDoc` true. The break is a missed wire, which leaves a heading row dead.

Test helpers that read `entryId` after a group check narrow on `entry`, where the compiler requires it.

## Done when

The project compiles. `git diff` shows no change inside `buildTree` and its helpers. `wigley:make`'s test gate runs the tests above and the existing `tree`, `docs-state` and `tree-view` tests. Task 14 holds every runtime check.

Commit: one commit for the group.

## Proof

Commit 47c67279 · proof: diff read, every Produces present, buildTree unchanged, tsc clean · concerns: preferredEntry compares ids inline as byTitleThenId does; a skill's SKILL.md leaf can show its lead heading as a heading row; visibleRows re-tests every heading per draw under a filter, unmeasured; docs-view openHeading has no unit test, left to task 14
