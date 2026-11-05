# 04 — Git log and Recent changes call

Status: done
Type: Task
Wave: 2 · Depends on: 02
Plan: [plan.md](plan.md)

Files:
- modify `src/contracts/git.ts`
- modify `src/main/git/process-git.ts`
- modify `src/plugins/docs/contract.ts`
- create `src/plugins/docs/main/recent-changes.ts`
- modify `src/plugins/docs/main/start.ts`
- modify `src/plugins/docs/manifest.ts` (`settings`, `settingInfo` and the header comment only)
- modify `AGENTS.md` (the `git/` line of the layer list)
- test: modify `src/main/git/process-git.test.ts`
- test: create `src/plugins/docs/main/recent-changes.test.ts`
- test: modify `src/plugins/docs/main/start.test.ts`
- test: modify `src/plugins/docs/main/plugin-status.test.ts` (the fake Git)
- test: modify `src/plugins/backlog/main/start.test.ts` (the fake Git)

Consumes: `src/plugins/docs/contract.ts` as task 02 leaves it. This task only shares the file with task 02, so it uses no name from task 02.

Produces:
- in `src/contracts/git.ts`:
  - `export interface GitCommit { sha: string; subject: string; at: string; paths: string[] }`
  - `Git.log(root: string, paths: string[], limit: number): Promise<GitCommit[]>`
- in `src/plugins/docs/contract.ts`:
  - `export interface RecentChange { sha: string; subject: string; at: string; paths: string[] }`
  - `DocsChannel.invoke.recentChanges(paths: string[]): Promise<RecentChange[]>`
- in `src/plugins/docs/main/recent-changes.ts`:
  - `export function readRecentChanges(paths: readonly string[], limit: number, deps: RecentChangesDeps): Promise<RecentChange[]>`
  - `export interface RecentChangesDeps { git: Pick<Git, 'topLevel' | 'log'>; files: Pick<Files, 'realPath'>; paths: Paths; log: PluginLog }`
- in `src/plugins/docs/manifest.ts`: the setting `recentChangesLimit`, default `10`

## Decisions

**`Git.log` runs exactly one command.** With an empty `paths` it returns `[]` and runs nothing, because an empty pathspec would log the whole repo. Otherwise, through `gitOutput(processes, 'log', args)`, the args are:

```
-C <root> --literal-pathspecs log --no-show-signature --no-merges --max-count=<limit> --format=%x00%H%x00%cI%x00%s -z --name-only -- <paths…>
```

Each flag has a reason:
- `--literal-pathspecs` stops `*`, `?`, `[` and a leading `:` in a path matching other files, as `fileAtHead` and `commitPaths` do.
- `--no-show-signature` keeps a user's `log.showSignature` out of the output.
- `--no-merges`: a merge commit lists no paths under `--name-only`, and it is not a change to a page.
- `%cI` is the committer date in strict ISO 8601 with its offset. `git log` orders by commit date, so `at` and the order agree. `at` is git's text, unchanged.
- `%s` folds a multi-line subject onto one line.
- `-z` turns off path quoting, so a path with a space or a non-ASCII character comes through as it is.
- `--name-only` under a pathspec lists only the matching paths. So `paths` holds the repo-relative paths the commit touched, from those asked for.

**Parsing.** Split stdout on `\0`. A real run on git 2.50.1 gave this field list:

```
['', <sha>, <at>, <subject>, '\n<path>', <path>, '', <sha>, <at>, '', '\n<path>', '']
```

- An empty field starts a record, because a path is never empty.
- The three fields after it are read by position: `sha`, `at`, `subject`. So an empty subject, a tab, a `|` or a control byte in a subject cannot move a field.
- The next fields, up to the next empty field or the end, are paths. The first path has one leading `\n`, and the parser removes it.
- An empty field at the end of the list starts no record.

No delimiter in the subject can break this, since git cannot store a NUL in a commit message.

**Failures of `Git.log`.** It rejects `git log exited <code>: <stderr>` on a failed run, as the comment at the top of `git.ts` states. A clone with no commit exits 128 and rejects. A path git has no history for is no failure: it gives `[]`.

**The limit is a setting.** The user confirmed the setting `docs.recentChangesLimit`, with default `10`. So `docsManifest.settings` gains `recentChangesLimit: 10`. `settingInfo` gains:
- label: `Recent changes`
- description: `How many commits the Main page's Recent changes lists.`

The channel call keeps plan.md's signature: `recentChanges(paths)`. The handler reads `api.settings().recentChangesLimit` at each call, so a changed setting applies at the next read. A bad value is the configurer's: there is no clamp.

**`readRecentChanges` steps.** It never rejects.

1. For each distinct path, in order, get the real path with `files.realPath`. `~/wigley-agents` is a symlink on this machine, and `git rev-parse --show-toplevel` returns real paths. So only a real path sits below the root it returns. A missing file is skipped with no log (`isMissingFile`). Any other failure is skipped and logged.
2. Get each real path's root with `git.topLevel(paths.parent(real))`, one call per distinct folder.
   - A null root (a path outside any git repo) is skipped with no log.
   - A rejection (git cannot start) skips that folder's paths and logs.
3. Get the repo-relative path with `paths.segmentsBelow(real, root)`, joined with `/` as `git.ts` requires. A null result is skipped.
4. Group by root, each root keeping the order it first appeared in. Call `git.log(root, relativePaths, limit)` for each root, in parallel. A rejection logs and counts as `[]` for that root, and the other roots still show. So a git failure never fails the Main page.
5. Turn each commit into a `RecentChange`: `paths` are `paths.join(root, relative)`, which are real paths.
6. Merge. A `sha` seen in an earlier root (two clones or worktrees of one repo) keeps its first row and gains the paths it does not hold. Compare whole real paths: `/r/a/x.md` and `/r/b/x.md` both stay, and the same real path appears once. Sort by `Date.parse(at)`, newest first, with a stable sort, so equal times keep root order and git's order. Do not compare `at` as text, since offsets differ.
7. Cut to `limit`.

Each root asks git for `limit` commits, so the newest `limit` overall are always in the union.

**Log lines** go through `deps.log`, in the form `plugin-status.ts` uses: `recent changes <path or root>: <errorText>`.

**Channel.** In `main/start.ts`, add one handler beside `pluginStatus`:

`channel.handle('recentChanges', async (paths) => readRecentChanges(paths, api.settings().recentChangesLimit, { git: services.git, files: services.files, paths: services.paths, log: services.log }))`

The call only reads. So it does not go through `docFiles`, and the write guard stays as it is. The existing channel patterns do not change. In `contract.ts`, place `RecentChange` beside `PluginStatusRead` and the call after `pluginStatus`. A comment on the call states that it takes real or linked paths, gives at most `recentChangesLimit` commits newest first, leaves out what git cannot read, and does not reject. The comment above `DocsChannel` says every method rejects when its handler throws. It stays true, since this handler does not throw. The comment above `docsMainPart` gains the recent changes in its list of what the part serves.

**Docs.**
- The `AGENTS.md` `git/` line gains `a log over named paths` in its list.
- The comment at the top of `process-git.ts` stays true: `log` is one run.
- The comment at the top of `manifest.ts` gains one sentence on `recentChangesLimit`.

**The fake Git.** `grep -rln commitPaths src` lists two fakes, each `satisfies Git`:
- `src/plugins/docs/main/plugin-status.test.ts`, `cleanGit`
- `src/plugins/backlog/main/start.test.ts`, `fakeGit`

Each gains `log: vi.fn<Git['log']>(async () => [])`. Task 11 calls `recentChanges` with the `path` of each leaf entry.

## Behaviour

GIVEN pages in two clones WHEN `recentChanges` runs THEN each clone is logged on its own, and the merged list is newest first and at most `recentChangesLimit` long.
GIVEN a page outside any repo WHEN `recentChanges` runs THEN the other pages' commits show.
GIVEN a clone where `git log` fails WHEN `recentChanges` runs THEN the call resolves with the other clones' commits and logs one line.
GIVEN a page reached through the symlink `~/wigley-agents` WHEN `recentChanges` runs THEN `paths` in the result are real paths.

## Tests

`src/main/git/process-git.test.ts`, following the file's existing `FakeProcesses` and `it.skipIf(!gitOnPath)` patterns.

- `log_ScriptedOutput_ParsesRecords` (`FakeProcesses`, exact args above). The stdout is built from two records: a first with subject `a | b\tc` and paths `x y.md`, `z.md`, a second with an empty subject and path `z.md`. The result equals the two `GitCommit` values. The break is a parser that reads a subject as a delimiter, or that leaves the leading `\n` on a path.
- `log_NoPaths_RunsNothing`. The result is `[]` and `processes.runs` is empty. The break is a dropped guard, which logs the whole repo.
- `log_ExitsNonZero_Rejects`. Exit 128 rejects with text containing `git log exited 128`.
- `log_RealRepo_NewestFirstAndOnlyAskedPaths` (`it.skipIf(!gitOnPath)`, `isolateGitConfig`). A repo with `a b.md`, `c.md` and `other.md`.
  - Commit 1, subject `first`, touches all three.
  - Commit 2, subject `sub | with\ttab`, touches `a b.md` and `other.md`.
  - `log(root, ['a b.md', 'c.md'], 5)` gives subjects `['sub | with\ttab', 'first']` and paths `[['a b.md'], ['a b.md', 'c.md']]`.
  - `Date.parse(at)` is a number for each.
  - `log(root, ['a b.md', 'c.md'], 1)` gives one commit.

  The break is a wrong git flag that a scripted fake cannot see.

`src/plugins/docs/main/recent-changes.test.ts`, with a fake Git that holds a `topLevel` map and a `log` map, `posixPaths`, and a `realPath` stub over a map (the memory files have no links). Built data only.

- `readRecentChanges_TwoClones_MergedNewestFirstAndCut`.
  - Limit 2. Root `/r/a` logs `{sha:'a1', at:'2026-11-05T10:00:00-06:00'}`, which is 16:00Z.
  - Root `/r/b` logs `{sha:'b1', at:'2026-11-05T15:30:00Z'}` and `{sha:'b2', at:'2026-11-05T09:00:00Z'}`.
  - The result is shas `['a1', 'b1']`. Each `git.log` call has limit 2.
  - The break is a text compare of `at`, a missing cut, or one log per all paths. Text order puts `b1` first.
- `readRecentChanges_LinkedPath_AsksRelativeAndReturnsReal`.
  - `realPath('/h/wa/AGENTS.md')` gives `/d/wa/AGENTS.md`. `topLevel('/d/wa')` gives `/d/wa`.
  - `git.log` receives `('/d/wa', ['AGENTS.md'], limit)`.
  - The result's `paths` are `['/d/wa/AGENTS.md']`.
  - A nested row: `/d/wa/wiki/Main.md` asks `wiki/Main.md`.
  - The break is a path left unresolved, or a separator from `paths`.
- `readRecentChanges_Unreadable_OtherClonesStillShow` (`it.each`). `/r/a/x.md` always logs commit `a1`. A second path `/r/b/y.md` fails per row. The result is always `['a1']`, and it never rejects. The break is one failure rejecting the whole call.

  | given | second path's failure | log lines |
  |---|---|---|
  | missing file | `realPath` rejects with `code: 'ENOENT'` | 0 |
  | outside any repo | `topLevel` gives null | 0 |
  | git cannot start | `topLevel` rejects | 1 |
  | clone with no commit | `log` rejects | 1 |

- `readRecentChanges_SameShaInTwoClones_OneRowAllPaths` (`it.each`). Roots `/r/a` and `/r/b` each log sha `s1`. The break is a row per clone, or a path lost or doubled in the merge.

  | given | `/r/a` logs `s1` with | `/r/b` logs `s1` with | result `paths` |
  |---|---|---|---|
  | different paths | `x.md` | `y.md` | `['/r/a/x.md', '/r/b/y.md']` |
  | the same path in both clones | `x.md` | `x.md` | `['/r/a/x.md', '/r/b/x.md']` |
  | one root lists a path twice | `x.md`, `x.md` | none | `['/r/a/x.md']` |

  Each row gives one row in the result.
- `readRecentChanges_NoPaths_RunsNoGit`. The result is `[]`, and `topLevel` and `log` have no calls.

`src/plugins/docs/main/start.test.ts`: `recentChanges_LimitFromSettings`. Add `recentChangesLimit: 3` to the fake's `settings` at line 176, and a `git` fake to its `services` when none is present. Invoking `recentChanges` with one path calls `git.log` with limit 3. The break is a missing handler, or a limit written in code.

A test that `recentChangesLimit` equals 10 is a change detector: leave it unwritten.

## Done when

The project compiles. The grep `grep -n 'log(root' src/contracts/git.ts` shows the method. `wigley:make`'s test gate runs the tests above. Task 14 holds every runtime check.

Commit: one commit for the group.

## Proof

Commit ed07573b · proof: diff read; every Produces present by search (GitCommit, Git.log, RecentChange, recentChanges, readRecentChanges, RecentChangesDeps, recentChangesLimit); compile checked with task 06's partial edits in the tree · concerns: a negative recentChangesLimit gives all commits minus the last row (configurer's, per plan); docs-browser design.md not checked for a settings list
