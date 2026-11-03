# 02 — Usage store keeps the newest event

Status: not started
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/usage/main/usage-store.ts` · test `src/plugins/usage/main/usage-store.test.ts`
Consumes:  `withSessionUsage` in `usage-store.ts` (tree)
Produces:  `withSessionUsage` (same signature) ignoring a `usage` older than the kept one
Decisions:
- `withSessionUsage`: when the known entry holds a usage and the incoming non-null `usage.at` is older than it, the
  kept usage stays and only `profileDir` updates. When the profile is also unchanged, the same state object comes
  back. An equal `at` replaces. The doc comment says so (`docs/features/usage/design.md` § The usage plugin).
- The test file's `usageEvent(contextTokens)` helper (hard-coded `at: 500`) gains an optional `at` argument,
  defaulting to 500, so existing rows are unchanged.
GIVEN a session holding a usage at t=2000 WHEN a usage at t=1000 arrives with the same profile THEN the store returns the same state
GIVEN a session holding a usage at t=2000 WHEN a usage at t=1000 arrives with another profile THEN the entry takes the new profile and keeps the t=2000 usage
Tests:     add rows to the existing `session usage` table in `usage-store.test.ts` (around line 544): older event, same profile → kept; older event, new profile → profile updated, usage kept; newer replaces; equal `at` replaces
Done when: compiles; the test gate runs the tests above
Commit:    one commit for the group

## Proof

