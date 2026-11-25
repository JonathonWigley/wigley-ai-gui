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
2. Low-confidence — the peek. The drive has no hover command (`click` and `drag --hold` only), so: `eval` a
   `pointerenter` (or whichever event `shell.ts` listens to) on `.shell-activity-bar`, wait past the peek delay, then
   capture: the bar is wide with names and the side bar's left edge (`query`) is where it was before. `eval` the
   leave event and capture it collapsed. The real pointer's hover is named under Not checked.
3. Expected — `Space v p` pins: the bar stays wide and the side bar moves over; the Pin button reads Unpin; pressing
   again collapses. Pinned again, `eval` `location.reload()`, wait for `ready`, and the bar opens pinned.
4. Low-confidence — `resize 600` while pinned shows the collapsed bar; `resize` back to the start width, pinned.
5. Low-confidence — `setting shell.activityBar '{"groups":[{"modes":["sessions.sessions","work-inbox.main"]},{"modes":["settings.main"],"at":"bottom"}],"hidden":["docs.docs"]}'`
   redraws the bar live: Sessions, Inbox | the other modes but Docs, in suggestion order | Settings at the bottom;
   `Space k d` still opens Docs. Write the default back after.
6. Expected — with the work fixture seeding Needs you items (`do work.seed`), Inbox's item shows its dot collapsed
   and, pinned, a count equal to the Needs you count Inbox's own section nav shows (`query` both).
7. Low-confidence — the look against `DESIGN.md`: tokens only, the divider and dot colours, the count pill, no
   layout shift of item icons between collapsed and expanded.

Dropped: the pin key's toggle and log lines (04's self-test group covers them); the arrangement rule's cases (01's
table).

Done when: every check above passes on its captures, or is named under the wrap-up's Not checked with why.
