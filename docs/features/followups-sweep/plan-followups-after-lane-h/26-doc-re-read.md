# 26 — Doc re-read and follow-up removal

Status: not started
Type: Task
Rung: standard · a doc-only task: prose checked against settled code
Wave: 7 · Depends on: every group
Plan: [plan.md](plan.md)

Files:
- modify `docs/features/followups.md`
- modify any doc line a group changed (`AGENTS.md` and the design docs): read each group's commit for its doc edits

Consumes: every landed group's commit.

Decisions:
- Each landed group's follow-up items leave `followups.md` (the file's rule: remove an item when its work lands). Go by
  item title, never by line number. A group struck by a ruling leaves its items in place, with the item text corrected
  if the ruling found it untrue.
- Items per group: 01 docs tree view place (L51), narrowing leaves the docs filter holding keys (L126), selection
  lost on outside rename or trash (L131), one newest-wins open rule (L140) · 02 ownsRoot helper (L534) · 03 tabs lose
  the first click (L169), press on an older selection (L175) · 05 sessions page model (L551) · 06 clamped key on a too-tall last block (L197), turn ending in a hidden tab (L202) ·
  07 step and tool-call durations (L468) · 08 DrawnPart reports drewBundled (L565) · 09 one DEFAULT_NAME (L559) · 10
  Split subscribes to its width key (L510: when forms' caller remains, correct the item to name only that caller and
  Lane L's tasks 12–13, rather than removing it) · 11 shared tick and fakeTimers (L571) · 12 window adapter misses
  page load 1 (L98) · 13 wait-log (L247), `$name_<suffix>` titles (L807) · 14 one test naming style (L804) · 15
  Git.commitPaths has no caller (L640) · 16 Memory Files folder watch events (L733) · 17 restored retro row unclaimed
  (L765), lost-retro second path untested (L784) · 18 chat close after dispose (L772) · 19 interrupt before a
  message's init (L104), hand-back join (L644) · 20 row title takes a local command's text (L216) · 21 terminal
  session name (L898) · 23 self-test click step (L869), single-press steps (L850), docs
  host-id seam (L777), `forms.choose` via `runCommand` (L224) · 24 sends and draws after a stop (L664), page invoke
  after the main part stopped (L673), throwing teardown step (L695) · 25 every view's dispose (L700).
- Every doc line a group added or changed is read line by line against the landed code. A stale line is fixed.

GIVEN every group landed WHEN this task runs THEN `grep -c` on each removed item's title in `followups.md` is `0`, and
every other item is unchanged.

Tests: none (doc only).
Done when: the diff holds only the removals, the L510 correction when it applies, and stale doc-line fixes.
Commit: one commit, "Follow-ups sweep (after Lane H): remove the landed items; doc re-read".

## Proof
