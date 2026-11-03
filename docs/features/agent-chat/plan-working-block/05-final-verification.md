# 05 — Final verification

Status: not started
Type: Task
Wave: 4 · Depends on: 04
Plan: [plan.md](plan.md)

Files:     none
Consumes:  the landed code of 01–04
Produces:  none

Checks:

1. `npm run typecheck`, `npm test` and `npm run lint` pass.
2. `npm run selftest -- --plugin chat` — every chat group passes. Expected path.
3. `npm run selftest -- --plugin agents` — passes with `.chat-working-action` in its `scrollsItself` list.
   Expected path.
4. Read `.selftest/screenshots/chat-activity-live.png` against `DESIGN.md` and the plan's Design Overview: the
   working block sits under the last entry, with its header (`m:ss` and a state word; the fake's steps all finish,
   so `Thinking…` is expected), a box of tool lines, and the counts. The run's line above it is one summary line.
   Low-confidence: the slot's placement and the card's look have no test.
5. Read `.selftest/screenshots/chat-activity-finished.png`: no working block, and the run's summary line. The
   result cost format is pinned by `layout.test.ts`, not here (that turn ends by interrupt, with no cost).
   Expected path.

Done when: every check above passes, or each failure is fixed and its check run again
Commit:    none, unless a fix lands

## Proof
