# 04 — Final verification

Status: not started
Type: Task
Wave: 4 · Depends on: 03
Plan: [plan.md](plan.md)

Files:     none
Consumes:  everything 01–03 landed
Produces:  the run's verification record
Decisions: risk tier Medium: the log line crosses into both processes' hosts, and the harness change is test
           infrastructure every page and main part test runs on (`~/wigley-agents/decisions.md` § Risk)

## Checks

- `npm run lint` passes (types, layer check, style check).
- `npm test` passes **whole**, expected: the harness is under every plugin's part tests, and a part whose `ready`
  throws in any of them now fails loud. The suite runs in Vitest without Electron, within the whole-suite
  allowance for a suite of about a minute (`decisions.md` § Risk, Whole suites); when it runs past a few minutes,
  stop and run the picks from 01 and 02 plus every `start.test.ts` instead, and log that.
- Any test that now fails because its part's `ready` throws is listed with its name and the error; 01's rule
  applies.
- No self-test and no drive run: nothing the app shows changes. The one runtime change is the log line's source,
  which no self-test step or script reads (`grep -rn "ready of" src` at plan time: code and tests only).

Done when: each check above passes or its failure is logged in the Run log's Test gate.
Commit:    the Run log entry rides in the lead's next commit

## Proof

