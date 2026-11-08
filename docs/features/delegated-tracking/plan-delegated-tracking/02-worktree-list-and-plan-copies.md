# 02 — Worktree list and plan copies

Status: in progress
Type: Batch
Wave: 2 · Depends on: 01
Plan: [plan.md](plan.md)

Read first: `docs/features/workflow/design.md` § Heavy's stages (the paragraph on the newest copy),
`docs/features/backlog/design.md` § Plans and features and § Git, and the plan's Mandatory Reads, the "A path" bullet
included.

Two items: the `Git` members, then the copy finder that uses them.

Files:     modify `src/contracts/git.ts` · modify `src/main/git/process-git.ts` · test `src/main/git/process-git.test.ts` ·
           test `src/plugins/backlog/main/start.test.ts` · test `src/plugins/docs/main/plugin-status.test.ts` ·
           create `src/shared/plan-copies.ts` · test `src/shared/plan-copies.test.ts`
Consumes:  `readPlanProgress(planText: string, taskTexts: ReadonlyMap<string, string>): PlanProgress` ← 01
           `readIfPresent`, `isMissingFile` in `src/contracts/files.ts` (the tree holds them)
           `createMemoryFiles(clock?)` in `src/shared/memory-files.ts` (the tree holds it)
Produces:  in `src/contracts/git.ts`:
           `export interface GitWorktree { readonly path: string; readonly branch: string | null; readonly isMain: boolean }`
           `Git.worktrees(root: string): Promise<GitWorktree[]>;`
           `Git.commonDir(root: string): Promise<string>;`
           in `src/shared/plan-copies.ts`:
           `export interface PlanCopy { readonly planDir: string; readonly checkout: string; readonly changedAt: number }`
           `export interface PlanCopyDeps { readonly git: Pick<Git, 'topLevel' | 'worktrees'>; readonly files: Pick<Files, 'read' | 'modified' | 'list' | 'realPath' | 'stat'>; readonly paths: Paths }`
           `export function repoTop(planDir: string, deps: PlanCopyDeps): Promise<string | null>;` — steps 1 and 2
           below: `git.topLevel` of `planDir`'s nearest existing folder
           `export function planCopies(planDir: string, deps: PlanCopyDeps): Promise<PlanCopy[]>;`
           `export function newestPlanCopy(planDir: string, deps: PlanCopyDeps): Promise<PlanCopy | null>;`
           `export function readPlanCopy(copy: PlanCopy, deps: PlanCopyDeps): Promise<PlanProgress | null>;`

## Item 1 — `Git.worktrees` and `Git.commonDir`

Decisions:

- `worktrees(root)` runs `git -C <root> worktree list --porcelain` through `gitOutput(processes, 'worktree', …)`, so
  a failed run rejects `git worktree exited <code>: <stderr>`, as the contract comment says for the other members.
- Parse the output: split on `\n`. An empty line ends a record. No `-z`: it needs git 2.36, and the app states no
  git minimum; a path that holds a newline is not supported. Each record's fields are `<label>` or
  `<label> <value>`. Take:
  - `worktree <path>` → `path`, through `deps.paths.normalize` (as `topLevel` does)
  - `branch <ref>` → `branch`, with a leading `refs/heads/` removed
  - no `branch` field (a `detached` or `bare` record) → `branch: null`
  - every other label (`HEAD`, `detached`, `bare`, `locked`, `prunable`) → ignored
  - `isMain` is true for the first record only. Git lists the main tree first.
  Keep git's order. A record with no `worktree` field is skipped.
- `commonDir(root)` runs `git -C <root> rev-parse --git-common-dir` through `gitOutput(processes, 'rev-parse', …)`. It
  returns `fullGitPath(root, stdout.trim(), deps.paths)`: git prints the path relative to `root` unless it is absolute.
- Update the `Git` contract comment: the list of members that do not reject on a failed run stays as it is, so both new
  members reject on a failed run. Write a one-line comment on each new member that says what it returns, as the other
  members have.
- Update the top comment of `createProcessGit` only if it counts runs: each new member is one run.
- The two test fakes that implement `Git` gain the members:
  - `src/plugins/backlog/main/start.test.ts` `fakeGit()`:
    `worktrees: vi.fn<Git['worktrees']>(async () => [{ path: CLONE, branch: 'main', isMain: true }])` and
    `commonDir: vi.fn<Git['commonDir']>(async () => \`${CLONE}/.git\`)`.
  - `src/plugins/docs/main/plugin-status.test.ts`: the same two members, with `ROOT` in place of `CLONE`.

GIVEN `git worktree list --porcelain` prints a main tree on `main`, a linked tree on `feature/x` and a detached tree
WHEN `worktrees` runs THEN it returns three entries in that order, `isMain` true only on the first, branches `'main'`,
`'feature/x'` and null.

Tests (`src/main/git/process-git.test.ts`):

- In `describe('createProcessGit')`, one `it.each`
  `worktrees_PorcelainOutput_MainFirstWithBranches ($name)` over a scripted `git('worktree', 'list', '--porcelain')`:
  - `main, a branch and a detached tree` — output
    `worktree /Users/u/dev/m\nHEAD <SHA_A>\nbranch refs/heads/main\n\nworktree /Users/u/dev/.worktrees/m-x/\nHEAD <SHA_B>\nbranch refs/heads/feature/x\n\nworktree /Users/u/dev/m-d\nHEAD <SHA_A>\ndetached\n\n`
    → `[{ path: '/Users/u/dev/m', branch: 'main', isMain: true }, { path: '/Users/u/dev/.worktrees/m-x', branch: 'feature/x', isMain: false }, { path: '/Users/u/dev/m-d', branch: null, isMain: false }]`
    (the trailing `/` is folded by `normalize`)
  - `a bare main and a locked tree` — `worktree /Users/u/dev/m.git\nbare\n\nworktree /Users/u/dev/m-l\nHEAD <SHA_A>\nbranch refs/heads/l\nlocked\n\n`
    → `[{ path: '/Users/u/dev/m.git', branch: null, isMain: true }, { path: '/Users/u/dev/m-l', branch: 'l', isMain: false }]`
  Catches a parser that splits records wrong, keeps `refs/heads/`, or loses the main-first order.
- `worktrees_ExitsNonZero_RejectsNamingTheRun` — exit 128 with stderr `fatal: not a git repository` rejects
  `git worktree exited 128: fatal: not a git repository`.
- One `it.each` `commonDir_PrintedPath_FullPath ($name)` over a scripted `git('rev-parse', '--git-common-dir')`:
  `.git\n` → `/Users/u/dev/m/.git`; `/Users/u/dev/m/.git\n` → `/Users/u/dev/m/.git`;
  `../m/.git\n` → `/Users/u/dev/m/.git`. Catches a path left relative.
- In `describe('createProcessGit over a real clone')`, one `it.skipIf(!gitOnPath)`
  `worktreesAndCommonDir_MainCloneAndWorktreeAdded_MainFirstAndOneCommonDir`. Build the fixture of
  `isLinkedWorktree_MainCloneAndWorktreeAdded_OnlyTheWorktree` (a `main` clone with one commit and
  `worktree add --quiet linked`). Assert:
  - `(await adapter.worktrees(main)).map((tree) => [realpathSync(tree.path), tree.isMain])` equals
    `[[realpathSync(main), true], [realpathSync(linked), false]]`. The temp folder on macOS sits behind a symlink
    (`/var` → `/private/var`), so compare real paths.
  - `realpathSync(await adapter.commonDir(main))` and `realpathSync(await adapter.commonDir(linked))` both equal
    `realpathSync(path.join(main, '.git'))`.
  Catches a format the scripted rows do not match, as a real git prints it.

## Item 2 — `src/shared/plan-copies.ts`

A plan folder has a copy in each checkout of its repo: the same repo-relative folder in the main tree and in each git
worktree. Backlog (07) and Heavy (06) read the newest copy.

Decisions:

- `planCopies(planDir, deps)`:
  1. Find `anchor`: the nearest folder at or above `planDir` that `files.stat` reports as a folder (walk up with
     `paths.parent`; a root is its own parent, so stop there). The main tree's copy may be deleted while a worktree's
     copy stays, and `git -C` fails in a missing folder.
  2. `top = await git.topLevel(anchor)`. When `top` is null, the plan is outside a git clone: go to step 6.
  3. `rest` = the segments of `planDir` below `anchor` (`paths.segmentsBelow(planDir, anchor)`).
     `segments = paths.segmentsBelow(paths.join(await files.realPath(anchor), ...rest), await files.realPath(top))`.
     Both sides go through `realPath`, so a symlinked spelling of the home still matches (AGENTS.md "A path").
     When `segments` is null, go to step 6.
  4. For each entry of `await git.worktrees(top)`, in git's order: `copyDir = paths.join(tree.path, ...segments)`. The
     copy exists when `files.stat(paths.join(copyDir, 'plan.md'))` is not null and not a folder. Its `checkout` is
     `tree.path`.
  5. Return the copies that exist, in git's order (the main tree first).
  6. Outside a clone: return `[{ planDir, checkout: planDir, changedAt }]` when `planDir/plan.md` exists as in step 4,
     else `[]`.
- `changedAt` is the largest `files.modified` of the copy's `plan.md` and of each task document in the copy folder. A
  task document is an entry of `files.list(copyDir)` (not recursive) with `kind: 'file'` whose path matches
  `/^\d{2}-.+\.md$/`. A file that `modified` rejects for with `isMissingFile` (deleted between the list and the read) is
  left out. When `plan.md` itself is missing at that read, the whole copy is left out, as for a failed step-4 stat.
  Any other rejection rejects `planCopies`. So `changedAt` always comes from at least the copy's `plan.md`.
- When `git.worktrees` rejects (a lock, a "dubious ownership" refusal, an old git), `planCopies` goes to step 6 and
  returns the named copy alone, so a plan that reads today still reads. `planCopies` rejects on a `files` failure
  other than a missing file. The caller logs it (06 and 07 say how).
- `repoTop(planDir, deps)` holds steps 1 and 2, and `planCopies` calls it, so the anchor walk lives once. Heavy (06)
  calls it to find the clone whose git folder it watches.
- `newestPlanCopy(planDir, deps)`: the first copy of `planCopies` with the largest `changedAt`; null when there is no
  copy. So a tie goes to the main tree.
- `readPlanCopy(copy, deps)`:
  1. `planText = await readIfPresent(files, paths.join(copy.planDir, 'plan.md'))`. Return null when it is null.
  2. Read the task lines' files: `readPlanProgress(planText, new Map())` gives each line's `file`. For each non-null
     `file`, `readIfPresent(files, paths.join(copy.planDir, file))`; a missing file is left out of the map.
  3. Return `readPlanProgress(planText, taskTexts)`.
- The module imports only `src/contracts` and `src/shared` and has no `node:` import. All path work goes through
  `deps.paths` (plan.md § Boundary rules).

Approach: `readPlanCopy` and its test import 01's `readPlanProgress(planText, taskTexts)` from
`src/shared/plan-progress.ts`, which 01 lands in the wave before this one. Do not write a local copy of the reader.

GIVEN a plan folder at `docs/features/f/plan-a` in a main tree `/r` and a worktree `/w`, both holding `plan.md`, and
`/w`'s copy changed last WHEN `newestPlanCopy('/r/docs/features/f/plan-a', deps)` runs THEN it returns
`{ planDir: '/w/docs/features/f/plan-a', checkout: '/w', changedAt: <that time> }`.

GIVEN the same folder with equal `changedAt` in both trees WHEN `newestPlanCopy` runs THEN it returns the `/r` copy.

Tests (`src/shared/plan-copies.test.ts`), over `createMemoryFiles(clock)` with a clock the test sets before each write,
`posixPaths`, and a fake `git` of `{ topLevel, worktrees }` scripted by the row:

- One `it.each` `planCopies_PlanFolder_EachCheckoutThatHoldsPlanMd ($name)`, each row giving the files written (path,
  time), the fake git's answers, the `planDir` asked and the full expected list:
  - `main and two worktrees, one without the plan` — `/r` and `/w1` hold the plan, `/w2` does not → two copies, `/r`
    first, each `changedAt` its newest file
  - `asked from a worktree's copy` — `planDir` under `/w1` → the same two copies, `/r` first
  - `the main copy deleted` — only `/w1` holds the plan; `planDir` under `/r` is missing, so `topLevel` must be asked of
    `/r/docs/features/f` → the `/w1` copy alone. The row writes `/r/docs/features/f/checklist.md`, so the folder
    exists in the memory files. The fake `topLevel` returns `/r` for a folder that `files.stat` reports as a folder
    under `/r`, and null otherwise; the row asserts it was asked of `/r/docs/features/f`.
  - `a symlinked home spelling` — a `files` wrapper that maps the `/link` prefix to `/r/docs/features` in every
    member (`read`, `modified`, `list`, `stat`, `realPath`); the fake `topLevel` returns `/r` for a folder under either
    spelling; `planDir` is `/link/f/plan-a` → the copies found as for `/r`, each `planDir` and `checkout` in the real
    `/r` and `/w1` spelling
  - `outside a clone` — `topLevel` null → `[{ planDir, checkout: planDir, changedAt }]`
  - `outside a clone with no plan.md` → `[]`
  Catches a finder that uses the asked spelling for the relative path, skips the missing-main case, or keeps a
  checkout with no `plan.md`.
- One `it.each` `planCopies_ChangedAt_NewestOfPlanAndTaskDocuments ($name)`: one copy, rows:
  - `plan.md newest` (`plan.md` at 30, `01-a.md` at 20) → 30
  - `a task document newest` (`plan.md` at 10, `02-b.md` at 40) → 40
  - `a note is not a task document` (`plan.md` at 10, `notes.md` at 50, `1-a.md` at 60) → 10
  - `a file in a subfolder is not read` (`plan.md` at 10, `sub/03-c.md` at 70) → 10
  Catches a time taken from every file in the folder, or from the plan alone.
- One `it.each` `newestPlanCopy_Copies_LargestChangedAtTiesToMain ($name)`: `a worktree newer` → the worktree copy;
  `equal times` → the main copy; `no copy` → null.
- One `it.each` `readPlanCopy_PlanAndLinkedTaskDocuments ($name)`:
  - `statuses from the copy's task documents` — the copy's `plan.md` links `01-a.md` (`Status: done`) and `02-b.md`
    (`Status: in progress`) and `03-c.md` (missing) → the full `PlanProgress`, statuses `'done'`, `'in progress'`, null
  - `plan.md missing` → null
  Catches a reader that reads the asked folder's task documents in place of the copy's.
- `planCopies_WorktreesRejects_ReturnsTheNamedCopy` — the fake `worktrees` rejects; `planCopies` returns the one copy
  of `planDir` (`checkout: planDir`). Catches a failed list that loses a plan Heavy and Backlog read today.
- `planCopies_FilesFails_Rejects` — the files' `list` rejects with an error that is not a missing file; `planCopies`
  rejects with it.

Done when: `npm test` passes and `npm run lint` passes. The test gate runs the tests above.
Commit:    one commit for the group

## Proof
