# 05 — Final verification

Status: not started
Type: Task
Wave: 5 · Depends on: 04
Plan: [plan.md](plan.md)

Files:     none
Decisions:
- Run through the app's drive run (`AGENTS.md` § Running and testing), against a real Claude session in a scratch project: the fake harness takes every message in at once and cannot show a fold.
- Checks:
  1. **Expected** — queue a message during a tool turn (ask for `sleep 6` through Bash, then type and send a reply while it runs). Focus the pending row and press Cmd+Enter. The row reads `sending`, then disappears when Claude takes it in. The user entry lands after the `sleep` tool's result, and Claude answers it inside the same turn, with one turn-finished alert.
  2. **Expected** — `<Leader>cs` in the box sends the newest pending message now, with two queued. The older one stays `pending` and runs as its own turn afterwards.
  3. **Low-confidence** (exercised by no test against real Claude) — send now, then Ctrl+C before the fold. The sent row stays, the unsent rows return to the box, and the sent message runs as its own turn straight after.
  4. **Low-confidence** (changed timing for every send) — an idle send still shows its user entry at once.
- Capture each check's screen across the moment (drive screenshots), and name the drive run folder in the Proof.
Done when: each check's outcome is recorded in Proof with its capture; a failure goes back to the owning task.
Commit:    none

## Proof

