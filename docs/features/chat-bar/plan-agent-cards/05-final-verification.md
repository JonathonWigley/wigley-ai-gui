# 05 — Final verification

Status: not started
Type: Task
Wave: 5 · Depends on: 04
Plan: [plan.md](plan.md)

Files:     none
Consumes:  everything above
Produces:  none
Decisions:
- Run `npm run selftest -- --plugin agent-strip --plugin agents --plugin agent-lines` (expected pass: each script
  drives the fake harness's subagents and tasks through the new shapes).
- Open the agents layout preview (`Space z l a`) in a drive run and capture the strip: expected three boxes with tags
  Subagent / Background agent / Shell, a ticking runtime, one context bar in the warning colour (low-confidence: the
  preview's samples must carry the context values task 02 sets).
- For the user's wrap-up only (not run here): watch a real session spawn a background subagent and a background Bash,
  and see each box leave when it ends.
Done when: the self-test passes and the capture matches the expected look
Commit:    none

## Proof
