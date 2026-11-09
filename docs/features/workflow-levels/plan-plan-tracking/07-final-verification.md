# 07 — Final verification

Status: not started
Type: Task
Wave: 5 · Depends on: 06
Plan: [plan.md](plan.md)

Files:     none
Consumes:  every task
Produces:  none
Decisions: live checks only where no test pins the claim (`wigley:writing-tests` § What earns a live run instead)

Checks:

1. `npm run selftest -- --plugin workflow-large,backlog` passes (expected path: the `reported plan` group, and
   Backlog's plan rows over the moved copy).
2. Drive run (`.agents/skills/drive/SKILL.md`), low-confidence path: the report file reaches a real Large flow through
   the live `Files.watch` and the endpoint folder of a drive run. Start a drive run with the fake harness, open a
   Large fixture session in make with its plan in the run's home, write a second copy and the row's
   `<run home>/.agents/<instance id>/plan-runs/<row>.json`, and read the side pane's Plan section capture: it shows
   the second copy's count. Reason: the self-test sets the endpoint folder the same way, but this is the one path that
   crosses from a file a shell wrote to the checklist on screen.
3. Expected path, by a scratch run in this repo with the marketplace worktree's `plan.py`: with
   `WIGLEY_AI_GUI_ENDPOINT_DIR` set to a scratch folder and `WIGLEY_SESSION_ROW=s1`, run `plan.py log <a scratch plan
   folder> rulings "check"`, and read `plan-runs/s1.json`.

Done when: each check passes, with its output or capture path in the Proof section.
Commit:    none (the Proof rides in the lead's next commit)

## Proof

