# 04 — Doc re-read

Status: not started
Type: Task
Wave: 2 · Depends on: 01, 02
Plan: [plan.md](plan.md)

Files:     each doc written ahead, by path (all modify):
           wigley-agents: `workflows.md` · `decisions.md` · `AGENTS.md` · `tools/workflow-gate/README.md`
           wigley-ai-marketplace: `plugins/wigley/skills/spike/SKILL.md` · `plugins/wigley/skills/wrap-up/SKILL.md` · `plugins/wigley/skills/feature/SKILL.md`
           wigley-ai-gui: `docs/features/workflow-levels/design.md` · `docs/features/workflow/design.md` · `docs/features/layouts/design.md` · `AGENTS.md` · `DESIGN.md`
Consumes:  the landed code of 01 and 02
Produces:  every line of the docs above true against the landed code
Decisions: read each doc line by line against the landed code (`wigley:writing-for-agents` § Doctrine before code). Check these claims by name:
           - the step words in `wigley:spike` § Reporting equal the `reportedAs` words of the five Spike stages
           - the gate README's level-skill list equals `LEVEL_SKILLS`
           - the gui `AGENTS.md` plugin tree entry names the files task 02 created, and its self-test path exists
           - `DESIGN.md` names the badge `X` and the token default task 02 shipped
           - `workflow-levels/design.md` says the stages loop, and the stage rules task 02 shipped allow it
           - `workflow/design.md` § Spike's stages matches each stage's `enter`, and its claim, order and step-word lines match the plugin
Done when: every stale line is fixed; `python3 scripts/check_pointers.py` passes in the marketplace worktree
Commit:    one commit per repo that changed. A marketplace fix lands before task 03's bump, which runs after this task.

## Proof
