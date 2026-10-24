# 02 — Doc re-read

Status: not started
Type: Task
Wave: 2 · Depends on: 01
Plan: [plan.md](plan.md)

Files:     modify as needed `docs/keymap.md` · `docs/features/plugin-framework/design.md` ·
           `docs/features/followups.md`
Consumes:  the landed code of 01
Produces:  the three docs, each line true of the landed code
Decisions: the docs were written ahead in `9e472e12` (plan.md, Docs written ahead)

Read each doc's changed lines against the landed keymap and handlers:

- `docs/keymap.md` Layers: every view the `Ctrl+j`/`Ctrl+k` bullet names binds them in
  `src/plugins/keymap.ts`; the list views it names bind none; the `Ctrl+n`/`Ctrl+p` bullet matches
  the forms binds and their scopes.
- `docs/features/plugin-framework/design.md` Keymap (plan A2): the box keys and the forms scroll
  line.
- `docs/features/followups.md`: the list-view entry names views that still lack the keys.
- Also `grep -rn "C-j\|Ctrl+j\|C-k\|Ctrl+k" AGENTS.md DESIGN.md docs/` and fix any other line that
  still says forms moves boxes on Ctrl+j/k.

Done when: every stale line is fixed
Commit:    one commit for the fixes, or none when nothing changed

## Proof

