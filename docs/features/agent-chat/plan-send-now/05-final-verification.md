# 05 — Final verification

Status: not started
Type: Task
Wave: 5 · Depends on: 04
Plan: [plan.md](plan.md)

Files:     none
Decisions:
- Run on the real Claude CLI, the one the app already spawns, per `.agents/skills/drive/SKILL.md` § Real Claude: `npm run drive -- start --harness claude`. The fake harness takes every message in at once and cannot show a fold. `chat.start` uses the first profile in chat's `profiles` setting that is logged in; read the action's arguments with `npm run drive -- actions`. Use a scratch project folder under the drive run's home. The run spends tokens: name it in the report.
- Checks, each captured with `screenshot <name>`:
  1. **Expected** (`send-now-fold-before`, `send-now-fold-sending`, `send-now-fold-after`): send `Use the Bash tool to run sleep 8, then reply with the word done.`. While the tool runs, type `Reply with the single word two.` in the box and send it, so it queues. Press `<Esc>`, `G`, `<D-Enter>`. The row reads `sending`, then it is gone. In the transcript, the user entry sits after the `sleep` tool's result, and Claude answers `two` inside the same turn.
  2. **Expected** (`send-now-box`): with a tool turn running, queue two messages, type a third in the box and press `<D-Enter>` there. All three read `sending`, then fold into the running turn in the order written.
  3. **Low-confidence** (`send-now-interrupt`), untested against real Claude: queue two messages during `sleep 8`, send the newer one now, and press `<C-c>` while the `sleep` tool still runs. The unsent message returns to the box. The sent row stays and runs as its own turn straight after the interrupt.
  4. **Low-confidence** (`idle-send-entry`), the entry timing changed for every send: on an idle session, send `hi` and capture at once. The user entry shows in that capture, before any reply.
- The turn-finished alert is a native notification, which an offscreen run cannot show. It goes in the wrap-up as a check for the user.
Done when: each check's outcome is in Proof with its capture names and the drive run folder; a failure goes back to the owning task.
Commit:    none

## Proof

