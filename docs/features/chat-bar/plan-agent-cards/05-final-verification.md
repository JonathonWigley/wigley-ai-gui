# 05 — Final verification

Status: not started
Type: Task
Wave: 5 · Depends on: 04
Plan: [plan.md](plan.md)

Files:     none
Consumes:  everything above
Produces:  none
Decisions:
- Run `npm run selftest -- --plugin agent-strip --plugin agent-lines` (expected pass: each script drives the fake
  harness's subagents and tasks through the new shapes; `agents` hands no script, so naming it fails the run).
- Open the agents layout preview (`Space z l a`) in a drive run and capture the strip: expected four boxes in start
  order, tagged Background agent, Shell, Shell, Subagent, each with a ticking runtime, and the Background agent's
  context bar in the warning colour (`166k/200k`) where the Subagent's reads `84k/200k` (expected: task 02 pins these
  sample values).
- Watch a real session spawn a background subagent and a background Bash, and see each box leave when it ends.
- Task 01's low-confidence claim, that a result's `modelUsage` names subagents' models, is settled only by a background
  subagent on a model other than main's, still running when main's `result` arrives: it then shows `…/<its window>`, or
  `84k` alone when the claim is false. A subagent on main's model shows a window either way, through main's key. Record
  the outcome in the Run log for the user.
Done when: the self-test passes and the capture matches the expected look
Commit:    none

## Proof
