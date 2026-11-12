# 09 — Doc re-read

Status: not started
Type: Task
Rung: standard · doc-only: prose checked against landed code
Wave: 6 · Depends on: 08
Plan: [plan.md](plan.md)

Files:     modify `wigley-ai-gui/docs/features/backlog/design.md` · modify `wigley-ai-gui/docs/features/scoped-agents/design.md` · modify `wigley-ai-gui/docs/features/practice/design.md` · modify `wigley-ai-gui/AGENTS.md` · modify `wigley-ai-gui/docs/keymap.md` · modify `wigley-ai-gui/DESIGN.md` · modify `wigley-ai-gui/docs/features/layouts/design.md`
Consumes:  the landed code of 01–08
Produces:  the docs written ahead (and the layouts design doc's owners table, which 03, 04 and 08 edit), true to the code, with every `planned in \`backlog/plan-launcher\`, not built yet` mark removed
Decisions: the docs were written ahead of the code (plan.md § Docs written ahead); each stays the design record of its area
GIVEN a doc line naming a key, setting, default, file, part, tool, log line or behaviour WHEN it is read against the landed code THEN it matches the code, or is rewritten to match
Tests:     none: a doc change picks no test (`wigley:writing-tests` § Picking tests for a gate)
Done when: each of the seven docs is read line by line against the code; every stale line is fixed; `grep -rn "plan-launcher" wigley-ai-gui/docs wigley-ai-gui/AGENTS.md` finds only the plan folder itself; the edits follow `wigley:writing-for-agents`
Commit:    one commit for the group

## Proof
