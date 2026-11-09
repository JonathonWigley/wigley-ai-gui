# 02 — Doc re-read

Status: in progress
Type: Task
Wave: 2 · Depends on: 01
Plan: [plan.md](plan.md)

Files:     modify (only where a line is stale) `docs/features/workflow/design.md` · `docs/features/session-titles/design.md` · `DESIGN.md`
Consumes:  `PAUSED_RUN_ACTIVITY`, `shownRowActivity` ← 01
Produces:  no code
Decisions: the docs were written ahead of the code (plan.md, Docs written ahead); each is a hypothesis until this check

Check each line below against the landed code in `src/plugins/workflow/contract.ts`:
- `docs/features/workflow/design.md`: the Running/Paused paragraph (search `Running means the flow is busy`) and the
  **Paused run** bullet under Row label. Check the rank (18), what clears the label, and which stages set none.
- `docs/features/session-titles/design.md`: the rank table rows `needs you | workflow` and `ready to make, closed`.
- `DESIGN.md`: the `Needs you` row of the status colour table.
- Search the repo docs for other lines that say Needs you comes only from a permission prompt or an open round:
  `grep -rn -i "needs you" docs DESIGN.md AGENTS.md`. Fix each line the new rule makes false.

Done when: every line above matches the code, and each stale line is fixed.
Commit:    one commit for the group, or none when nothing is stale

## Proof

