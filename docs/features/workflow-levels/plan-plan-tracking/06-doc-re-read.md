# 06 — Doc re-read

Status: not started
Type: Task
Wave: 4 · Depends on: 05, 03
Plan: [plan.md](plan.md)

Files:     modify only on a stale line: `docs/features/workflow/design.md` · `docs/features/workflow-levels/design.md` · `docs/features/backlog/design.md` · `AGENTS.md` · marketplace `plugins/wigley/skills/make/SKILL.md`
Consumes:  the landed code of 01–05
Produces:  none
Decisions: docs written ahead are hypotheses until re-read against the code (`wigley:writing-for-agents` § Doctrine
           before code)

Read each doc the plan header's Docs written ahead names, line by line, against the landed code:

- `docs/features/workflow/design.md` § Large's stages (the report, the file path and shape, `plan.py`'s commands,
  the tool's refusal, the moved-copy rule, no deletion), § Signals (`planReported`, "All five"), § Decisions ("A
  reported copy, not a guessed one", "One plan reader").
- `docs/features/workflow-levels/design.md` (Large's checklist line).
- `docs/features/backlog/design.md` § Plans and features (the moved copy).
- `AGENTS.md`: the `workflow-large/` line and the `plan-copies.ts` line.
- marketplace `plugins/wigley/skills/make/SKILL.md` step 1.7: the tool name, the argument name `folder`, and the
  `plan.py` report.

Fix each stale line. Grep both repos for `newestPlanCopy` and "newest copy": no hit may remain outside a Run log.

Done when: every named doc agrees with the code; the grep finds nothing.
Commit:    one commit per repo, only when a line changed

## Proof

