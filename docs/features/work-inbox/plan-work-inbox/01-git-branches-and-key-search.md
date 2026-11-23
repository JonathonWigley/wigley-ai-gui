# 01 — Git branch listing and key search

Status: in progress
Type: Task
Rung: hard · adds `Git.branches` and `Git.commitsMatching`, which 07 consumes
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     modify `src/contracts/git.ts` · modify `src/main/git/process-git.ts` · test `src/main/git/process-git.test.ts` · test `src/plugins/backlog/main/start.test.ts`
Consumes:  `ProcessRunner.run` and the existing `gitOutput`, `nulFields` and `logCommits` helpers in `process-git.ts`
Produces:
- `export interface GitBranch { name: string; at: string; isRemote: boolean }` in `src/contracts/git.ts`
- `branches(root: string): Promise<GitBranch[]>` on `Git` in `src/contracts/git.ts`, implemented in `createProcessGit` in `src/main/git/process-git.ts`
- `commitsMatching(root: string, pattern: string, since: string | null): Promise<GitCommit[]>` on `Git` in `src/contracts/git.ts`, implemented in `createProcessGit`

One other file implements the whole of `Git`: `fakeGit()` in `src/plugins/backlog/main/start.test.ts` is a full literal
ending `} satisfies Git;`, one `vi.fn<Git['<member>']>` per member. Add
`branches: vi.fn<Git['branches']>(async () => [])` and
`commitsMatching: vi.fn<Git['commitsMatching']>(async () => [])` after its `firstAdded`. Every other fake in the tree
is a `Partial<Git>` cast, an `as never` or `as unknown as Git` object, a partial object (`workflow-large/main/plan-watch.test.ts`,
`app-update/main/start.test.ts`), or `notFaked<Git>` in `src/shared/plugin-part-harness.test-support.ts`, which is a
proxy, and needs no edit.

## Decisions

- **`branches`** runs once, through `gitOutput(processes, 'for-each-ref', …)`, so a failed run rejects
  `git for-each-ref exited <code>: <stderr>` as the interface's header comment says. Its args are pinned:

  ```
  -C <root> for-each-ref --sort=-committerdate
    --format=%(refname)%00%(symref)%00%(committerdate:iso-strict)
    refs/heads refs/remotes
  ```

  - Each output line is one ref. It splits on `\0` into the full ref name, the symref target and the date. Blank lines
    are skipped.
  - A line whose symref field is not empty is skipped. That drops `refs/remotes/<remote>/HEAD`, which only points at
    another branch.
  - `refs/heads/<x>` gives `{ name: '<x>', isRemote: false }`. `refs/remotes/<remote>/<x>` gives
    `{ name: '<remote>/<x>', isRemote: true }`. A remote branch keeps its remote prefix so a local branch and its
    tracking branch stay two records. Detection reads the key from either.
  - `at` is the tip's committer date in strict ISO 8601, the same format as `GitCommit.at` (`%cI`).
  - The result is ordered newest tip first, by `--sort=-committerdate`.
  - Contract comment: "Every local branch and remote-tracking branch of the clone at `root`, newest tip first; a
    remote's symbolic `HEAD` is left out. `name` has no `refs/heads/`, and a remote branch keeps its remote
    (`origin/x`)."
- **`commitsMatching`** runs once, through `gitOutput(processes, 'log', …)`, so a failed run rejects
  `git log exited <code>: <stderr>`. An empty `pattern` returns `[]` and runs nothing, as `firstAdded` does for an
  empty text. Its args are pinned in this order:

  ```
  -C <root> log --exclude=refs/stash --all --no-show-signature
    --regexp-ignore-case --extended-regexp --grep=<pattern>
    [--since=<since>]                        (only when since is not null)
    --format=%x00%H%x00%cI%x00%s -z
  ```

  - **Every ref.** `--all` covers every branch, remote-tracking branch and tag, plus HEAD. A detached HEAD's commits
    count too. `--exclude=refs/stash` sits before `--all`, which keeps stash commits out: their `WIP on <branch>`
    message would match a key in the branch name and read as a commit for it.
  - **Subject and body.** `--grep` matches the whole commit message, subject and body both. It is case-insensitive
    (`--regexp-ignore-case`) and an extended regex (`--extended-regexp`). The pattern is attached (`--grep=<pattern>`),
    so a pattern that starts with `-` is not read as an option.
  - **Merges are included.** There is no `--no-merges`. A merge commit is often the only one whose message carries the
    key, as in `Merge pull request #12 from x/PROJ-7-…` or a squash body.
  - **`since`** is passed as `--since=<since>` unchanged. It is the ISO time detection hands over, the card's last move.
    git reads ISO 8601. `null` passes no `--since` and searches the whole history.
  - There is no `--name-only`. `paths` is `[]` for every record, because the search was asked for no paths. The
    contract comment says so.
  - The output goes through the existing `logCommits`. Without `--name-only`, `-z` separates commits with one NUL, and
    the next record's own leading `%x00` follows it. The empty field after a subject ends that record's (empty) path
    list and starts the next record, so the parser needs no change. The real-clone test proves this.
  - There is no limit: `since` bounds the search. Order is git log's default, newest first.
  - Contract comment: "The commits on any ref of the clone at `root` but the stash, merges included, whose message
    (subject or body) matches `pattern`, a case-insensitive extended regular expression; committed after `since` (ISO)
    when it is not null. Each has `paths` `[]`. `[]` for an empty `pattern`, running nothing."
- **Regex portability, for 07:** git hands `--extended-regexp` to the platform's regex library. `\b` and `\<` are not
  portable to macOS's libc. A whole-key match is written `(^|[^A-Za-z0-9])KEY([^0-9]|$)`. This task builds no pattern.
  It only passes the pattern through.
- The header comment of `Git` already says every method but the listed ones rejects on a failed run. The two new
  methods join that rule unchanged.

GIVEN a for-each-ref output with a local branch, a remote branch and `origin/HEAD` WHEN `branches` runs THEN it returns the two branches with their names, dates and `isRemote`, and drops the symbolic HEAD
GIVEN for-each-ref exits 128 WHEN `branches` runs THEN it rejects `git for-each-ref exited 128`
GIVEN a pattern and a since WHEN `commitsMatching` runs THEN it runs the pinned args with `--since=<since>` and parses each record with `paths` `[]`
GIVEN since null WHEN `commitsMatching` runs THEN the args carry no `--since`
GIVEN an empty pattern WHEN `commitsMatching` runs THEN it returns `[]` and records no run
GIVEN a real clone whose merge commit carries `proj-7` only in its body WHEN `commitsMatching(root, 'PROJ-7', null)` runs THEN it returns that merge commit and no other
GIVEN a real clone holding a stash made on branch `proj-7-x` WHEN `commitsMatching(root, 'PROJ-7', null)` runs THEN no stash commit is returned
GIVEN a real clone with a remote-tracking branch and a symbolic `origin/HEAD` WHEN `branches` runs THEN the remote branch is returned with `isRemote: true` and no `origin/HEAD` record appears

## Tests

All tests go in `src/main/git/process-git.test.ts`. Scripted tests use `FakeProcesses` in the `createProcessGit`
describe, and real-clone tests go in the `createProcessGit over a real clone` describe. Add a `branchesArgs()` helper
and a `matchingArgs(pattern, since)` helper beside `logArgs`.

- `branches_ForEachRefOutput_LocalAndRemoteWithoutSymbolicHead`: output
  `refs/heads/main\0\0<newer>\nrefs/remotes/origin/PROJ-7-x\0\0<older>\nrefs/remotes/origin/HEAD\0refs/remotes/origin/main\0<older>\n`
  returns `[{ name: 'main', at: <newer>, isRemote: false }, { name: 'origin/PROJ-7-x', at: <older>, isRemote: true }]`.
- `branches_ExitsNonZero_RejectsNamingTheRun`: exit 128 rejects `git for-each-ref exited 128`.
- `commitsMatching_ScriptedOutput_ParsesRecordsWithNoPaths`: pattern `PROJ-7`, since `2026-11-01T00:00:00Z`, output
  `\0<SHA_A>\0<newer>\0Merge PROJ-7\0\0<SHA_B>\0<older>\0fix\0` gives two commits, each with `paths: []`, in output
  order.
- `commitsMatching_NullSince_NoSinceArg`: scripted on the args without `--since`. It resolves and does not hit the
  fake's "no result scripted" rejection.
- `commitsMatching_EmptyPattern_RunsNothing`: returns `[]`, and `test.processes.runs` is `[]`.
- `commitsMatching_ExitsNonZero_Rejects`: exit 128 rejects `git log exited 128`.
- `commitsMatching_RealClone_MergeBodyMatchesCaseInsensitively` (`it.skipIf(!gitOnPath)`, with `isolateGitConfig()`):
  1. On `main`, commit `first`. Branch `side`, commit `side work`. Back on `main`, commit `main work`.
  2. Run `merge --no-ff side -m 'Merge side' -m 'Closes proj-7'`.
  3. `commitsMatching(root, 'PROJ-7', null)` returns exactly one commit. Its sha is `rev-parse HEAD`, its subject
     `Merge side`, its `paths` `[]`.
  4. `commitsMatching(root, 'PROJ-7', new Date(Date.now() + 86_400_000).toISOString())` (a day ahead, so after the
     merge whatever the clock) returns `[]`.
- `commitsMatching_RealClone_StashLeftOut` (`it.skipIf(!gitOnPath)`, with `isolateGitConfig()`):
  1. On `main`, write and commit a tracked file `a.txt` with message `first`.
  2. Branch `proj-7-x`, change `a.txt` without committing, and run `git stash push`. git names the stash
     `WIP on proj-7-x: …`. An empty-commit clone has nothing to stash, so the test writes a file.
  3. `commitsMatching(root, 'PROJ-7', null)` returns `[]`. Without `--exclude=refs/stash` it would return the stash's
     two commits.
- `branches_RealClone_LocalAndRemoteWithDates` (`it.skipIf(!gitOnPath)`): in the same kind of clone as the merge test,
  run `git update-ref refs/remotes/origin/side side` and
  `git symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/side`. `branches(root)` holds `main` and `side` with
  `isRemote: false`, and `origin/side` with `isRemote: true`, each with an `at` that `Date.parse` reads, and no record
  named `origin/HEAD`. It asserts the set of names, not their order: commits made in one second tie on committer date.

Done when: `npm run typecheck` and `npm run lint` pass, and the test gate runs the tests above. Runtime checks defer to
[14 — Final verification](14-final-verification.md).
Commit:    one commit for the group

## Proof

