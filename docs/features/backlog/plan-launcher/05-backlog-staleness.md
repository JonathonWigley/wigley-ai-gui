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
  - `export function stalenessOf(facts: { gonePaths: readonly string[]; commitsSince: number; writtenAt: string | null }): BacklogStaleness['level']`
  - `export const STALENESS_LOG_LIMIT = 100;`
  - `export interface StalenessReader { read(rows: readonly BacklogRow[]): Promise<Record<RowKey, BacklogStaleness>>; commitsSince(row: BacklogRow): Promise<GitCommit[]>; entries(): Record<RowKey, BacklogStaleness>; }`
  - `export interface StalenessDeps { git: Pick<Git, 'topLevel' | 'resolveCommit' | 'log' | 'firstAdded'>; files: Pick<Files, 'stat'>; data: Pick<Files, 'read' | 'write'>; paths: Paths; log: PluginLog; send(entries: Record<RowKey, BacklogStaleness>): void }`
  - `export function createStalenessReader(deps: StalenessDeps): StalenessReader`
- `src/plugins/backlog/manifest.ts` settings `launchBrief` and `repoFolders`, values below.

Decisions:
- **Row key** (plan.md Backlog names): `rowKey(repo, title)` returns `` `${repo}\n${title}` ``. It lives in the plugin's own
  folder, outside `main/` and `page/`, so 08's page builds the same key (AGENTS.md § A plugin talks: a plugin imports its
  own folder).
- **Rows** (interview: rows across all repos): `backlogRows(read)` gives one row per item of every home's
  `followupFiles`, homes in `read.homes` order, files in order, items in file order, done items included with
  `done: true`. `path` is the follow-up file's full path; `line` is `FollowupItem.line`; `homeRoot` and `repoFolder` are
  the home's. When two items give the same key (a stray second home of one repo, or a repeated title), the first one
  wins and the later ones are left out.
- **Repo folder** (interview: the repo's folder; design review: one rule for starts and staleness). `repoFolderOf`
  returns, in order:
  1. the folder above `docs/features` when `paths.base(root)` is `features`, `paths.base(paths.parent(root))` is `docs`,
     and `isInClone` is true;
  2. else the `folder` of the first `settings` entry whose `repo` equals `home.repo`, through
     `paths.expandTilde(folder, homeDir)`;
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
  2. Strip a trailing line reference matching `/:\d+(-\d+)?$/`, then a leading `./`, then a trailing `/`.
  3. Drop the candidate when it holds whitespace or any of `< > * ? { } [ ] ( ) $ = , | ' " #`, when it starts with
     `/`, `~`, `-` or `..`, when it holds `://`, or when it is empty.
  4. Keep it when it holds a `/`, or when it ends in `.` and 1 to 6 letters or digits (`/\.[A-Za-z0-9]{1,6}$/`).
  5. Return the kept candidates once each, in first-seen order.

  | Token in an item | `namedPaths` gives |
  |---|---|
  | `` `src/main/plugin-catalog/user-folder-source.ts` `` | `src/main/plugin-catalog/user-folder-source.ts` |
  | `` `src/plugins/chat/page/activity-runs.ts:60` `` | `src/plugins/chat/page/activity-runs.ts` |
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
- **Reading one row**, in order:
  - `written = homeClone === null ? null : await git.firstAdded(homeClone, filePath, row.title)`; `writtenAt` is
    `written?.at ?? null`.
  - When `written` is not null and `repoClone` is not null and `namedPaths` is not empty:
    `git.log(repoClone, prefixedNamedPaths, STALENESS_LOG_LIMIT)`, kept while `Date.parse(commit.at) >
    Date.parse(written.at)` and `commit.sha !== written.sha`. `commitsSince` is the kept count, and `lastCommit` the first
    kept commit (newest), else null. Otherwise `commitsSince` 0 and `lastCommit` null.
  - `level = stalenessOf({ gonePaths, commitsSince, writtenAt })`.
  - A rejected git call (a clone with no commit yet, a folder gone) logs `staleness of <title>: <error text>` through
    `deps.log` and gives that row `{ writtenAt: null, commitsSince: 0, lastCommit: null, namedPaths, gonePaths, level }`
    with the level from `stalenessOf` over those values.
- **`stalenessOf`** (interview, verbatim order): any gone path → `stale`; else `commitsSince > 0` → `moved`; else
  `writtenAt` null → `unknown`; else `fresh`.
- **Cache** (interview: cached in plugin data keyed by row key and HEAD sha). File `staleness.json` in plugin data:
  `{ "entries": { "<row key>": { "heads": string, "body": string, "staleness": BacklogStaleness } } }`. `heads` is
  `` `${repoHead} ${homeHead}` ``, each the clone's `git.resolveCommit(clone, 'HEAD')`, `''` for no clone or no commit.
  An entry is valid when its `heads` and its `body` (`` `${oneLine}\n${body}` ``) equal the row's now. The body joins the
  key so an uncommitted edit that names a new path reads again. A missing or unreadable file reads as no entries; an
  unreadable one logs `staleness.json unreadable; reading every row`. Each write keeps only the keys of the last
  `read` call's rows. HEADs are resolved once per clone per `read` call.
- **The read queue.** `read(rows)` resolves to the valid cached entries of the open rows (`done` false) at once, and
  queues every open row with no valid entry. One pass runs at a time, one row after another; a `read` call during a pass
  adds its rows to the queue, each key once, and the newest call's row object wins. The pass calls `deps.send` with the
  entries read since its last send after every 10 rows and when the queue empties, and writes `staleness.json` at each
  send. `entries()` returns every entry read or cached in this run, keyed by row key, for 07.
- **`commitsSince(row)`** runs the same `firstAdded` and `log` as a read, uncached, and resolves to the kept commits
  (newest first); `[]` when the row has no written commit, no repo clone or no named paths.
- **Wiring in `start.ts`.** `createStalenessReader` takes `services.git`, `services.files`, `api.data`,
  `services.paths`, `services.log` and `send: (entries) => channel.send('stalenessRead', { entries })`. Handler
  `staleness`: `backlogRows(await backlog.load())`, then `reader.read(rows)`. Handler `commitsSince(key)`: the row with
  that key from the last load's rows (a load first when there is none); rejects `No Backlog row <key with \n shown as
  " — ">` when no row has it. `start` builds the reader beside `createBacklogMain` as `const staleness =
  createStalenessReader(…)`; 06 and 07 reach it by that name in `start`.
- **Self-test fixture**: no change. The fixture's in-repo home resolves its repo folder by the path rule. 08 adds any
  fixture item it needs to show a stale or moved row.

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

Tests:
- `staleness.test.ts`:
  - `namedPaths_TokenTable_KeepsPathsOnly` — one `it.each` row per line of the token table above, plus
    a row for a token inside a fenced block (nothing) and a row for a repeated token (once).
  - `stalenessOf_Facts_GoneThenMovedThenUnknownThenFresh` — rows: gone and commits → `stale`; gone and no
    writtenAt → `stale`; commits only → `moved`; nothing and no writtenAt → `unknown`; nothing with writtenAt → `fresh`.
  - `read_FirstSegmentMissing_CandidateDropped` — `info.host` and `agent-chat/x.md` are in
    neither list.
  - `read_CommitsAroundWritten_CountsOnlyLater` — the fake `log` returns the written commit, one older and
    two newer; `commitsSince` is 2.
  - `read_RepoFolderBelowClone_PathsPrefixed` — the repo folder `/c/wigley-ai-gui` in clone
    `/c`; `log` is called with `wigley-ai-gui/src/a.ts`; `firstAdded` with the file path below the home's clone.
  - `read_CacheValid_NoGitCall` and `read_HeadOrBodyChanged_ReadsAgain` — memory
    files as plugin data; spies on `firstAdded` and `log`.
  - `read_DoneRow_Skipped`.
  - `read_GitRejects_LoggedAndLevelled`.
  - `read_TwelveRows_SendsTenThenTwo` — 12 rows give two sends, of 10 and 2 entries.
- `repo-folder.test.ts`: `repoFolderOf_Homes_InRepoThenSettingThenNull` — rows:
  in-repo shape in a clone → parent of `docs`; same shape not in a clone with a setting entry → the expanded setting;
  `~/wigley-features/<repo>` with `~/dev/<repo>` set → `<home>/dev/<repo>`; no entry → null.
- `rows.test.ts`: `backlogRows_TwoHomes_OneRowPerItemFirstKeyWins` — two homes of one repo with a shared
  title keep the first; a done item is a row with `done: true`; `key` is `` `${repo}\n${title}` ``.
- `start.test.ts`, added to `describe('backlog main part')`: `staleness_Invoke_CachedThenSendsTheRest`;
  `commitsSince_UnknownKey_Rejects`; `settings_RepoFoldersChanged_SendsChanged`; and `repoFolder` added to the expected
  homes of `load_FeaturesHome_FollowupFilesParsed`.

Done when: `npm run typecheck` passes; `npm test -- src/plugins/backlog` passes; `npm run lint` passes. The live check
of staleness in the page is `10-final-verification.md`'s. The backlog self-test is not run here: 08 rewrites it.

Commit: one commit for the group.

## Proof
