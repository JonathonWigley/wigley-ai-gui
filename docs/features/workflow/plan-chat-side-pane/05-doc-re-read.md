# 05 — Doc re-read

Status: not started
Type: Task
Wave: 4 · Depends on: 01, 02, 03, 04
Plan: [plan.md](plan.md)

Files:     check, and modify where stale, `docs/features/workflow/design.md` · `AGENTS.md` · `docs/keymap.md` · `docs/features/layouts/design.md`
Decisions:
- Check each doc line about the work against the landed code: the stage table, Where it draws, Keys, Decisions, the side part's paragraph, the workflow file map, the keymap lines and the layouts table row.
- Fix each stale line and commit the fixes.
Done when: every line above matches the code; `grep -n 'Flow tab' docs/keymap.md docs/features/layouts/design.md AGENTS.md` prints nothing
Commit:    one commit for the group, when a line changed

## Proof

