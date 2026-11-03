# 06 — Final verification

Status: not started
Type: Task
Wave: 4 · Depends on: 05
Plan: [plan.md](plan.md)

Files:     none
Decisions: run through the app's self-test or drive run (`AGENTS.md` § Running and testing), which the agent may start
           at any time. Capture the side-bar row and Chat status line for each check.
Checks:
- expected: a new chat, before any message, shows a row line and a Chat status line reading `0k`, then `0k/<limit>`
  once its process answers `get_context_usage`.
- expected: a session restored after an app restart, still resting, shows its transcript context (e.g. `83k`) and
  `cache cold` in the row line and status line, before any send.
- low-confidence (new start-up ordering in the adapter, untested end to end): resuming a past session from the picker
  shows its context with the limit within a few seconds, never dropping to `0k` in between.
- low-confidence (layout with no cache/spend items): the zero line's narrow-bar dropping still keeps the bar.
Done when: each check passes on captured frames, or its failure is reported with the capture
Commit:    none

## Proof

