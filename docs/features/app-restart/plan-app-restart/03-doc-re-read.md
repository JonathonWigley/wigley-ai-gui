# 03 — Doc re-read

Status: in progress
Type: Task
Rung: standard · doc-only, checks prose against the landed code
Wave: 2 · Depends on: 01, 02
Plan: [plan.md](plan.md)

Files:     modify wigley-ai-gui `AGENTS.md` · modify wigley-ai-marketplace `plugins/wigley/scripts/forms/README.md`
Decisions:
- Read each doc written ahead (plan.md § Docs written ahead) line by line against the code tasks 01 and 02 landed:
  - gui `AGENTS.md` § Running and testing, the "To put the running app on a new build" bullet, and the Contents line.
  - README Contents, "Finding the app", "Restarting the app", § Local commands.
- Fix every line the code contradicts: a flag name, the 15 s wait, the quit commands, the `--from` rule, the
  missing-`pid` failure.
- Drop every "planned in `app-restart`, not built yet" mark.
- The README edit is a plugin change. Fold it into task 02's unpushed bump when that bump is not pushed yet;
  else bump to the next patch version.
Done when: no planned mark is left; `python3 scripts/check_pointers.py` passes in the marketplace.
Commit:    one commit per repo.

## Proof
