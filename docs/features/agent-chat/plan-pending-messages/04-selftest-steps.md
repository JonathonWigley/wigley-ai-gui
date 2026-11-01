# 04 — Self-test steps

Status: not started
Type: Task
Wave: 4 · Depends on: 03
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/chat/main/selftest-script.ts`
Consumes:  page log lines `<n> pending message(s) in <session name>` and `pulled back <n> message(s) in <session name>` ← 03; the fake harness's `fake: hold` turn (in the tree)
Produces:  self-test steps in chat's script, after its existing interrupt steps
Decisions: a step holds keys, one whole log line to wait on (`expect`), `checksFit` and `screenshot` only (`SelfTestStep`, `src/contracts/plugin.ts`); the box's text and the transcript are proved by the fixture's `EXPECTED_CALLS`, not by step checks
           the steps go in chat-selftest's existing session, inside `INTERRUPT_AND_CLOSE_STEPS`, right after its `<C-c>` step, so no new session joins the folder whose last fake process `fixtureProblems` checks:
           1. send `fake: hold`; wait for the session to show working, as the group's earlier step does
           2. send `pending one`; expect `[chat] 1 pending message(s) in chat-selftest`
           3. leave the box, `G`, Enter; expect `[chat] pulled back 1 message(s) in chat-selftest`
           4. send it again, then send `pending two`; expect `[chat] 2 pending message(s) in chat-selftest`; screenshot the two pending rows
           5. Ctrl+C; expect `[chat] pulled back 2 message(s) in chat-selftest`
           6. once idle, send the box (`pending one\npending two`), leaving it empty for the group's later steps
           extend `EXPECTED_CALLS` at that point with `{ send FAKE_HOLD_TEXT }`, `{ interrupt }`, `{ send 'pending one\npending two' }` in the shapes the list already uses: that one list proves the pull-back's order and text and that no queued message reached the process
           re-read the exact session name and log prefix the group's existing steps expect before pinning them; the names above were read at plan time
           the drain on idle is pinned by 01's unit test and not repeated here: the fake's hold turn ends only by interrupt
Tests:     the self-test itself; no unit test
Done when: compiles; `npm run lint` passes; the self-test runs green with the new steps
Commit:    one commit for the group

## Proof
