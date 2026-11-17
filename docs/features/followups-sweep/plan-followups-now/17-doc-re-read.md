# 17 — Doc re-read and follow-up removal

Status: in progress
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
- Items per group, by their exact bold titles (find each with `grep -n -F '**<title>**' docs/features/followups.md`;
  line numbers drift, so none are given):
  - 01 "A restored chat's first step header reads hundreds of thousands of hours"
  - 02 "Old plugin code revisions stay on disk"
  - 03 "Drive quit should wait on the host's actual end"
  - 04 "Self-test fit check flags every split handle's resize prompt"
  - 05 "Switching off docs-session-tab drops unsaved Docs tab edits", "Switching off session-stash drops a note being typed"
  - 06 "A failing worktree list goes unreported"
  - 07 "Each page start logs `[config] applied a new config` again"
  - 08 "Primer `placeRestored` may restore a stale review cursor"
  - 09 "A re-picked problem's open read can overwrite a just-saved draft"
  - 10 "`findScript` lets a failed `stat` reject the pool runner"
  - 11 "A click into the Backlog review pane is pulled back to the table"
  - 12 "Sessions header wraps at the side bar's least width", "The Sessions title wraps letter by letter at the least
    width". Not "Agent-lines row overflows at the side bar's least width": 12 fixes only its header half, and the row
    half is proved only by task 19's check 6, so 19 removes that item on a pass (or corrects it to the row half on a
    fail).
  - 13 "One native-input reset in the input frame", "Redundant docs.css rule"
  - 14 "Info tone for the on-demand tag"
  - 15 "Promote the audio picker's waveform to a shared ui primitive"
  - 16 "Primer tests on a full task's add-item box", "Tests that restate shipped text", "isStringArray reuse" (its text
    names `drive-args.ts`; the `retro-queue.ts` copy is pinned in `../plan-followups-after-lane-h/17-auto-retro-rows.md`
    by its own Decision, so the item goes whole), and "One test naming style" is corrected, not removed: it lists only
    `main-api.test.ts` and `docs-state.test.ts`, which the after-Lane-H plan takes.
  - 18 "A deferred built-in page part that page-depends on a user plugin withheld at launch stays unstarted"
- Every doc line a group added or changed (`DESIGN.md`'s Tag and waveform rows, any `AGENTS.md` line) is read line by
  line against the landed code. A stale line is fixed.
- Leave the scheduled-tasks run's six items and every item outside this list untouched.

GIVEN every group landed WHEN this task runs THEN `grep -c` on each removed item's title in `followups.md` is `0`, and
every other item is unchanged (`git diff` shows only removals and the L804 correction).

Tests: none (doc only).
Done when: the diff holds only the removals, the L804 correction and stale doc-line fixes.
Commit: one commit, "Follow-ups sweep (now): remove the landed items; doc re-read".

## Proof
