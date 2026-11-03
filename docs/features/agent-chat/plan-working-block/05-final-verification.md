# 05 — Final verification

Status: not started
Type: Task
Wave: 3 · Depends on: 04
Plan: [plan.md](plan.md)

Files:     none
Consumes:  the landed code of 01–04
Produces:  none

Checks:

1. `npm test` — the whole Vitest suite and its typecheck pass.
2. `npm run selftest -- --plugin chat` — every chat group passes. Expected path.
3. Read `.selftest/screenshots/chat-activity-live.png` against `DESIGN.md` and the plan's Design Overview: the
   working block sits under the last entry with its header (`m:ss` and a state word), and the run's line above it
   is one summary line. Low-confidence: the slot's placement and the card's look have no test. The fake's steps turn
   holds tool calls, so the box and the counts show.
4. Read `.selftest/screenshots/chat-activity-finished.png`: no working block; the run line and the result line,
   the cost in `$0.00` form. Expected path.

Done when: every check above passes, or each failure is fixed and its check run again
Commit:    none, unless a fix lands

## Proof
