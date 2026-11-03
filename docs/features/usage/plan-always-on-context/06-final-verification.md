# 06 — Final verification

Status: not started
Type: Task
Wave: 4 · Depends on: 05
Plan: [plan.md](plan.md)

Files:     none
Decisions: run a drive run, which the agent may start at any time (`AGENTS.md` § Running and testing). Its Chat
           sessions run the real Claude adapter, pointed at the run's own home. The fake harness emits no startup usage,
           so the self-test cannot show these checks. Capture the side-bar row and the Chat status line with the drive
           run's screenshot or video for each check.
Checks:
- expected: a new chat, before any message, shows a row line and a Chat status line reading `0k`, then `0k/<limit>`
  within a few seconds as its process answers `get_context_usage`.
- expected: in the same drive run, send one message, wait for the turn to end, then quit and relaunch the drive app.
  The restored, still resting row shows that turn's context (not `0k`) and `cache …` in both lines, before any send.
  If the drive run cannot relaunch the app, the check goes to the user's wrap-up checks with these steps.
- low-confidence (new start-up order in the adapter, no end-to-end test): resume that session from the past-sessions
  picker. The line shows its context, gaining `/<limit>` within a few seconds, and never drops to `0k` between.
Done when: each check passes on captured frames, or its failure is reported with the capture
Commit:    none

## Proof

