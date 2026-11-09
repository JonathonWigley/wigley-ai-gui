# 03 — Final verification

Status: not started
Type: Task
Wave: 3 · Depends on: 02
Plan: [plan.md](plan.md)

Files:     none
Consumes:  `shownRowActivity` ← 01
Produces:  no code
Decisions: the rule's cases are pinned by 01's table; the live run checks only the drawn row (`wigley:writing-tests` § What earns a live run instead)

Run a drive run per the repo's `drive` skill (`.agents/skills/drive/SKILL.md`). Use the fake agent harness and the
workflow plugins' drive actions or self-test fixtures that put a session in a workflow stage. Search
`src/plugins/workflow*/main/selftest-script.ts` and `api.drive` registrations for them.

Checks:
- expected path: a session in a Small, Medium or Large mid-run stage, with its turn ended and no subagent, shows the
  solid peach `Needs you` Tag on its sidebar row. The workflow chip shows the level badge and the stage label with no
  status tag. Capture a screenshot.
- low-confidence path: the same session while a turn runs shows no Needs you. When the label clears as the next turn
  starts, the label wiring is proved.
- low-confidence path: Large's plan ready still shows `Ready to make` and not Needs you.
- low-confidence path: a Small or Medium paused row's chip draws no stage tag (the layout guard 01 adds, unseen by
  the page tests).

The self-test screenshots of Small's and Large's flows (for example `small-build-checklist`) may now show a Needs you
row; they assert log lines only, so a changed picture is expected, not a finding.

Done when: each check's capture is read and matches, or the mismatch is a finding for the review.
Commit:    none

## Proof

