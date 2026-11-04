# 01 — ActiveTime module

Status: done
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     create `src/shared/active-time.ts` · test `src/shared/active-time.test.ts`
Consumes:  none
Produces:  in `src/shared/active-time.ts`:
           `export interface ActiveTime { totalMs: number; since: number | null }`
           `export const NO_ACTIVE_TIME: ActiveTime` — `{ totalMs: 0, since: null }`
           `export function startActiveTime(time: ActiveTime, now: number): ActiveTime`
           `export function stopActiveTime(time: ActiveTime, now: number): ActiveTime`
           `export function activeMsAt(time: ActiveTime, now: number): number`
Decisions: a pure record and pure functions, with no clock inside; the caller passes `now` (design review: an
           injected clock) · shared layer, because chat main and the chat page both use it (round 1)

Behaviour:

- `totalMs` is the sum of the closed spans. `since` is the start of the open span, null while paused.
- `startActiveTime` on a running time returns the same object. On a paused time it returns `since: now`.
- `stopActiveTime` on a paused time returns the same object. On a running time it returns
  `totalMs + max(0, now - since)` and `since: null`.
- `activeMsAt` returns `totalMs` while paused, and `totalMs + max(0, now - since)` while running.
- A `now` before `since` (a clock step back) adds 0, never a negative span.
- Doc comments on the interface state these rules, so no caller reads the body.

GIVEN a paused time of 5000 ms WHEN it starts at 10 000 and stops at 12 500 THEN `totalMs` is 7500 and `since` is null
GIVEN a running time WHEN `startActiveTime` runs again THEN the same object returns and the open span is kept

Tests:     `active-time.test.ts`, one `it.each` table over a sequence of start and stop calls with literal `now`
           values and the expected `activeMsAt` at a literal read time. Rows: start then read; start, stop, read;
           start twice (the first start wins); stop while paused (no change); a `now` before `since` (adds 0).
Done when: compiles; the test gate runs `active-time.test.ts`
Commit:    one commit for the group

## Proof

Commit 6640b41c · proof: diff read; all Produces present; typecheck clean for the module; its table passes 7 rows · concerns: AGENTS.md src/shared listing omits active-time.ts (task 06 fixes); stop computes through activeMsAt
