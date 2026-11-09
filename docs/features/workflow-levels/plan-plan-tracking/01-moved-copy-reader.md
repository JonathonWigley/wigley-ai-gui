# 01 — The moved-copy reader

Status: in progress
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     modify `src/shared/plan-copies.ts` · modify `src/plugins/backlog/main/start.ts` · test `src/shared/plan-copies.test.ts` · modify `src/plugins/workflow-large/main/plan-watch.ts` (the one `newestPlanCopy` call only) · test `src/plugins/workflow-large/main/plan-watch.test.ts` (the rows the new rule turns red) · test `src/plugins/backlog/main/start.test.ts`
Consumes:  `GitWorktree.isMain` (tree) · `isSameJson` in `src/shared/json.ts` (tree) · `readPlanCopy` (tree)
Produces:  `readonly isMainTree: boolean` on `PlanCopy` in `src/shared/plan-copies.ts`
           `export interface ReadCopy { readonly copy: PlanCopy; readonly progress: PlanProgress }` in `src/shared/plan-copies.ts`
           `export async function readMovedCopy(planDir: string, deps: PlanCopyDeps): Promise<ReadCopy | null>` in `src/shared/plan-copies.ts`
           `export async function readCopyAt(planDir: string, deps: PlanCopyDeps): Promise<ReadCopy | null>` in `src/shared/plan-copies.ts`
Decisions: the moved-copy rule replaces the newest-timestamp rule (round 2, Decided notice "Fallback") · Backlog uses it (Decided notice "Backlog")

## What changes

- `PlanCopy` gets `isMainTree`, doc comment "True for the git main tree's copy. `readCopyAt` does not look the tree
  up and sets false." `planCopies` sets it from `GitWorktree.isMain`. `copyAtPlanDir` (no clone, or no worktree list)
  sets it to `true`: the single copy is the main tree's.
- `readMovedCopy(planDir, deps)` replaces `newestPlanCopy`. Delete `newestPlanCopy`.
  1. List the copies with `planCopies`. Read each copy's progress with `readPlanCopy`. Drop a copy whose progress is
     null.
  2. When no copy is the main tree's, return the copy with the largest `changedAt`, the earlier one in `planCopies`
     order on a tie.
  3. Otherwise, collect the copies that are not the main tree's, whose progress is not `isSameJson` to the main
     tree's progress, and whose `checked` is not below the main tree's `checked`. When one or more exist, return the
     one with the largest `changedAt`, the earlier on a tie. A copy behind main is an idle worktree left at an older
     state, never the running copy: a run only ticks boxes forward.
  4. Otherwise return the main tree's copy.
  5. Return null when no copy is left.
- `readCopyAt(planDir, deps)` returns the copy at `planDir` alone with its progress, or null when `planDir` holds no
  `plan.md` file. Use the existing `copyAt(planDir, planDir, deps)` for the copy, with `isMainTree: false`, and
  `readPlanCopy` for the progress.
- Rewrite the doc comments of `PlanCopy`, `planCopies` and the two new functions to say the rule above. Remove the
  comment that warns about checkouts that rewrite modified times: the rule no longer depends on them.
- Backlog's `readPlan` calls `readMovedCopy` in place of `newestPlanCopy` plus `readPlanCopy`, and keeps every other
  line of its behaviour. Rewrite its doc comment: "the newest copy" becomes "the moved copy".
- `plan-watch.ts`'s `read` calls `readMovedCopy` in place of `newestPlanCopy` plus `readPlanCopy`, with no other
  change. Task 04 changes the watch's read rule.

GIVEN the main tree's copy with modified time 10 and a worktree copy with the same progress and modified time 50
WHEN `readMovedCopy` runs THEN it returns the main tree's copy.
GIVEN the main tree's copy, a worktree copy with one more ticked box at time 20, and a fresh worktree copy equal to
main's at time 50 WHEN `readMovedCopy` runs THEN it returns the time-20 copy.
GIVEN two worktree copies that each differ from main's, at times 20 and 30 WHEN `readMovedCopy` runs THEN it returns
the time-30 copy.
GIVEN no main-tree copy and two worktree copies at times 20 and 30 WHEN `readMovedCopy` runs THEN it returns the
time-30 copy.
GIVEN the main tree's copy with 2 ticked boxes and a worktree copy with 1 ticked box at time 50 WHEN `readMovedCopy`
runs THEN it returns the main tree's copy.
GIVEN two worktree copies that each differ from main's, both at time 30 WHEN `readMovedCopy` runs THEN it returns the
one earlier in `planCopies` order.
GIVEN the main tree's copy and a worktree copy whose `plan.md` reads as null progress WHEN `readMovedCopy` runs THEN it
returns the main tree's copy.
GIVEN no copy of the plan anywhere WHEN `readMovedCopy` runs THEN it returns null.

Tests:     one `it.each` table `readMovedCopy_PicksTheMovedCopy` in `plan-copies.test.ts` with the eight rows above
           (expected: the returned copy's `checkout`, or null). Replace every existing `newestPlanCopy` test with rows
           of this table or delete it when a row already pins its rule. The `planCopies` table's expected copies and
           the `readPlanCopy` `COPY` literal gain `isMainTree`: true for the main tree, false for a linked worktree,
           true for the outside-a-clone and worktrees-rejects rows.
           Existing tests that encode the newest-timestamp rule move to the moved-copy rule, expected values
           recomputed by it, in this task: in `plan-watch.test.ts`, `follow_PlanInTwoCheckouts_SignalsTheNewestCopy`
           (renamed `follow_PlanInTwoCheckouts_SignalsTheMovedCopy`), `follow_OneCopyDeleted_PlanGoneOnlyWhenNoneLeft`
           and the four `listAgain_WorktreeAdded_WatchesTheNewCopy` rows; in `backlog/main/start.test.ts`,
           `load_PlanProgress_FromTheNewestCopy` (renamed `load_PlanProgress_FromTheMovedCopy`) and its rows, the
           "equal-time worktree copy" row among them.
           `readCopyAt_ReadsThatFolderAlone`: a table with two rows — a folder with `plan.md` returns that folder's
           progress although a newer differing copy exists elsewhere; a folder with no `plan.md` returns null.
Done when: `npm test -- src/shared/plan-copies.test.ts src/plugins/backlog src/plugins/workflow-large/main/plan-watch.test.ts`
           passes; `npm run lint` passes.
Commit:    one commit for the group

## Proof

