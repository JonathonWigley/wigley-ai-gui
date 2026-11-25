# 04 — Self-test steps for the pin

Status: not started
Type: Task
Rung: standard · follows the existing activity bar steps in `src/plugins/docs/main/selftest-script.ts` (the `marked Docs in the activity bar` steps)
Wave: 3 · Depends on: 02
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/docs/main/selftest-script.ts`
Consumes:  `<Leader>vp` bound to `activityBar.togglePin` and the page log lines `activity bar pinned`, `activity bar unpinned` ← 02
Produces:  nothing other tasks read

Decisions:
- One new group in docs' script, after its existing activity bar steps, with a `why` saying it proves the pin key
  toggles the bar wide and back: `Space v p` expects `[page] activity bar pinned` with screenshot `activity-bar-pinned`,
  then `Space v p` again expects `[page] activity bar unpinned` with screenshot `activity-bar-collapsed`. The group
  leaves the bar unpinned for the steps after it.
- The keys are written as the script writes its other leader presses.

GIVEN the self-test page WHEN `Space v p` is pressed twice THEN the log shows pinned, then unpinned, and both screenshots save

Tests:     the self-test group above; `wigley:make` runs `npm run selftest -- --plugin docs`
Done when: compiles; the filtered docs self-test passes
Commit:    one commit for the group

## Proof

