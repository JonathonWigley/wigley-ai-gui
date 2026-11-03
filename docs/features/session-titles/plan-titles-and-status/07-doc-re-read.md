# 07 — Doc re-read

Status: not started
Type: Task
Wave: 4 · Depends on: 02, 03, 04, 05, 06
Plan: [plan.md](plan.md)

Files:     modify as needed `docs/features/session-titles/design.md` · `docs/keymap.md` · `AGENTS.md` · `docs/features/layouts/design.md`
Consumes:  every landed task
Produces:  docs that match the landed code
Decisions:
- Re-read each doc written ahead (commit `af96276c`) line by line against the landed code: `design.md` whole (sources, the limit, the tool and its copy, the dialog, the activity table's ranks, tones and clear rules, "chat no longer sends a status line"); `docs/keymap.md`'s `r` row; `AGENTS.md`'s sessions folder line and its row activity and session title bullet.
- `design.md` § Status becomes "Built" with the folders it landed in.
- `docs/features/layouts/design.md`: if it lists the sessions row's inputs, add `title` and `activity`.
- Fix every stale line and commit the fixes.
Done when: each doc above has been read against the code and its fixes committed
Commit:    one commit for the group

## Proof
