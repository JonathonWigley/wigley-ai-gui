# 26 — Doc re-read and follow-up removal

Status: not started
Type: Task
Rung: standard · a doc-only task: prose checked against settled code
Wave: 8 · Depends on: every group
Plan: [plan.md](plan.md)

Files:
- modify `docs/features/followups.md`
- modify any doc line a group changed (`AGENTS.md` and the design docs): read each group's commit for its doc edits

Consumes: every landed group's commit.

Decisions:
- Each landed group's follow-up items leave `followups.md` (the file's rule: remove an item when its work lands). Go by
  item title, never by line number. A group struck by a ruling leaves its items in place, with the item text corrected
  if the ruling found it untrue.
- Items per group, 36 in all, by their exact bold titles. Find each with
  `grep -n -F '**<title>**' docs/features/followups.md`; line numbers drift, so none are given:
  - 01 "Docs keeps only the first tree view's place", "Narrowing leaves the docs filter holding keys", "Selection lost
    on an outside rename or trash", "One newest-wins open rule"
  - 02 "ownsRoot helper"
  - 03 "Tabs lose their first click in an unfocused pane", "A press on an older selection in an unfocused pane leaves
    the keys nowhere"
  - 05 "Sessions page model"
  - 06 "A clamped key on a too-tall last block stops following", "A turn ending in a hidden tab can leave the chat
    cursor off screen"
  - 07 "Step and tool-call durations in the activity line"
  - 08 "`DrawnPart` reports which layout object drew"
  - 09 "One `DEFAULT_NAME` for the layout host"
  - 10 "Split subscribes to its width key": when forms' caller remains, correct the item to name only that caller and
    Lane L's tasks 12–13, rather than removing it
  - 11 "One shared tick and one shared `fakeTimers`"
  - 12 "Window adapter misses page load 1"
  - 13 "The drive `wait-log` misses lines logged before it starts", "`$name_<suffix>` vitest titles lose their case
    name"
  - 14 "One test naming style"
  - 15 "`Git.commitPaths` has no caller"
  - 16 "Memory Files folder watch events"
  - 17 "A restored retro row the queue lost stays unclaimed and open", "The lost-retro log's emit-time capture has an
    untested second path". Not "isStringArray reuse": `../plan-followups-now/` task 17 removes that item, so it is
    already gone; do not add it back.
  - 18 "Chat's `close` and `closeSessionsIn` never resolve after dispose"
  - 19 "Interrupt in the gap before a message's init", "A hand-back's join counts one step short"
  - 20 "Row title takes a local command's text"
  - 21 "A terminal session's saved name is read from the app's `CLAUDE_CONFIG_DIR`"
  - 23 "Self-test has no click step", "Chat self-test steps by single presses", "Docs page test seam for a session's
    host id change", "`forms.choose` with an arg through `runCommand` across the Bridge is not proved live"
  - 24 "Sends and draws after a plugin stops", "A page's invoke after its plugin's main part stopped", "A throwing
    teardown step skips the rest"
  - 25 "Every view's dispose against what it drew"
- Every doc line a group added or changed is read line by line against the landed code. A stale line is fixed.

GIVEN every group landed WHEN this task runs THEN `grep -c -F '**<title>**' docs/features/followups.md` is `0` for each
title listed above, except an item corrected rather than removed (the 10 item when forms' caller remains, or an item
of a group a ruling struck), and every other item is unchanged.

Tests: none (doc only).
Done when: each listed title's `grep -c -F` count is `0`, except an item corrected rather than removed; the diff holds
only the removals, the "Split subscribes to its width key" correction when it applies, and stale doc-line fixes.
Commit: one commit, "Follow-ups sweep (after Lane H): remove the landed items; doc re-read".

## Proof
