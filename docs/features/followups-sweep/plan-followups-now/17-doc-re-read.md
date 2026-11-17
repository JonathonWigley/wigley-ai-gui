# 17 — Doc re-read and follow-up removal

Status: not started
Type: Task
Rung: standard · a doc-only task: prose checked against settled code
Wave: 3 · Depends on: every group
Plan: [plan.md](plan.md)

Files:
- modify `docs/features/followups.md`
- modify any doc line a group changed (`DESIGN.md`, `AGENTS.md`): read each group's commit for its doc edits

Consumes: every landed group's commit.

Decisions:
- Each landed group's follow-up items leave `followups.md` (the file's rule: remove an item when its work lands). Go by
  item title, never by line number: the triage commit and the scheduled-tasks run both moved lines. A group struck by
  a ruling leaves its items in place, with the item text corrected if the ruling found it untrue.
- Items per group: 01 restored step header (L80) · 02 old plugin code revisions (L62) · 03 drive quit waits on the
  host (L828) · 04 fit check flags split handle prompts (L953) · 05 docs-session-tab switch-off (L683), session-stash
  switch-off (L688) · 06 failing worktree list unreported (L637) · 07 `[config] applied a new config` every start
  (L651) · 08 primer `placeRestored` stale review cursor (L926) · 09 re-picked problem's read overwrites a draft
  (L929) · 10 `findScript` failed stat (L939) · 11 backlog review pane click (L912) · 12 sessions header at least
  width, agent-lines row overflow, sessions title letter wrap (L855, L885, L909) · 13 native-input reset (L513),
  redundant docs.css rule (L539) · 14 info tone for the on-demand tag (L530) · 15 waveform to a shared primitive (L580)
  · 16 primer full-task tests (L792), tests restating shipped text (L798), isStringArray reuse (L537), and the three
  files of "one test naming style" this plan covers (L804: correct that item to list only `main-api.test.ts` and
  `docs-state.test.ts`, which the after-Lane-H plan takes) · 18 deferred built-in page part (L593).
- Every doc line a group added or changed (`DESIGN.md`'s Tag and waveform rows, any `AGENTS.md` line) is read line by
  line against the landed code. A stale line is fixed.
- Leave the scheduled-tasks run's six items and every item outside this list untouched.

GIVEN every group landed WHEN this task runs THEN `grep -c` on each removed item's title in `followups.md` is `0`, and
every other item is unchanged (`git diff` shows only removals and the L804 correction).

Tests: none (doc only).
Done when: the diff holds only the removals, the L804 correction and stale doc-line fixes.
Commit: one commit, "Follow-ups sweep (now): remove the landed items; doc re-read".

## Proof
