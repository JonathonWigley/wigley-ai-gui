# 04 — The plan watch reads the reported copy

Status: not started
Type: Task
Wave: 2 · Depends on: 01, 02
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/workflow-large/main/plan-watch.ts` · test `src/plugins/workflow-large/main/plan-watch.test.ts` · modify `src/plugins/workflow-large/main/start.ts`
Consumes:  `readMovedCopy`, `readCopyAt`, `ReadCopy` ← 01 · `LargeState.planReported` ← 02
Produces:  `follow(sessionId: string, planDir: string | null, reported: boolean): void` on `PlanWatch` in `src/plugins/workflow-large/main/plan-watch.ts`
Decisions: a reported folder is read alone; when it holds no `plan.md`, the moved copy is read (Decided notice "A
           reported folder is read alone")

## What changes

- `Watched` gets `reported: boolean`. `follow` compares `planDir` and `reported`: a follow with the same folder and
  the same flag, on a watch that is not `gone`, does nothing. A follow that changes only the flag updates
  `entry.reported` and reads again, and does not reopen the watches.
- `read`: when `entry.reported` is true, it calls `readCopyAt(entry.planDir, copyDeps)`. When that returns null, or
  when `entry.reported` is false, it calls `readMovedCopy(entry.planDir, copyDeps)`. The `planGone` rule stays: only
  when no copy is left and the folder is gone.
- The copy watches stay as they are: every copy's folder is watched, the reported one among them.
- Rewrite the `PlanWatch` doc comment for the new rule.
- `start.ts`:
  - `followPlan` calls `planWatch.follow(sessionId, planDir, planReported)` when the folder or the flag changed
    between `before` and `after`, and on a `fileWritten` of a plan file, as today.
  - `follow(flow)` and `stopSession` pass the flag (`stopSession` passes `null, false`).

GIVEN a reported folder `/w/p/plan-a` and a main-tree copy `/r/p/plan-a` that differs and is newer WHEN the watch
reads THEN it signals the `/w` copy's progress.
GIVEN a reported folder whose `plan.md` was deleted while the main-tree copy remains WHEN the watch reads THEN it
signals the main-tree copy's progress and no `planGone`.
GIVEN an unreported follow of `/r/p/plan-a` WHEN the same folder is followed with `reported: true` THEN the watch reads
again without reopening its watches.

Tests:     `follow_Reported_ReadsThatCopyAlone` — an `it.each` table with the first two rows above.
           `follow_ReportedFlagChanges_ReadsAgainWithoutReopening` — the third row; assert the files fake's open-watch
           count stays the same and a new `planChanged` arrives.
           Change the existing `follow_PlanInTwoCheckouts_SignalsTheNewestCopy` to the moved-copy rule, or delete it
           when task 01's table already pins the rule.
Done when: `npm test -- src/plugins/workflow-large` passes; `npm run lint` passes.
Commit:    one commit for the group

## Proof

