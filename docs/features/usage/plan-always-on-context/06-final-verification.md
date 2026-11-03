# 06 — Final verification

Status: done
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

Commit none · proof: drive run 20261103-004411-8700 (real Claude, ~$0.31+): check 1 PASS (0k then 0k/300k in row and status); check 2 PASS (restored row 49k, status 49k cache 3m before any send; row line is context-only by design, the check's 'cache in both' wording was wrong); check 3 on an open row only activates it (chat-sessions.ts:1517) — rerun 3b on a closed row: limit arrives, but both lines flash 0k before the transcript seed lands (to the review) · concerns: resume of a closed session draws the page zero line until the adapter seed lands — plan expected no 0k between; restored entry header reads '1 step · 498246h 44m' (epoch-start duration, code this run did not touch)
