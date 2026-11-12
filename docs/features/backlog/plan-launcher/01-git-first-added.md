# 01 — Git firstAdded: the commit that first added a text to a file

Status: done
Type: Task
Rung: hard · adds `Git.firstAdded`, which 05's staleness reader consumes
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:
- modify `src/contracts/git.ts`
- modify `src/main/git/process-git.ts`
- test `src/main/git/process-git.test.ts`
- modify `src/plugins/backlog/main/start.test.ts` (its `fakeGit` satisfies `Git`)
- modify `src/plugins/docs/main/plugin-status.test.ts` (its `cleanGit` satisfies `Git`)

Consumes: `Git.log` and the adapter's private `gitOutput` and `logCommits` in `src/main/git/process-git.ts` (the tree
holds them).

Produces:
- `firstAdded(root: string, path: string, text: string): Promise<GitCommit | null>` on `Git` in
  `src/contracts/git.ts`, after `log`, with this comment: "The oldest non-merge commit whose diff changed how often
  `text` occurs in `path` (`git log -S`), which is the one that first added it; its `paths` is `[path]`. `text` is
  matched as a raw substring, newlines included, so the caller passes enough text to be unique in the file: `### Item`
  also matches a commit that added `### Item two`. Null when no commit did, and for an empty `text`, running nothing.
  Rejects when HEAD has no commit yet."
- its implementation in `createProcessGit` (`src/main/git/process-git.ts`).

Decisions:
- One run: `git -C <root> --literal-pathspecs log --no-show-signature --no-merges --reverse -S<text>
  --format=%x00%H%x00%cI%x00%s -z --name-only -- <path>`, parsed by the existing `logCommits`, returning the first
  record or null. The `-S` value is attached (`-S${text}`) so a text starting with `-` is not read as an option.
  No `--max-count`: git applies it before `--reverse`, so it would keep the newest commits, not the oldest. (plan.md
  § File Structure, `Git.firstAdded`: "the oldest non-merge commit whose diff added `text` to `path` (`git log -S`)")
- `-S` matches a commit that changed the text's count either way; the oldest match is the add, since before it the
  text did not occur. A text added, removed and added again resolves to the first add. (plan.md: "`writtenAt` from
  the commit that first added the item's title")
- `text` is a raw substring (`-S` without `--pickaxe-regex`), passed whole in one argument, so a text that ends in
  `\n` matches only whole lines that end there. The method does not add a newline or trim: what text makes the
  match unique is the caller's choice (05 owns the text it passes).
- `--no-merges` stays: it states plan.md's "non-merge" rule. It has no test because it changes no result: `git log`
  shows no diff for a merge commit without `-m` (`--diff-merges` defaults to `off`, git 2.50 `git-log(1)`), so
  `-S` never matches a merge. The commit on the side branch that added the text is the match.
- No `--follow`: a follow-ups file that moved reads as written at its move. Plan.md names one path and no rename
  handling; a moved home is rare and reads as `moved`/`fresh` from that commit on.
- Empty `text` resolves null with no run, as `log` does for empty `paths` (the contract's existing "running nothing"
  rule).
- A failed run rejects `git log exited <code>: <stderr>` through `gitOutput`, matching the contract's header rule;
  update the header comment's sentence only if it lists methods by name (it does not today: firstAdded falls under
  "Every method but …").
- Every full `Git` fake in the tree gains the member, each answering `null`:
  `firstAdded: vi.fn<Git['firstAdded']>(async () => null)` in `fakeGit` (`src/plugins/backlog/main/start.test.ts`)
  and `cleanGit` (`src/plugins/docs/main/plugin-status.test.ts`), after `log`. The other fakes need nothing:
  `Pick<Git, …>` dependencies (`recent-changes.ts`, `plan-watch.ts`, `chat-sessions.ts`, `updater.ts`,
  `plan-copies.ts`, `origin-repo-names.ts`), the `as Partial<Git> as Git` cast in
  `src/plugins/app-update/main/start.test.ts`, the two-member object in `src/plugins/docs/main/start.test.ts`, and
  the throwing proxy `notFaked<Git>('git')` in `src/shared/plugin-part-harness.test-support.ts`.

GIVEN a clone whose `a.md` gained `### Item` in commit B after commit A created the file
WHEN `firstAdded(root, 'a.md', '### Item')` runs
THEN it resolves commit B with `paths: ['a.md']`.

GIVEN `c.md` gained `### Item two` in commit C and `### Item` later in commit D
WHEN `firstAdded(root, 'c.md', '### Item')` runs
THEN it resolves C (a raw substring match); with text `'### Item\n'` it resolves D.

GIVEN no commit ever added the text, or the text is empty
WHEN `firstAdded` runs
THEN it resolves null (the empty text running no git).

Tests (all in `src/main/git/process-git.test.ts`, in `describe('createProcessGit')` beside the `log_*` tests, a
`firstAddedArgs(path, text)` helper beside `logArgs` building the pinned argument list):
- `firstAdded_ScriptedOutput_OldestRecord` — scripted output of two records (oldest first, as `--reverse` prints):
  resolves the first record's sha, date, subject and `[path]`.
- `firstAdded_ExitsZeroWithNoOutput_Null` — exit 0, empty stdout: null.
- `firstAdded_EmptyText_RunsNothing` — null and `processes.runs` empty.
- `firstAdded_ExitsNonZero_Rejects` — exit 128: rejects `git log exited 128`.
- `firstAdded_TextStartingWithDash_AttachedToS` — text `--x`: the scripted argument list holds `-S--x` (the run
  matches only that list).
- In `describe('createProcessGit over a real clone')`, `it.skipIf(!gitOnPath)`
  `firstAdded_RealRepo_FirstCommitAddingTheText`: commits, in this order, `first` (creates `a.md` and `c.md` empty
  and `b.md` holding `x\n`), `item in other file` (adds `### Item\n` to `b.md`), `add item` (adds `### Item\n` to
  `a.md`), `edit other` (changes `b.md`'s `x` line), `remove item` (drops it from `a.md`), `re-add item` (adds it
  back), `longer title` (adds `### Item two\n` to `c.md`), `short title` (adds `### Item\n` to `c.md`). Asserts:
  - `firstAdded(root, 'a.md', '### Item')` has subject `add item` and paths `['a.md']` (the oldest add, and `--
    a.md` keeps `item in other file` out);
  - `firstAdded(root, 'a.md', '### Never')` is null;
  - `firstAdded(root, 'c.md', '### Item')` has subject `longer title` (the raw-substring limit the contract
    comment states);
  - `firstAdded(root, 'c.md', '### Item\n')` has subject `short title` (a text ending in a newline matches the
    whole line only).
  Uses `isolateGitConfig()` as the other real-clone tests do.

Done when: `npm run typecheck`, `npm run lint`, and `npm test -- src/main/git src/plugins/backlog/main/start.test.ts
src/plugins/docs/main/plugin-status.test.ts` pass. No live check: 05's staleness reads it, checked in
`10-final-verification.md`.

Commit: one commit for the group — "Git.firstAdded: the oldest commit that added a text to a file, for backlog
staleness"

## Proof

Commit 2c7ae1554 · proof: diff read: firstAdded on Git and createProcessGit as specified, both full fakes updated, six tests; wave 1 typecheck + lint pass after fix 8bd73679b (octal escape) · concerns: dash test's toContain('-S--x') repeats the helper
