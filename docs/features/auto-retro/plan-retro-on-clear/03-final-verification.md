# 03 — Final verification

Status: done
Type: Task
Wave: 3 · Depends on: 02
Plan: [plan.md](plan.md)

Files:     none
Consumes:  the landed code of 01, the docs of 02
Produces:  no code

Run from the repo root:

- `npm test -- src/plugins/auto-retro` — passes.
- `npm run lint` — passes.

No live run. `start.test.ts` drives the main part through the event bus with a fake chat, which covers the wiring from
`chat.sessionCleared` to `launch`. The auto-retro plugin has no self-test script, and the self-test queues nothing by
design (`design.md` § The queue). Risk is low: a wrong queue costs at most an extra or a missed background retro, which
the next manual `/wigley:retro` backfill catches up.

The user's check, for the wrap-up only: after `npm run install-app`, run `/clear` in a stable-app session that sent a
message, and see a row appear in the Retro section.

Done when: both commands pass.
Commit:    none

## Proof

Commit none · proof: npm test -- src/plugins/auto-retro 57/57, typecheck, lint pass at 95acd36a · concerns: none
