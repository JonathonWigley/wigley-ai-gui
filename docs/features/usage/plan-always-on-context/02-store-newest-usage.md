# 02 — Usage store keeps the newest event

Status: not started
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/usage/main/usage-store.ts` · test `src/plugins/usage/main/usage-store.test.ts`
Consumes:  `withSessionUsage` in `usage-store.ts` (tree)
Produces:  `withSessionUsage` (same signature) ignoring a `usage` older than the kept one
Decisions:
- `withSessionUsage`: when the known entry holds a usage and the incoming non-null `usage.at` is older than it,
  the usage is kept and only `profileDir` updates (the same-state return when that changes nothing too). An equal
  `at` replaces. The doc comment says so (design doc, `docs/features/usage/design.md` § The usage plugin).
GIVEN a session holding a usage at t=2000 WHEN a usage at t=1000 arrives THEN the store keeps the t=2000 usage and returns the same state
Tests:     add rows to the existing `session usage` table in `usage-store.test.ts` (around line 544): older event kept; newer replaces; equal `at` replaces
Done when: compiles; the test gate runs the tests above
Commit:    one commit for the group

## Proof

