# 05 — Final verification

Status: done
Type: Task
Wave: 3 · Depends on: 04
Plan: [plan.md](plan.md)

Files:     none
Consumes:  everything above
Produces:  none
Decisions:
- `npm test` (expected to pass): the unit tests of 01 and 02 and the type check of 03.
- `npm run selftest` (expected to pass): the sessions panes group (owned fixtures now), the docs, notes and usage
  groups (owned fixtures now), and the forms and primer groups, which connect sessions and show forms on them.
  Low-confidence: a forms or primer group that submits or cancels a round and then expects that session's row to
  stay. After this change the row closes on release; such a step is updated to expect the row gone, or to open the
  next form, which brings the row back. Record each such change in the Proof.
- The forms self-test specifically (low-confidence): its `idle` session (`selftest-<run>-3`) gets only a round
  `ask_round` refuses before it opens, so it now has no row; and rows now appear in form-show order, not connect
  order, and leave as rounds close. Steps that count rows or move between sessions (`activated selftest 2`,
  `selftest 3`, neighbour keys) are checked against that. Where a step needs the idle row, open `idle` as an
  owned session in the background instead (`open(info, { select: false })`); otherwise update the step's
  expectation. Record each change in the Proof.
- Live check by the agent through a drive run, or by the user only where the drive cannot reach (expected): a
  connected session with no form shows no row; a round opened on it adds its row, marked or selected; submitting it
  removes the row; a second round brings it back; cancelling removes it again. The forms drive actions
  (`forms.openRound` on a `sessions.connect`ed session) cover this without a real terminal session.
Done when: both commands pass and the live check matches; any check only the user can run is listed in the wrap-up
Commit:    none, unless a self-test step changes (then one commit for those steps)

## Proof

Commit eb6f544b · proof: selftest all passed (818 PASS); full npm test pass; lint clean (c6352d51); live drive checks 1-6 PASS (no row at connect, round adds, submit removes, second round restores, cancel removes, owned keeps), check 7 (round+primer on one connected session) not reachable by drive — owned by presenter close-guard unit behaviour · concerns: cancel via <D-w> logs 'session close kept by main' then 'closeSession for session <id> with no row ignored' — the page's close request arrives after release removed the row; stale drive-actions.ts addAgentFormDriveActions header still says connect adds a row
