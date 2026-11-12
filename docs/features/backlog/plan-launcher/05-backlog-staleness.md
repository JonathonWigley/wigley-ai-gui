# 05 — Backlog staleness

Status: not started
Type: Task
Rung: deep · crosses git, the files service and plugin data through an async read queue and a cache keyed on two clones' HEADs
Wave: 2 · Depends on: 01
Plan: [plan.md](plan.md)

Backlog main learns, for each open follow-up, whether the code it names has moved or gone since the item was written.
The decisions are pure (`namedPaths`, `stalenessOf`); a reader runs them over the injected `Git` and `Files`, caches
the result in backlog's plugin data, and pushes each batch to the page. This task also adds the per-home repo folder
that 06 starts chunk sessions in, and the two new settings.

Files:
- create `src/plugins/backlog/row-key.ts`
- create `src/plugins/backlog/main/rows.ts` · test `src/plugins/backlog/main/rows.test.ts`
- create `src/plugins/backlog/main/repo-folder.ts` · test `src/plugins/backlog/main/repo-folder.test.ts`
- create `src/plugins/backlog/main/staleness.ts` · test `src/plugins/backlog/main/staleness.test.ts`
- modify `src/plugins/backlog/contract.ts`
- modify `src/plugins/backlog/manifest.ts`
- modify `src/plugins/backlog/main/start.ts` · test `src/plugins/backlog/main/start.test.ts`

Consumes:
- `Git.firstAdded(root: string, path: string, text: string): Promise<GitCommit | null>` in `src/contracts/git.ts` ← 01
- `Git.log(root: string, paths: string[], limit: number): Promise<GitCommit[]>`, `Git.topLevel`, `Git.resolveCommit`
  and `GitCommit` — in the tree (`src/contracts/git.ts`)
- `Files.stat`, `Files.read`, `Files.write` (`src/contracts/files.ts`); `api.data` (plugin data, `src/contracts/plugin.ts`
  `MainApi.data`) — in the tree
- `FollowupItem` (`title`, `oneLine`, `tags`, `body`, `line`, `done`) in `src/shared/followups/followup-file.ts` — in the tree

Produces:
- `src/plugins/backlog/contract.ts`:
  - `export type RowKey = string;` with the comment `` // `${repo}\n${title}` ``
  - `export interface BacklogStaleness { writtenAt: string | null; commitsSince: number; lastCommit: GitCommit | null; namedPaths: string[]; gonePaths: string[]; level: 'fresh' | 'moved' | 'stale' | 'unknown' }`
  - `export interface RepoFolderSetting { repo: string; folder: string }`
  - `BacklogHome` gains `repoFolder: string | null`
  - `BacklogChannel.invoke` gains `staleness(): Promise<Record<RowKey, BacklogStaleness>>` and
    `commitsSince(key: RowKey): Promise<GitCommit[]>`
  - `BacklogChannel.messages` gains `stalenessRead: { entries: Record<RowKey, BacklogStaleness> }`
- `src/plugins/backlog/row-key.ts`: `export function rowKey(repo: string, title: string): RowKey`
- `src/plugins/backlog/main/rows.ts`:
  - `export interface BacklogRow { key: RowKey; repo: string; title: string; oneLine: string; tags: string[]; body: string; done: boolean; path: string; line: number; homeRoot: string; repoFolder: string | null }`
  - `export function backlogRows(read: BacklogRead): BacklogRow[]`
- `src/plugins/backlog/main/repo-folder.ts`:
  `export function repoFolderOf(home: { repo: string; root: string }, isInClone: boolean, settings: readonly RepoFolderSetting[], paths: Paths, homeDir: string): string | null`
- `src/plugins/backlog/main/staleness.ts`:
  - `export function namedPaths(text: string): string[]`
  - `export function itemAnchor(line: string, title: string): string`
  - `export function stalenessOf(facts: { gonePaths: readonly string[]; commitsSince: number; writtenAt: string | null }): BacklogStaleness['level']`
  - `export const STALENESS_LOG_LIMIT = 100;`
  - `export interface StalenessReader extends Disposable { read(rows: readonly BacklogRow[]): Promise<Record<RowKey, BacklogStaleness>>; commitsSince(row: BacklogRow): Promise<GitCommit[]>; entries(): Record<RowKey, BacklogStaleness>; }`
  - `export interface StalenessDeps { git: Pick<Git, 'topLevel' | 'resolveCommit' | 'log' | 'firstAdded'>; files: Pick<Files, 'stat' | 'read'>; data: Pick<Files, 'read' | 'write'>; paths: Paths; log: PluginLog; send(entries: Record<RowKey, BacklogStaleness>): void }`
  - `export function createStalenessReader(deps: StalenessDeps): StalenessReader`
- `createBacklogMain` in `src/plugins/backlog/main/start.ts` returns one more member, `lastRead(): Promise<BacklogRead>`
  (06 and 07 call it).
- `src/plugins/backlog/manifest.ts` settings `launchBrief` and `repoFolders`, values below.

Decisions:
- **Row key** (plan.md Backlog names): `rowKey(repo, title)` returns `` `${repo}\n${title}` ``. It lives in the plugin's own
  folder, outside `main/` and `page/`, so 08's page builds the same key (AGENTS.md § A plugin talks: a plugin imports its
  own folder).
- **Rows** (interview: rows across all repos): `backlogRows(read)` gives one row per item of every home's
  `followupFiles`, done items included with `done: true`. Homes are grouped by repo: the repos in the order each first
  appears in `read.homes`, and under each repo its homes in `read.homes` order (the rule of the page's `orderedHomes`
  today, so 08's table and `read_backlog_state` list rows in one order). Files in order, items in file order. `path` is the follow-up file's full path; `line` is `FollowupItem.line`; `homeRoot` and `repoFolder` are
  the home's. When two items give the same key (a stray second home of one repo, or a repeated title), the first one
  wins and the later ones are left out.
- **Repo folder** (interview: the repo's folder; design review: one rule for starts and staleness). `repoFolderOf`
  returns, in order:
  1. the folder above `docs/features` when `paths.base(root)` is `features`, `paths.base(paths.parent(root))` is `docs`,
     and `isInClone` is true;
  2. else the `folder` of the first `settings` entry whose `repo` equals `home.repo` exactly (case-sensitive), through
     `paths.expandTilde(folder, homeDir)` and then `paths.normalize`. An entry whose expanded folder is empty or not
     `paths.isAbsolute` counts as no entry (the next matching entry is not tried), so the result is null and 06
     refuses the start with the setting's hint;
  3. else null.
  The rule reads the path shape, not `BacklogHome.gitRoot`: a repo that is a folder of a larger clone (the `ai` repo's
  `wigley-ai-gui/docs/features`) has `gitRoot` null today but is still in-repo. `isInClone` is
  `git.topLevel(home.root) !== null`, which `locateHome` in `start.ts` already reads: `locateHome` keeps that result, and
  `readHome` fills `BacklogHome.repoFolder` from `repoFolderOf` with the `repoFolders` setting and the real home folder.
  A thrown `topLevel` (already logged by `locateHome`) counts as not in a clone.
- **`repoFolders` setting shape — changed from plan.md.** plan.md gives `repoFolders` as `{ "<repo>": "<folder>" }` with
  default `{}`. That cannot load: `mergeObject` in `src/main/config/user-settings.ts` throws `"repoFolders.<repo>" is not
  a setting.` for every key the default lacks, and `SettingPath` of `{}` has no leaf to carry a `settingInfo`. The
  setting is an array instead, as chat's `projects: [] as ProjectSetting[]` is: default `[] as RepoFolderSetting[]`,
  each element `{ "repo": "<repo>", "folder": "<folder>" }` (an empty default array takes any elements). The lead fixes
  the docs written ahead to match.
- **Settings added** to `backlogManifest.settings` and `settingInfo` (verbatim):
  - `launchBrief: 'Work these follow-ups in this session. First check each one against the code as it is now: remove an item whose work has landed, and rewrite an item the code has moved past. Then work the rest under your workflow, and report what you did with each item.'`
    — settingInfo `{ label: 'Launch brief', description: "The text a chunk's session reads first, before the chunk's follow-ups." }`
    (plan.md decision: confirm each item, drop or rewrite stale ones, then work the rest under its workflow).
  - `repoFolders: [] as RepoFolderSetting[]` — settingInfo `{ label: 'Repo folders', description: 'The folder each repo whose features home is outside the repo starts sessions in and resolves paths against: a list of { "repo", "folder" }.' }`
  `tags` and `layout` stay. A change to `repoFolders` sends `changed` with `homeRoot: null` (through
  `api.onSettingsChanged`, only when the `repoFolders` value differs by `JSON.stringify` from the last one seen), so the
  page loads again and each home's `repoFolder` follows.
- **`namedPaths(text)`** (interview: `commitsSince` over the paths the body names). The reader passes
  `` `${item.oneLine}\n${item.body}` ``, since a list-shaped file's lead line holds most of an item's paths. The rule,
  pinned from `docs/features/followups.md`:
  1. A candidate is the text between each pair of single backticks on one line. Lines inside a fenced code block
     (between two lines that start with ```` ``` ````) give no candidates.
  2. Strip a trailing line reference matching `/(:\d+)+(-\d+)?$/`, then a leading `./`, then a trailing `/`.
  3. Drop the candidate when it holds whitespace, `:` (a symbol suffix such as `a.ts:fnName`, or a URL) or any of
     `< > * ? { } [ ] ( ) $ = , | ' " #`, when it starts with `/`, `~`, `-` or `..`, or when it is empty.
  4. Keep it when it holds a `/`, or when it ends in `.` and 1 to 6 letters or digits (`/\.[A-Za-z0-9]{1,6}$/`).
  5. Return the kept candidates once each, in first-seen order.

  | Token in an item | `namedPaths` gives |
  |---|---|
  | `` `src/main/plugin-catalog/user-folder-source.ts` `` | `src/main/plugin-catalog/user-folder-source.ts` |
  | `` `src/plugins/chat/page/activity-runs.ts:60` `` | `src/plugins/chat/page/activity-runs.ts` |
  | `` `src/a.ts:12-20` `` | `src/a.ts` |
  | `` `src/a.ts:12:5` `` | `src/a.ts` |
  | `` `src/a.ts:fnName` `` | nothing |
  | `` `src/main/git/` `` | `src/main/git` |
  | `` `AGENTS.md` `` | `AGENTS.md` |
  | `` `start.test.ts` `` | `start.test.ts` (the reader drops it unless the repo folder holds it) |
  | `` `info.host` `` | `info.host` (the reader drops it) |
  | `` `agent-chat/claude-stream.md` `` | `agent-chat/claude-stream.md` (the reader drops it) |
  | `` `/clear` `` | nothing |
  | `` `~/.claude` `` | nothing |
  | `` `<userData>/plugin-code/<id>/<rev>/` `` | nothing |
  | `` `[sessions] activated Layout preview` `` | nothing |
  | `` `npm run selftest -- --plugin chat` `` | nothing |
  | `` `CLAUDE_CONFIG_DIR` `` | nothing |
  | `` `../other/file.ts` `` | nothing |
- **Resolving named paths** (design review: decisions pure, I/O in the reader). A candidate is relative to the row's
  repo folder. The reader keeps a candidate only when the repo folder holds its first segment
  (`files.stat(paths.join(repoFolder, firstSegment)) !== null`); a candidate whose first segment is missing is relative
  to somewhere else (`agent-chat/…` under a docs folder) or is no path (`info.host`), and is left out of both
  `namedPaths` and `gonePaths`. A kept candidate whose full path `files.stat` returns null for is gone. A row with no
  repo folder has `namedPaths: []` and `gonePaths: []`.
- **Two clones** (interview: `writtenAt` from the commit that first added the title). The item's history is in the
  home's clone, `homeClone = git.topLevel(row.homeRoot)`; the named paths' history is in the repo folder's clone,
  `repoClone = git.topLevel(row.repoFolder)`. They are the same clone for an in-repo home and differ for a
  `~/wigley-features` home that is itself in a clone. Git paths are relative to each clone: the follow-up file is
  `paths.segmentsBelow(row.path, homeClone).join('/')`; a named path gets the prefix
  `paths.segmentsBelow(row.repoFolder, repoClone).join('/')` (none when the repo folder is the clone's top).
- **The text `firstAdded` searches for** (cold read: `git log -S` counts raw substrings, so a bare title also matches
  an earlier commit that added a longer title holding it, `Fix the cache` in `Fix the cache warmup`, or another
  item's body quoting it, and `writtenAt` then reads too early). The reader passes `itemAnchor(line, row.title)`, where
  `line` is the follow-up file's line `row.line` (1-based) as `files.read(row.path)` gives it now; each file is read
  once per pass. `itemAnchor` is pure:
  1. `i = line.indexOf(title)`; when `i < 0` (a bold title wrapped over two lines) it returns `title`.
  2. `start` is `i` moved left over the `*` characters just before it; when `line.slice(0, start)` is `'## '`,
     `start` is 0 (a sections heading keeps its `## `). A list marker (`- `, `3. `) is never kept, so renumbering does
     not move `writtenAt`.
  3. `end` is `i + title.length` moved right over the `*`, `:` and `.` characters just after it.
  4. It returns `line.slice(start, end)`, plus `'\n'` when `end === line.length`.

  | `line` | `title` | `itemAnchor` gives |
  |---|---|---|
  | `## Fix the cache` | `Fix the cache` | `'## Fix the cache\n'` |
  | `- **Fix the cache** — *agent-ready*: warm it` | `Fix the cache` | `'**Fix the cache**'` |
  | `3. **Fix the cache:** warm it` | `Fix the cache` | `'**Fix the cache:**'` |
  | `- Fix the cache. Warm it first.` | `Fix the cache` | `'Fix the cache.'` |
  | `- Fix the cache` | `Fix the cache` | `'Fix the cache\n'` |
  | `- **Fix the cache` | `Fix the cache warmup` | `'Fix the cache warmup'` |

  When `firstAdded` with the anchor resolves null and the anchor is not `row.title` (a last line with no newline
  after it, or an item not committed yet), the reader calls `firstAdded` once more with `row.title`. A file that
  `files.read` rejects for gives the anchor `row.title`. Accepted limit: an anchor that also occurs earlier in the
  file's history (the same bold title quoted in an older item's body) still dates the item early.
- **Reading one row**, in order:
  - `written = homeClone === null ? null : await git.firstAdded(homeClone, filePath, anchor)`, with the fallback
    above; `writtenAt` is `written?.at ?? null`.
  - When `written` is not null and `repoClone` is not null and `namedPaths` is not empty:
    `git.log(repoClone, prefixedNamedPaths, STALENESS_LOG_LIMIT)`, kept while `Date.parse(commit.at) >
    Date.parse(written.at)` and `commit.sha !== written.sha`. `commitsSince` is the kept count, and `lastCommit` the first
    kept commit (newest), else null. Otherwise `commitsSince` 0 and `lastCommit` null. The bound is strict: a commit
    with the same instant as `written` and another sha is not counted.
  - `level = stalenessOf({ gonePaths, commitsSince, writtenAt })`.
  - A rejected git call (a clone with no commit yet, a folder gone, an index lock) logs `staleness of <title>: <error
    text>` through `deps.log` and gives that row `{ writtenAt: null, commitsSince: 0, lastCommit: null, namedPaths,
    gonePaths, level }` with the level from `stalenessOf` over those values. That entry is sent and is in `entries()`,
    but it is not written to `staleness.json`, so the next `read` queues the row again (cold read: a transient
    failure must not stay `unknown` until HEAD moves).
- **`stalenessOf`** (interview, verbatim order): any gone path → `stale`; else `commitsSince > 0` → `moved`; else
  `writtenAt` null → `unknown`; else `fresh`.
- **Cache** (interview: cached in plugin data keyed by row key and HEAD sha). The cache holds the git facts only;
  `namedPaths` and `gonePaths` come from `files.stat` on every `read` (cold read: a file deleted, renamed or added
  with no commit leaves the HEADs and the body as they were, so a cached `gonePaths` would stay wrong until the next
  commit; a stat costs little against a pickaxe). File `staleness.json` in plugin data:
  `{ "entries": { "<row key>": { "heads": string, "body": string, "facts": { "writtenAt": string | null, "commitsSince": number, "lastCommit": GitCommit | null } } } }`.
  `heads` is `` `${repoHead} ${homeHead}` ``, each the clone's `git.resolveCommit(clone, 'HEAD')`, `''` for no clone or
  no commit. An entry is valid when its `heads` and its `body` (`` `${oneLine}\n${body}` ``) equal the row's now. The
  body joins the key so an uncommitted edit that names a new path reads again. A valid entry gives the row
  `{ ...facts, namedPaths, gonePaths, level: stalenessOf({ gonePaths, commitsSince, writtenAt }) }` with the paths
  stat-ed now. Accepted limit: a candidate's first segment made or deleted with no commit changes which paths `log`
  covers only at the next HEAD move. A missing or unreadable file reads as no entries; an unreadable one logs
  `staleness.json unreadable; reading every row`. Each write keeps only the keys of the last `read` call's rows, and
  never an entry from a rejected git call. HEADs are resolved once per clone per `read` call; a stat result is
  reused within one `read` call.
- **The read queue.** `read(rows)` stats the named paths of every open row (`done` false), then resolves to the
  entries of the open rows with a valid cached entry, and queues every open row with none. One pass runs at a time,
  one row after another; a `read` call during a pass adds its rows to the queue, each key once, and the newest call's
  row object wins. The pass calls `deps.send` with the entries read since its last send after every 10 rows and when
  the queue empties, and writes `staleness.json` at each send. `entries()` returns every entry read or cached in this
  run, keyed by row key, for 07.
- **When staleness is read again.** Main reads only when `staleness()` is invoked; it watches no HEAD. 08 invokes it
  after every load and reload, and when Backlog is shown, so a commit with no follow-up file change is seen at the next
  of those (08 owns the page side).
- **`dispose()`** (cold read: a stopped or restarted part must not send, or overwrite the new part's
  `staleness.json`). After `dispose`, the pass stops before its next row, the queue is dropped, and `deps.send` and the
  `staleness.json` write are not called again; a `read` call resolves its cached entries and queues nothing. `start`
  returns `dispose: () => staleness.dispose()` on its `MainStart`.
- **`commitsSince(row)`** runs the same `firstAdded` (same anchor and fallback) and `log` as a read, uncached, and
  resolves to the kept commits (newest first); `[]` when the row has no written commit, no repo clone or no named
  paths.
- **The last load** (cold read: `last` is private to `createBacklogMain`, and a fresh `load()` per tool call re-walks
  the docs index and rebuilds the watches). `createBacklogMain` returns `lastRead(): Promise<BacklogRead>`: the `last`
  read when there is one, else `load()`. 05's `staleness` and `commitsSince` handlers, 06's starts and 07's tools and
  `sweep` read rows through it, so they match what the page loaded last.
- **Wiring in `start.ts`.** `createStalenessReader` takes `services.git`, `services.files`, `api.data`,
  `services.paths`, `services.log` and `send: (entries) => channel.send('stalenessRead', { entries })`. Handler
  `staleness`: `backlogRows(await backlog.lastRead())`, then `reader.read(rows)`. Handler `commitsSince(key)`: the row
  with that key from `backlogRows(await backlog.lastRead())`; rejects `No Backlog row <key with \n shown as " — ">`
  when no row has it. `start` builds the reader beside `createBacklogMain` as `const staleness =
  createStalenessReader(…)`; 06 and 07 reach it by that name in `start`.
- **Self-test fixture**: unchanged here. 08 owns the fixture's Moved item and Stale item (one row of each staleness
  level), relying on this task's rules: a named path kept by the first-segment check, a commit counted only when its
  committer date is strictly later than `writtenAt`, and a gone path → `stale` ahead of everything else.

GIVEN a body naming `` `src/kept.ts` `` and `` `src/gone.ts` `` in a repo folder that holds `src/` and `src/kept.ts`
WHEN the reader reads the row THEN `namedPaths` is both paths, `gonePaths` is `['src/gone.ts']` and `level` is `stale`.

GIVEN a row written at commit W and two later commits touching a named path WHEN the reader reads it THEN
`commitsSince` is 2, `lastCommit` is the newer one, and `level` is `moved`.

GIVEN a `~/wigley-features/<repo>` home with no `repoFolders` entry WHEN the reader reads its row THEN `namedPaths` and
`gonePaths` are empty and `level` is `unknown` (or `fresh` when the home's own clone dates the item and nothing is named).

GIVEN a cached entry whose heads and body match WHEN `staleness` is invoked THEN it resolves with that entry and makes
no `firstAdded` or `log` call.

GIVEN HEAD moved since the cache was written WHEN `staleness` is invoked THEN it resolves without that row, and a
`stalenessRead` message carries the new entry.

GIVEN a valid cached entry and a named path deleted with no commit WHEN `staleness` is invoked THEN the row resolves
with that path in `gonePaths` and level `stale`, and no git call runs.

GIVEN an item `Fix the cache` and an earlier commit that added `## Fix the cache warmup` WHEN the reader reads the row
THEN `firstAdded` gets `'## Fix the cache\n'` and `writtenAt` is the commit that added that heading.

Tests:
- `staleness.test.ts`:
  - `namedPaths_TokenTable_KeepsPathsOnly` — one `it.each` row per line of the token table above, plus
    a row for a token inside a fenced block (nothing) and a row for a repeated token (once).
  - `itemAnchor_LineTable_HeadingFormOrTitle` — one `it.each` row per line of the `itemAnchor` table.
  - `stalenessOf_Facts_GoneThenMovedThenUnknownThenFresh` — rows: gone and commits → `stale`; gone and no
    writtenAt → `stale`; commits only → `moved`; nothing and no writtenAt → `unknown`; nothing with writtenAt → `fresh`.
  - `read_FirstSegmentMissing_CandidateDropped` — `info.host` and `agent-chat/x.md` are in
    neither list.
  - `read_AnchorFromFileLine_PassedToFirstAdded` — a memory follow-up file whose line `row.line` is
    `## Fix the cache`: `firstAdded` gets `'## Fix the cache\n'`; when it resolves null, a second call gets
    `'Fix the cache'`; when `files.read` rejects, the one call gets `'Fix the cache'`.
  - `read_CommitsAroundWritten_CountsOnlyLater` — the fake `log` returns the written commit, one older, one with the
    written commit's instant and another sha, and two newer; `commitsSince` is 2.
  - `read_RepoFolderBelowClone_PathsPrefixed` — the repo folder `/c/wigley-ai-gui` in clone
    `/c`; `log` is called with `wigley-ai-gui/src/a.ts`; `firstAdded` with the file path below the home's clone.
  - `read_CacheValid_NoGitCall` and `read_HeadOrBodyChanged_ReadsAgain` — memory
    files as plugin data; spies on `firstAdded` and `log`.
  - `read_CacheValidPathGone_RestatsAndStale` — the third GIVEN above.
  - `read_DoneRow_Skipped`.
  - `read_GitRejects_LoggedAndLevelled`.
  - `read_GitRejectedThenGood_ReadsAgainUnderSameHeads` — `firstAdded` rejects on the first pass and resolves on the
    second; the written `staleness.json` holds no entry after the first pass, and the second `read` queues the row.
  - `read_NoRepoFolder_EmptyListsUnknown` — rows: `repoFolder` null and home outside git → empty lists, `unknown`;
    `repoFolder` null and the home's clone dates the item → empty lists, `fresh`.
  - `read_HomeOutsideGit_Unknown` — `topLevel(homeRoot)` null: no `firstAdded` call, `writtenAt` null.
  - `read_DuringPass_QueuesOnceNewestRowWins` — a second `read` during a pass with one key already queued and a
    changed row object for it: the key is read once, with the second call's row.
  - `read_CacheUnreadable_LoggedAndReadsAll` — `staleness.json` holds `{`: the log line, and every open row queued.
  - `read_TwelveRows_SendsTenThenTwo` — 12 rows give two sends, of 10 and 2 entries.
  - `commitsSince_Row_KeptNewestFirstAndEmptyCases` — rows: kept commits newest first; no written commit → `[]`; no
    repo clone → `[]`; no named paths → `[]`.
  - `entries_AfterRead_HoldsReadAndCached` — after a `read` with one cached and one queued row and the pass, both
    keys are in `entries()`.
  - `dispose_DuringPass_SendsAndWritesNothing` — `dispose` after the first `send`: no later `send`, no later
    `staleness.json` write, no later `firstAdded` call.
- `repo-folder.test.ts`: `repoFolderOf_Homes_InRepoThenSettingThenNull` — rows:
  in-repo shape in a clone → parent of `docs`; same shape not in a clone with a setting entry → the expanded setting;
  `~/wigley-features/<repo>` with `~/dev/<repo>` set → `<home>/dev/<repo>`; no entry → null; a relative folder
  `dev/x` → null; an empty folder → null; `~/dev/x/` → `<home>/dev/x` (normalized); a `repo` that differs only in
  case → null.
- `rows.test.ts`: `backlogRows_TwoHomes_OneRowPerItemFirstKeyWins` — two homes of one repo with a shared
  title keep the first; a done item is a row with `done: true`; `key` is `` `${repo}\n${title}` ``;
  `backlogRows_HomesOfTwoRepos_GroupedByRepo` — homes A1, B, A2 give the rows of A1, A2, then B.
- `start.test.ts`, added to `describe('backlog main part')`: `staleness_Invoke_CachedThenSendsTheRest`;
  `commitsSince_UnknownKey_Rejects`; `settings_RepoFoldersChanged_SendsChanged`; `lastRead_AfterLoad_NoSecondLoad`
  (one `docs.machineIndex` call for a `load` then a `staleness` invoke); `dispose_Part_DisposesTheReader`; and
  `repoFolder` added to the expected homes of `load_FeaturesHome_FollowupFilesParsed`.

Done when: `npm run typecheck` passes; `npm test -- src/plugins/backlog` passes; `npm run lint` passes. The live check
of staleness in the page is `10-final-verification.md`'s. The backlog self-test is not run here: 08 rewrites it.

Commit: one commit for the group.

## Proof
