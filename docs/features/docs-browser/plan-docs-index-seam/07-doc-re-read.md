# 07 — Re-read the docs written ahead against the landed code

Status: done
Type: Task
Wave: 5 · Depends on: 01, 02, 03, 04, 05, 06
Plan: [plan.md](plan.md)

Files:     modify, where a line is stale: `AGENTS.md` · `docs/features/docs-browser/design.md` ·
           `.agents/skills/drive/SKILL.md` · wigley-ai-marketplace `plugins/wigley/scripts/docs-index/README.md`
Consumes:  every task's landed code
Produces:  docs true to the code
Decisions: the docs were written ahead in `7a6a996`, `c09b7fb` and marketplace `6a1a551`, and are hypotheses until
           checked (`wigley:writing-for-agents` § Doctrine before code)

## Behaviour

Check each line those commits added or changed against the code, and fix each one that is stale:

- `AGENTS.md` § Architecture: the docs folder line and "A docs index source", against `index-sources.ts`,
  `main/start.ts` and `page/start.ts`. § Intent's new bullet needs no check against code.
- `design.md` § Docs browser: the index source bullet (ids, titles, `loadIndex` / `rebuildIndex`, the first-show rule,
  the guard's entries), the page exports (the handle's members, `openDoc`'s refusal), the unknown kind and source
  text (the title example, the guard rule), the trash bullet (which link goes), and the disk-change watch, each
  against its task's code.
- `.agents/skills/drive/SKILL.md`: `docs.openDoc`'s args and result, against `main/start.ts`.
- Marketplace `README.md`: the `walked` field and `schemaVersion: 2`, against `model.py`.
- `docs/features/master-plan.md` and `followups.md` were only corrected (the task-07 deadline). Leave step 3's
  entries for `wigley:make`'s Close.

Done when: every line above checked; stale lines fixed and committed (the README fix in wigley-ai-marketplace), or
           the check recorded as clean in the Proof
Commit:    one commit per repo for the group, when anything changed

## Proof

Commit 5766b00 · proof: design.md: 2 stale lines fixed (guard clears on failed load; openDoc waits for first index run); AGENTS.md, drive SKILL.md, marketplace README checked clean — no marketplace commit · concerns: none
