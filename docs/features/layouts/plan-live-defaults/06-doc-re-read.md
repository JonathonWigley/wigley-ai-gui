# 06 — Re-read the docs written ahead against the landed code

Status: not started
Type: Task
Wave: 3 · Depends on: 01, 02, 03, 04, 05
Plan: [plan.md](plan.md)

Files:     modify `docs/features/layouts/design.md` · modify `AGENTS.md` · modify any other doc the check finds stale
Consumes:  the landed code of tasks 01–05
Produces:  docs that state what the code does
Decisions: docs written ahead are hypotheses until checked (`wigley:writing-for-agents` § Doctrine before code)

Read each doc below line by line against the landed code. Fix every line the code contradicts. Write no new doc
text that the code does not support.

- `docs/features/layouts/design.md` — § Live defaults (each bullet: the clone path, the folder, reload, CSS,
  fallback), the Shape diagram's live-default lines, the owner's contract bullet, and the two new Decisions.
- `AGENTS.md` — the look-change paragraph after the UI work paragraph, and the layout bullet under Architecture
  (search "read live from the repo clone").
- Also search the repo docs for lines this change made stale:
  `grep -rn "builtIn\|built-in default\|bundled by Vite\|needs a rebuild\|install-app" AGENTS.md DESIGN.md docs --include=*.md`.
  Check each hit that speaks of default layouts or rebuilds for a look change.

GIVEN the landed code WHEN each listed doc line is read against it THEN every line is true of the code
Tests:     none — a doc change earns no test
Done when: every listed line checked; each stale line fixed; the fixes committed
Commit:    one commit for the doc fixes, or none when no line is stale (record that in the Proof)

## Proof

