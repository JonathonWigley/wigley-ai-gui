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
- Open the agents layout preview (`Space z l a`) in a drive run and capture the strip: expected four boxes, tagged Subagent,
  Background agent, Shell, Shell, each with a ticking runtime, and the Background agent's context bar in the warning
  colour (`166k/200k`) beside the Subagent's `84k/200k` (expected: task 02 pins these sample values).
- For the user's wrap-up only (not run here): watch a real session spawn a background subagent and a background Bash,
  and see each box leave when it ends; after the first turn ends, a subagent box shows `…/200k` (or its model's
  window). If it still shows `84k` alone, the result's `modelUsage` does not name subagent models (task 01's
  low-confidence claim): record it in the Run log for the user.
Done when: the self-test passes and the capture matches the expected look
Commit:    none

## Proof
