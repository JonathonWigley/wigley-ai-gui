# 07 — Doc re-read

Status: done
Type: Task
Wave: 4 · Depends on: 01, 02, 03, 04, 05, 06
Plan: [plan.md](plan.md)

Files:     modify `docs/features/session-groups/design.md` · modify `docs/keymap.md` · modify `DESIGN.md` ·
           modify `docs/features/layouts/design.md`
Consumes:  the landed code of 01–06
Produces:  docs that match the code line by line
Decisions: a doc written before its code is a hypothesis (`~/wigley-agents/decisions.md` § Docs)

- Read each doc written ahead (commits `6cbd1992` and the plan commit) line by line against the landed code: `design.md` (every
  rule in Projects, Order, Favorites, Drawing), `docs/keymap.md`'s `p` row (the three binds as `keymap.ts` holds
  them), `DESIGN.md`'s DragReorder entry (the builder's name and what a drop reports).
- Docs the change leaves stale that were not written ahead: `docs/features/layouts/design.md` § Adopters' `sessions`
  row (the side bar now holds sections and project groups over the rows) and `DESIGN.md` § Surfaces' side bar
  line (Sessions rows sit in project groups under Favorites and Recent).
- Set `design.md` § Status to built, naming the folders the work landed in, as `docs/features/session-titles/design.md` does.
- Fix every stale line; commit the fixes.

Done when: every line of the three docs matches the code; the fixes are committed
Commit:    one commit for the group

## Proof

Commit 91310da5 · proof: doc diff read against the code; every doc line named matches · concerns: none open; the worker's is-empty concern is dismissed, since SessionsParts is the app that layout.d.ts says keeps it
