# 15 — Final verification

Status: not started
Type: Task
Wave: 5 · Depends on: 14
Plan: [plan.md](plan.md)

Files:     none (runs only; captures under `.drive/` and `.selftest/`, both git-ignored)
Consumes:  every landed task
Produces:  a verification report in the Proof section below
Decisions: live checks listed per task, each tagged expected or low-confidence with its reason, so a claim a unit test
           already pins earns no live run (`wigley:writing-tests` § What earns a live run instead)

Run in this order, each through Node from `.nvmrc` (`source ~/.nvm/nvm.sh && nvm use && npm …`):

1. `npm run typecheck`, `npm run lint`, `npm test`: all pass.
2. `npm run selftest`: passes, including the new steps from tasks 02, 11 and 12.
3. Every check under the `## Live checks for task 15` heading of tasks 01, 02, 03, 04, 07, 08, 09, 10, 11, 12 and 13,
   in a drive run (`.agents/skills/drive/SKILL.md`). Read each capture; a screenshot is judged against `DESIGN.md`.
   Tasks 05 and 06 have no live check: their unit tests pin their claims.

A check that fails goes back to its task's group as a fix, and this task reruns the failed check plus steps 1 and 2.
A check the drive run cannot reach is reported here with the reason, never skipped in silence.

Checks only the user's hands or eyes can settle go in the run's wrap-up, not here: none are expected, since every
change is reachable by synthetic keys, clicks and resizes.

Done when: steps 1 and 2 pass, and every live check is passed or reported unreachable with its reason.
Commit:    none (the Proof section rides in the lead's next commit)

## Proof
