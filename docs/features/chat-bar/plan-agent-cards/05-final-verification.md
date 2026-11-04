# 05 — Final verification

Status: done
Type: Task
Wave: 5 · Depends on: 04
Plan: [plan.md](plan.md)

Files:     none
Consumes:  everything above
Produces:  none
Decisions:
- Run `npm run selftest -- --plugin agent-strip --plugin agent-lines` (expected pass: each script drives the fake
  harness's subagents and tasks through the new shapes; `agents` hands no script, so naming it fails the run).
- Capture the strip through the self-test and the chat layout preview (`Space z l c`) in a drive run. The agents
  preview (`Space z l a`) holds a roster with no chat session, so it has no composer to draw a strip in. Expected: the
  self-test's four boxes in start order, tagged Subagent, Background agent, Shell, Shell, with `84k/200k` and the
  warning colour at `166k/200k`; the chat preview's Subagent and Shell boxes.
- Watch a real session spawn a background subagent and a background Bash, and see each box leave when it ends.
- Task 01's low-confidence claim, that a result's `modelUsage` names subagents' models, is settled only by a background
  subagent on a model other than main's, still running when main's `result` arrives: it then shows `…/<its window>`, or
  `84k` alone when the claim is false. A subagent on main's model shows a window either way, through main's key. Record
  the outcome in the Run log for the user.
Done when: the self-test passes and the capture matches the expected look
Commit:    none

## Proof

Commit 5089f410 · proof: Self-test agent-strip + agent-lines passes with all four boxes asserted. Chat preview capture read: Subagent 166k/200k in warning colour, Shell mono command, whole boxes, no parts scrollbar. Real Claude drive run: 4 boxes at peak, each left as it ended, 0 at the end. · concerns: Agents preview has no composer, so it cannot show the strip; task doc corrected. A background subagent waiting on its own background shell is reported done by Claude's task_notification and its box leaves while it still runs: observed 80 s early. That subagent's text shows in the main transcript; the branch left those paths unchanged.
