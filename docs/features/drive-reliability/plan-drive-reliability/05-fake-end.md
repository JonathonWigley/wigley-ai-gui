# 05 — A `fake: end` message ends its own fake session

Status: not started
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     modify `src/shared/fake-agent-harness.ts` · test `src/shared/fake-agent-harness.test.ts` ·
           modify `src/plugins/chat/main/start.ts` (the `chat.start` drive action's description string only)
Consumes:  `FAKE_HOLD_TEXT`, `FAKE_TOOL_TEXT`, the process's `send`, `end`, `requireRunning`, `record.ended` in
           `src/shared/fake-agent-harness.ts` (tree)
Produces:  `export const FAKE_END_TEXT = 'fake: end'` in `src/shared/fake-agent-harness.ts`
Decisions: follows the `fake: tool` / `fake: hold` pattern (round 1) · the session ends as a CLI that exits on its
           own: `ended({ code: 0, error: null })`, the same event `end()` emits

## Behaviour

- A `send` of `FAKE_END_TEXT` records the call, emits the user entry and `activity('working')` as every send does,
  then in the same microtask marks the process ended and emits `ended({ code: 0, error: null })`. No reply entry.
- After it, `send`, `interrupt` and `setControl` throw as on any ended process (`requireRunning`), and `end()`
  resolves at once without a second `ended`: the self-ended process sets the same `endPromise` `end()` returns.
  If the process has a `kill()` by then (a peer's edit, uncommitted when this plan was refreshed), it already returns
  early once `endPromise` is set, so a kill after a self-end emits nothing; match its shape.
- The constant's comment matches its neighbours' one-line form: "A send of this text ends the process on its own, as
  a CLI that exits."
- `chat/main/start.ts`: the `chat.start` drive action's description, which lists the fake's messages, adds `"fake:
  end" one that ends the session` beside `"fake: tool"` and `"fake: hold"`.

GIVEN a started fake process WHEN `send` carries `fake: end` THEN the user entry is emitted, then `ended` once with
`{ code: 0, error: null }`, and the record reads `ended: true`
GIVEN a process that ended itself WHEN `end()` is called THEN it resolves and `ended` was emitted only once
GIVEN a process that ended itself WHEN `send` is called THEN it throws `fake agent process has ended`

Tests:     the three cases in `fake-agent-harness.test.ts`, in the file's own naming style
Done when: `npm run typecheck` and `npm run lint` pass; the test gate runs the tests above. The ended composer on
           screen is task 12's check.
Commit:    one commit for the group

## Proof

