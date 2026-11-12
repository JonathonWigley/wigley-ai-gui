# 01 — Git firstAdded: the commit that first added a text to a file

Status: not started
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
  `text` occurs in `path` (`git log -S`), which is the one that first added it; its `paths` is `[path]`. Null when
  no commit did, and for an empty `text`, running nothing. Rejects when HEAD has no commit yet."
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
  `firstAdded_RealRepo_FirstCommitAddingTheText`: commits `first` (creates `a.md` empty and `b.md`), `add item`
  (adds `### Item\n` to `a.md`), `edit other` (changes `b.md`), `remove item` (drops it from `a.md`), `re-add item`
  (adds it back). Asserts `firstAdded(root, 'a.md', '### Item')` has subject `add item` and paths `['a.md']`, and
  `firstAdded(root, 'a.md', '### Never')` is null. Uses `isolateGitConfig()` as the other real-clone tests do.

Done when: `npm run typecheck`, `npm run lint`, and `npm test -- src/main/git src/plugins/backlog/main/start.test.ts
src/plugins/docs/main/plugin-status.test.ts` pass. No live check: 05's staleness reads it, checked in
`10-final-verification.md`.

Commit: one commit for the group — "Git.firstAdded: the oldest commit that added a text to a file, for backlog
staleness"

## Proof
