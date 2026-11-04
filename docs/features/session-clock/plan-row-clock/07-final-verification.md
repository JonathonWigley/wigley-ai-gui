# 07 — Final verification

Status: in progress
Type: Task
Wave: 5 · Depends on: 06
Plan: [plan.md](plan.md)

Files:     none (captures go under the drive run's folder)
Consumes:  the landed work of tasks 01–06
Produces:  the live checks below, each passed or reported
Decisions: live checks only for what the tests cannot see (`wigley:writing-tests` § What earns a live run instead)

Run the app through a drive run, as `AGENTS.md` § Running and testing describes, with fixture or fake-harness
sessions. Capture the side bar for each check.

Checks:

1. **Expected** — the compact row at a 240px side bar: two lines per card; the second line holds the status chip,
   the meter, the used tokens (`121k`), then the run time and the cache icon at the line's end, on one line. Compare
   with the before capture named in task 05's Proof: each card is at least 8px shorter.
2. **Expected** — a session with a running turn: the run time ticks once a second and stops when the turn ends.
   Low confidence: the tick wiring has a unit test, but the row part's draw inside the sessions side bar does not.
3. **Low confidence** — the cache icon is `fg-secondary` while warm and `status-error` once cold; its tooltip names
   the minutes left. Use a fixture usage whose `cacheExpiresAt` is in the past for the cold case.
4. **Low confidence** — the part order holds for a row with no status chip, and for a row with no usage (the meter
   reads `0k`, no cache icon): the run time, when shown, stays at the line's end. A long status ellipsizes and the
   line does not wrap.
5. **Low confidence** — with the peer `session-groups` side bar (group headers), the compact rows sit inside each
   group with no broken gaps.

Report each check with its capture path. A failed check is reported to the lead as a concern with its capture.

Done when: every check above is reported
Commit:    none

## Proof

