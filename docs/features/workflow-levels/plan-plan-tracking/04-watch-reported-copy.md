# 04 — The plan watch reads the reported copy

Status: done
Type: Task
Wave: 2 · Depends on: 01, 02
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/workflow-large/main/plan-watch.ts` · test `src/plugins/workflow-large/main/plan-watch.test.ts` · modify `src/plugins/workflow-large/main/start.ts`
Consumes:  `readMovedCopy`, `readCopyAt`, `ReadCopy` ← 01 · `LargeState.planReported` ← 02
Produces:  `follow(sessionId: string, planDir: string | null, reported: boolean): void` on `PlanWatch` in `src/plugins/workflow-large/main/plan-watch.ts`
Decisions: a reported folder is read alone; when it holds no `plan.md`, the moved copy is read (Decided notice "A
           reported folder is read alone")

## What changes

- `Watched` gets `reported: boolean` and `mainCopyDir: string | null`. `open(sessionId, planDir, reported)` sets
  both (`mainCopyDir` starts null). `follow` compares `planDir` and `reported`: a follow with the same folder and the
  same flag, on a watch that is not `gone`, does nothing. A follow that changes only the flag updates
  `entry.reported` and reads again, and does not reopen the watches; during `opening` that read is allowed, and
  `open`'s own read at its end settles it. A follow on a `gone` watch reopens it, flag included, as a folder change
  does.
- Each time the watch lists the copies (`open` and `check`), it keeps the main tree's copy folder (the copy with
  `isMainTree`) in `entry.mainCopyDir` when the list holds one.
- `read`: when `entry.reported` is true, it calls `readCopyAt(entry.planDir, copyDeps)`. When that returns null, it
  calls `readMovedCopy(entry.mainCopyDir ?? entry.planDir, copyDeps)`: a reported worktree folder removed after its
  merge leaves `planCopies` no clone to list from, and the remembered main copy keeps the run's checklist. When
  `entry.reported` is false, it calls `readMovedCopy(entry.planDir, copyDeps)`. The `planGone` rule stays: only when
  no copy is left and the folder is gone. Accepted: after an app restart with the reported folder already removed,
  `mainCopyDir` is unknown and the watch signals `planGone`.
- Rename the local `readNewest` to `readCopy`, and rewrite the file's header comment and the `PlanWatch` doc comment
  for the new rule: neither says "newest" afterwards.
- The copy watches stay as they are: every copy's folder is watched, the reported one among them.
- `start.ts`:
  - `followPlan` calls `planWatch.follow(sessionId, planDir, planReported)` when the folder or the flag changed
    between `before` and `after`, and on a `fileWritten` of a plan file, as today.
  - `follow(flow)` and `stopSession` pass the flag (`stopSession` passes `null, false`).

GIVEN a reported folder `/w/p/plan-a` and a main-tree copy `/r/p/plan-a` that differs and is newer WHEN the watch
reads THEN it signals the `/w` copy's progress.
GIVEN a reported folder whose `plan.md` was deleted while the main-tree copy remains WHEN the watch reads THEN it
signals the main-tree copy's progress and no `planGone`.
GIVEN a reported worktree folder `/w/p/plan-a` followed and read once WHEN the whole `/w` folder is removed while
`/r/p/plan-a` remains THEN it signals the `/r` copy's progress and no `planGone`.
GIVEN an unreported follow of `/r/p/plan-a` WHEN the same folder is followed with `reported: true` THEN the watch reads
again without reopening its watches.

Tests:     `follow_Reported_ReadsThatCopyAlone` — an `it.each` table with the first three rows above, each with
           `cloneGit(['/r', '/w'])` and `follow('s1', <the /w folder>, true)`. Row 1 gives the `/r` copy a different
           progress at a later time than the `/w` copy. In the memory files a folder exists only through its files,
           so row 2 keeps a task document (`01-a.md`) in the `/w` plan folder after deleting its `plan.md`; row 3
           deletes every file under `/w`.
           `follow_ReportedFlagChanges_ReadsAgainWithoutReopening` — the fourth row; assert the files fake's
           open-watch count stays the same and a new `planChanged` arrives.
           The compiler names every two-argument `follow` call; each passes `false`.
           The `start.ts` wiring of the flag has no unit seam; task 05's `reported plan` self-test group proves it
           (a report file reaching the fold and the watch reading the reported copy).
Done when: `npm test -- src/plugins/workflow-large` passes; `npm run lint` passes.
Commit:    one commit for the group

## Proof

Commit 92e00206 · proof: diff read; typecheck clean; worker ran workflow-large tests (475) and lint · concerns: all-null read signals planGone only when planDir is gone; a removed reported folder whose remembered main copy also lost plan.md signals planGone though the main folder exists
