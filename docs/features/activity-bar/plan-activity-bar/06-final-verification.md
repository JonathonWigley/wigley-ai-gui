# 06 — Final verification

Status: not started
Type: Task
Wave: 4 · Depends on: 05 (runs after the test gate, on the finished branch)
Plan: [plan.md](plan.md)

Files:     none
Consumes:  the finished branch
Produces:  drive captures under the run's folder

Decisions:
- One drive run (`.agents/skills/drive/SKILL.md`) from the worktree, on its own temp home, captures read before done.
  Risk tier: medium (a core shell change every mode passes through).

Checks:
1. Expected — the collapsed bar shows the built-in order: Sessions, Inbox, Board, Builds | Docs, Backlog, Schedules,
   Chatroom, with Practice, Gallery, Settings against the bottom and hairlines between groups. Capture it.
2. Expected — hovering the bar past the peek delay widens it over the side bar with names, and the side bar does not
   move (compare its left edge in two captures); moving off collapses it. Low-confidence: pointer events through the
   drive driver; if the driver cannot hover, the agent names it under Not checked.
3. Expected — `Space v p` pins: the bar stays wide and the side bar moves over; the Pin button reads Unpin; pressing
   again collapses. After a page reload while pinned, it opens pinned.
4. Low-confidence — the window resized below 680px while pinned shows the collapsed bar; widened again, pinned.
5. Low-confidence — a `shell.activityBar` setting written into the drive home's `settings.json` (two groups, Docs
   hidden) redraws the bar live with Docs gone and the unlisted modes in a group after the last top group; `Space k d`
   still opens Docs.
6. Expected — with the work fixture seeding Needs you items (`work.seed` drive action), Inbox's item shows its dot
   collapsed and its count expanded.
7. Low-confidence — the look against `DESIGN.md`: tokens only, the divider and dot colours, the count pill, no
   layout shift of item icons between collapsed and expanded.

Dropped: the pin key's toggle and log lines (04's self-test group covers them); the arrangement rule's cases (01's
table).

Done when: every check above passes on its captures, or is named under the wrap-up's Not checked with why.
