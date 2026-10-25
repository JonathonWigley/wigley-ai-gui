# 11 — Docs page: read-only, statuses, rollups

Status: done
Type: Batch
Wave: 4 · Depends on: 08, 09, 10
Plan: [plan.md](plan.md)
Repo: wigley-ai-gui

Files:     modify `src/plugins/docs/tree.ts` · `src/plugins/docs/page/docs-state.ts` · `src/plugins/docs/page/doc-view.ts`
           · `src/plugins/docs/page/tree-view.ts` · `src/plugins/docs/page/docs-view.ts`
           test `src/plugins/docs/tree.test.ts` · `src/plugins/docs/page/docs-state.test.ts`
Consumes:  `DocsChannel.invoke.pluginStatus(sourceId: string, fetch: boolean): Promise<PluginStatusRead>` ← 08
           `FileStatus`, `CloneStatus`, `PluginStatusRead`, `InstalledCopy`, `IndexContext.loadedPlugins`,
           `IndexEntry.owner` in `src/plugins/docs/contract.ts` ← 06
           `installedCopies(entry: IndexEntry): InstalledCopy[] | null` in `src/plugins/docs/index-document.ts` ← 06
           `MINE_ROOT_ID`, `THIRD_PARTY_ROOT_ID`, `buildTree` roots by owner in `src/plugins/docs/tree.ts` ← 10
           main's write guard refusing third-party entries ← 09 (the page refuses first; main stays the backstop)
           `tag(text, tone)` (`src/shared/page/ui/tag.ts`), `statusDot(status)` (`src/shared/page/ui/status-dot.ts`),
           `row({ detail, trailing, … })` (`src/shared/page/ui/row.ts`): primitives the tree already holds
Produces:  `export type GroupRole = { type: 'repo'; clone: string | null } | { type: 'clone'; clone: string } | { type: 'plugin' } | { type: 'other' };` in `src/plugins/docs/tree.ts`
           `role: GroupRole` on `TreeGroup` in `src/plugins/docs/tree.ts`
           `export type ReadOnlyReason = { type: 'downloaded'; plugin: string | null } | { type: 'installed'; plugin: string };` in `src/plugins/docs/page/docs-state.ts`
           `export function readOnlyReason(entry: IndexEntry): ReadOnlyReason | null` in `src/plugins/docs/page/docs-state.ts`
           `export function readOnlyText(reason: ReadOnlyReason): string` in `src/plugins/docs/page/docs-state.ts`
           `export function defaultExpandedIds(tree: readonly TreeNode[]): Set<string>` in `src/plugins/docs/page/docs-state.ts`
           `export function fileStatuses(read: PluginStatusRead | null): Map<string, FileStatus>` in `src/plugins/docs/page/docs-state.ts`
           `export function statusTexts(entry: IndexEntry, status: FileStatus | undefined, loadedPlugins: Readonly<Record<string, string>>): string[]` in `src/plugins/docs/page/docs-state.ts`
           `export interface StatusCounts { uncommitted: number; unpushed: number; notInstalled: Record<IndexHarness, number> }` in `src/plugins/docs/page/docs-state.ts`
           `export function rollupText(counts: StatusCounts): string | null` in `src/plugins/docs/page/docs-state.ts`
           `export function fetchText(clone: CloneStatus, formatTime: (iso: string) => string): string | null` in `src/plugins/docs/page/docs-state.ts`
           `export interface TreeRowStatus { mark: string | null; detail: string | null }` in `src/plugins/docs/page/docs-state.ts`
           `export function treeRowStatus(node: TreeNode, textsOf: (entryId: string) => string[], files: ReadonlyMap<string, FileStatus>, clones: readonly CloneStatus[], formatTime: (iso: string) => string, paths: Paths): TreeRowStatus` in `src/plugins/docs/page/docs-state.ts`
           `readOnly: ReadOnlyReason | null` on `DocTarget` (replacing `cachePlugin`) in `src/plugins/docs/page/doc-view.ts`
           `statusesOf(entryId: string): string[]` on `DocViewDeps` in `src/plugins/docs/page/doc-view.ts`
           `rowStatus(node: TreeNode): TreeRowStatus` on `TreeViewDeps` in `src/plugins/docs/page/tree-view.ts`
           `statusesChanged(): void` on `TreeView` in `src/plugins/docs/page/tree-view.ts`
           log line `[docs] refused to edit <file name>, a downloaded copy` from `doc-view.ts` (task 12 waits for it)
Decisions:
- Default expansion, pinned by lead: `owner:third-party` starts collapsed. Today `rootIds(tree)` expands every root of
  the first tree with rows (`tree-view.ts` `setTree`), and the expanded set lives only in the tree view's
  `TreeState`: `setTree` keeps it across rebuilds, and nothing saves it. `defaultExpandedIds` replaces `rootIds`:
  every root but `THIRD_PARTY_ROOT_ID`, plus each group child of `MINE_ROOT_ID`. Decided: Mine's children are
  today's roots, which today start expanded, so the first view shows what it shows today under one `Mine` row. A
  root that first shows in a later tree starts collapsed, as today.
- Read-only texts, pinned by lead: a `downloaded` reason reads
  `Downloaded copy — <plugin key, or "synced skill">. Edits are lost on its next update.`; an `installed` reason reads
  `Installed copy — <plugin key>. The clone has no such file.`
- `readOnlyReason(entry)`: `owner === 'third-party'` gives `{ type: 'downloaded', plugin: entry.plugin }` (null for a
  synced skill); else `source === 'plugin'` gives `{ type: 'installed', plugin: entry.plugin ?? entry.title }`; else
  null. Pinned by lead: the read-only decision covers third-party entries too.
- `docs-dialogs.ts` refuses nothing itself: its header says "Each flow's refusals before a dialog opens are the
  view's", and `docs-view.ts` refuses rename and delete through `changeableEntry` in `docs-state.ts`. So
  `changeableEntry`'s check `entry.source === 'plugin'` becomes `readOnlyReason(entry) !== null`, its refusal
  `{ text: readOnlyText(reason), tone: 'info' }`. The item-inside-a-file check stays before it, so a `kind: 'plugin'`
  entry still gets the item text. Its doc comment says "a read-only doc" where it says "a plugin cache doc".
- `docs-view.ts` `targetFor` sets `readOnly`: null for a `kind: 'plugin'` entry (its detail view edits the config
  file, as today); else the entry's `readOnlyReason`; else, when that is null or no entry names the path, the
  `readOnlyReason` of the `source: 'plugin'` entry whose `root` holds the path. `cachingPlugin` becomes
  `holdingPlugin(document, path, paths): IndexEntry | null`, the same search returning the entry.
- `doc-view.ts`: the read-only line under the header shows `readOnlyText(target.readOnly)` while `readOnly` is set.
  `edit` refuses while it is set: it toasts `readOnlyText` with tone `info` and logs `refused to edit <name>, a
  downloaded copy` for `downloaded`, and today's `refused to edit <name> in the plugin cache` for `installed`.
  Decided: the installed line stays as it is, so the self-test's plugin cache step keeps its line.
- Status reads, pinned by lead: after the view's first index read settles, and after each Rescan's rebuild settles,
  the view calls `pluginStatus(sourceId, false)`, shows the reply, then calls `pluginStatus(sourceId, true)` and
  shows that reply. Decided: the fetch call starts once the first call settles, resolved or rejected; a rebuild a
  create, rename or trash starts reads no statuses.
- A stale reply is dropped, pinned by lead: each call takes the next number from a counter apart from the index
  loads' (`startedLoads`); a reply whose number is below the last shown reply's number is dropped, as `runIndex`
  drops an older load. A rejected call logs `plugin status: <error text>` and keeps the statuses shown. Each shown
  reply logs `plugin status read: <n> clones` (`fetch` false) or `plugin status fetched: <n> clones` (`fetch`
  true), `<n>` the reply's `clones.length`. Decided: task 14's drive run reads these lines.
- Chip texts and order, pinned by lead: `Uncommitted`, `Unpushed`, `Not installed · Claude`, `Not installed · Codex`,
  `Session stale`. They show in the header's chip row (`.docs-chips`), after the Claude and Codex load-state chips.
  Decided: one row of chips per doc, as today.
- Session stale, pinned by lead: `loadedPlugins[entry.plugin]` differs from the version of the entry's `claude`
  copy in `installedCopies(entry)`, and only when `loadedPlugins` holds the key. Decided: no `claude` copy shows no
  Session stale (`Not installed · Claude` covers it). The view passes `context()?.loadedPlugins ?? {}`. Every
  machine context's `loadedPlugins` is `{}` (README § Context), so Session stale shows only in a session's Docs tab
  without a check on the source.
- Tones, by DESIGN.md § Colour: every status chip is a Tag in tone `warning`, and a leaf's status mark is a
  StatusDot `warning`. The four statuses are steps still to take, which is a warning. `attention` is "needs you"
  (a permission prompt, an open round), `error` is a failure, and `accent` does brand work only. The rollup is the
  Row's `detail` (`text-12`, `fg-tertiary`): muted text, no status colour, since a group row is a larger area.
- Rollup, pinned by lead: parts `<n> uncommitted`, `<n> unpushed`, `<n> not installed for Claude`,
  `<n> not installed for Codex`, in that order, each only when its count is above 0, joined by ` · `. A count is the
  number of the group's descendant leaves whose `FileStatus` has that status. Session stale is not counted.
- Which rows roll up: a group with role `plugin`, `repo` or `clone`. Decided: a split repo's clone row is a repo row
  for its own clone, so it carries that clone's rollup and fetch line; the split repo row carries the summed rollup
  and no fetch line (its role's `clone` is null). Every other group (`other`) shows none.
- Fetch line, pinned by lead: when the row's clone (the `CloneStatus` whose `root` is `samePath` to the role's
  `clone`) has `fetchFailed`, the detail adds `origin as of <fetchedAt as local date and time>`, or
  `origin never fetched` when `fetchedAt` is null, after the rollup's parts and joined by ` · `. `docs-view.ts`
  passes `formatTime = (iso) => new Date(iso).toLocaleString()`. Decided: no date helper exists in `src/`, and a
  test hands `fetchText` its own formatter.
- Roles in `tree.ts` (10's code): a repo node gets `{ type: 'repo', clone: <its one clone's root> }`, or
  `clone: null` when it has no clone or is split; a clone node `{ type: 'clone', clone: <its root> }`; a plugin node
  inside a repo or clone `{ type: 'plugin' }`; every other group `{ type: 'other' }`. Decided: 10 runs beside 08 and
  09 and keeps to `tree.ts`, so the field lands here with its only reader; ids carry clone roots with separators in
  them, so the page does not parse ids.
- A leaf's mark: when `textsOf(entryId)` is not empty, `mark` is the texts joined by ` · `. The tree view draws it as
  the row's `trailing` StatusDot, with `mark` as the dot's `title`. A group's `mark` is null.
- `docs.css` does not change: the chip row wraps tags already, and Row draws `detail` and `trailing`.
- `docs-state.ts`'s header comment adds "the read-only reasons, the plugin-source status texts and the tree's
  rollups" to its list.

GIVEN a third-party plugin entry WHEN its doc opens THEN the read-only line reads
      `Downloaded copy — <key>. Edits are lost on its next update.`
GIVEN a synced skill WHEN its doc opens THEN the line reads `Downloaded copy — synced skill. Edits are lost on its next update.`
GIVEN an installed-only entry WHEN its doc opens THEN the line reads `Installed copy — <key>. The clone has no such file.`
GIVEN a read-only doc WHEN the user presses `i` THEN the editor does not open, the line is toasted, and the log says
      `refused to edit <name>, a downloaded copy` (downloaded) or `refused to edit <name> in the plugin cache` (installed)
GIVEN a read-only doc selected WHEN the user presses `r` or `d` THEN the view toasts the same line and opens no dialog
GIVEN the first index read settles WHEN the view goes on THEN it calls `pluginStatus(id, false)`, shows it, then
      `pluginStatus(id, true)` and shows that
GIVEN Rescan WHEN its rebuild settles THEN the same two calls run
GIVEN an older status call replies after a newer one was shown WHEN it lands THEN it is dropped
GIVEN an open doc with statuses WHEN statuses arrive THEN its header shows a `warning` Tag per status, in the pinned order
GIVEN a session view whose context loaded `w@m` 1.9.0 and an entry whose Claude copy is 1.9.1 WHEN it opens THEN it
      shows `Session stale`
GIVEN tree leaves with statuses WHEN the tree draws THEN each such leaf shows one `warning` StatusDot titled with its texts
GIVEN a plugin, repo or clone row whose leaves have statuses WHEN the tree draws THEN its detail shows the rollup
GIVEN a repo row whose clone fetch failed WHEN the tree draws THEN its detail ends with `origin as of <time>` or
      `origin never fetched`
GIVEN the first tree WHEN it shows THEN Mine and its children are expanded and Third-party is collapsed
Tests:     in `docs-state.test.ts` (the existing `rootIds` test is replaced; the existing
           `changeableEntry_PluginCache_RefusedReadOnly` entry sets `owner: 'mine'` and expects
           `{ refusal: { text: 'Installed copy — p@m. The clone has no such file.', tone: 'info' } }`):
           `defaultExpandedIds_MineAndChildren_ThirdPartyCollapsed` — tree `[group owner:mine [group global, group
           repo:r [group repo:r/rule]], group owner:third-party [group owner:third-party/synced]]`: the set is
           `['owner:mine', 'global', 'repo:r']`
           `readOnlyReason_ThirdPartyPlugin_Downloaded` — owner `third-party`, source `plugin`, plugin `v@m`:
           `{ type: 'downloaded', plugin: 'v@m' }`
           `readOnlyReason_SyncedSkill_DownloadedNoPlugin` — owner `third-party`, source `global`, plugin null:
           `{ type: 'downloaded', plugin: null }`
           `readOnlyReason_InstalledOnly_Installed` — owner `mine`, source `plugin`, plugin `p@m`:
           `{ type: 'installed', plugin: 'p@m' }`
           `readOnlyReason_OwnRepoFile_Null` — owner `mine`, source `repo`, plugin `w@m`: null
           `readOnlyText_Downloaded_NamesPlugin` — `{ type: 'downloaded', plugin: 'v@m' }`:
           `'Downloaded copy — v@m. Edits are lost on its next update.'`
           `readOnlyText_DownloadedSynced_SaysSyncedSkill` — `{ type: 'downloaded', plugin: null }`:
           `'Downloaded copy — synced skill. Edits are lost on its next update.'`
           `readOnlyText_Installed_NamesPlugin` — `{ type: 'installed', plugin: 'p@m' }`:
           `'Installed copy — p@m. The clone has no such file.'`
           `changeableEntry_SyncedSkill_RefusedReadOnly` — a synced skill (owner `third-party`, source `global`):
           `{ refusal: { text: 'Downloaded copy — synced skill. Edits are lost on its next update.', tone: 'info' } }`
           `fileStatuses_TwoClones_MergedByEntryId` — clones with `files` `{ a: s1 }` and `{ b: s2 }`: map entries
           `[['a', s1], ['b', s2]]`; `fileStatuses(null)` is empty
           `statusTexts_EverySet_InPinnedOrder` — status `{ uncommitted: true, unpushed: true, notInstalled: ['codex',
           'claude'] }`, entry plugin `w@m` with a `claude` copy version `1.9.1`, loaded `{ 'w@m': '1.9.0' }`:
           `['Uncommitted', 'Unpushed', 'Not installed · Claude', 'Not installed · Codex', 'Session stale']`
           `statusTexts_LoadedSameVersion_NotStale` — loaded `{ 'w@m': '1.9.1' }`, no status: `[]`
           `statusTexts_KeyNotLoaded_NotStale` — loaded `{}`: `[]`
           `statusTexts_NoClaudeCopy_NotStale` — only a `codex` copy version `0.17.1`, loaded `{ 'w@m': '0.1.0' }`: `[]`
           `rollupText_Counts_InOrderZerosLeftOut` — `{ uncommitted: 3, unpushed: 1, notInstalled: { claude: 0,
           codex: 12 } }`: `'3 uncommitted · 1 unpushed · 12 not installed for Codex'`
           `rollupText_BothHarnesses_ClaudeFirst` — `{ uncommitted: 0, unpushed: 0, notInstalled: { claude: 2,
           codex: 5 } }`: `'2 not installed for Claude · 5 not installed for Codex'`
           `rollupText_AllZero_Null` — every count 0: null
           `fetchText_FailedFetched_OriginAsOf` — `fetchFailed: true`, `fetchedAt: '2026-10-24T10:00:00Z'`,
           a formatter that wraps the ISO text as `T(<iso>)`: `'origin as of T(2026-10-24T10:00:00Z)'`
           `fetchText_FailedNeverFetched_OriginNeverFetched` — `fetchFailed: true`, `fetchedAt: null`:
           `'origin never fetched'`
           `fetchText_NotFailed_Null` — `fetchFailed: false`: null
           `treeRowStatus_LeafWithTexts_MarkJoined` — `textsOf` gives `['Uncommitted', 'Not installed · Codex']`:
           `{ mark: 'Uncommitted · Not installed · Codex', detail: null }`
           `treeRowStatus_LeafNoTexts_Nothing` — `{ mark: null, detail: null }`
           `treeRowStatus_PluginNode_Rollup` — a `plugin` group over leaves a (uncommitted), b (uncommitted,
           unpushed), c (none): `{ mark: null, detail: '2 uncommitted · 1 unpushed' }`
           `treeRowStatus_RepoNodeFetchFailed_RollupThenOrigin` — a `repo` group with `clone: '/r'` over leaf a
           (uncommitted), clones `[{ root: '/r', fetchedAt: null, fetchFailed: true, files: { a: … } }]`:
           detail `'1 uncommitted · origin never fetched'`
           `treeRowStatus_SplitRepoNode_RollupNoOrigin` — a `repo` group with `clone: null`, the same leaf and a
           failed clone: detail `'1 uncommitted'`
           `treeRowStatus_KindGroup_NoDetail` — an `other` group over leaf a (uncommitted): `{ mark: null, detail: null }`
           in `tree.test.ts`:
           `buildTree_Roles_RepoClonePluginOther` — repo `m` with a `w@m` skill at one clone `/Users/u/dev/m`: repo
           node role `{ type: 'repo', clone: '/Users/u/dev/m' }`, plugin node `{ type: 'plugin' }`, its kind group
           `{ type: 'other' }`, Mine `{ type: 'other' }`
           `buildTree_RolesSplit_CloneRolesRepoNull` — two clones: repo role `{ type: 'repo', clone: null }`, each
           clone node `{ type: 'clone', clone: <its root> }`
Approach:
- `docs-view.ts` keeps `statusRead: PluginStatusRead | null` and `files = fileStatuses(statusRead)`. `textsOf` is
  `(entryId) => { const entry = entriesById.get(entryId); return entry === undefined ? [] : statusTexts(entry,
  files.get(entryId), context()?.loadedPlugins ?? {}); }`. It hands `textsOf` to the doc view as `statusesOf`, and
  to the tree view's `rowStatus` through `treeRowStatus(node, textsOf, files, statusRead?.clones ?? [], formatTime,
  deps.paths)`. Each shown reply calls `tree.statusesChanged()` and `doc.refreshChips()`.
- `rebuild()` returns the run it starts, so `rescan()` chains the status reads on it. `showFirstTime` chains them on
  its `runIndex('loadIndex')` before its rebuild, whatever that read returned.
- `tree-view.ts`: `rowElement` reads `deps.rowStatus(row.node)`; a `detail` goes in `row`'s `detail`, a `mark` in
  its `trailing` as `statusDot('warning')` with `title` set. `statusesChanged` redraws the rows (`draw()`).
- `doc-view.ts` `drawChips` appends `tag(text, 'warning')` per `statusesOf(entryId)` text after the two load-state
  chips.
- Live look (chip tones, the muted rollup, the read-only line): task 14.
Done when: `npm run typecheck` passes; `npx vitest run src/plugins/docs` passes with every test above;
           `npm run lint` passes; `rootIds` and `cachePlugin` no longer appear under `src/plugins/docs`
Commit:    one commit for the group, in wigley-ai-gui, committed by path only (peer sessions have uncommitted edits)

## Lead rulings (cold plan reader)

- Statuses are read again after every change of the view's entries (first load, the launch background rebuild, Rescan, and the rebuild after create, rename or delete), each time the pair `pluginStatus(id, false)` then `pluginStatus(id, true)`, a stale reply dropped by the counter. Fetch runs only on the first read and on Rescan: every other re-read sends `pluginStatus(id, false)` alone.
- The installed-only read-only text is `Installed copy — <plugin key>. Edits are lost on its next update.` It makes no claim about the clone.
- `provisionalEntry`'s `plugin` (06 leaves it null) is filled here: when the new file sits inside a folder holding entries with `source: 'repo'` and a `plugin` key (`Paths.isInside` on the common folder of that key's entries), the provisional entry takes that key, so a new skill shows under its plugin node at once.

## Proof

Commit gui 5caae01e · proof: diff read: GroupRole/TreeGroup.role, read-only reasons, status texts, rollups and the pluginStatus reads present; tsc clean · concerns: a status reply redraws the tree, scrolling the selected row back into view even when the user scrolled away
