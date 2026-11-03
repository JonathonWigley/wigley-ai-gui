# 04 — Doc re-read

Status: in progress
Type: Task
Wave: 3 · Depends on: 01, 02, 03
Plan: [plan.md](plan.md)

Files:     modify as needed `docs/features/agent-tower/design.md` · `docs/features/agent-chat/claude-stream.md` ·
           `AGENTS.md` · `docs/features/layouts/design.md` · `DESIGN.md` ·
           modify `docs/features/visuals/plan-visuals/01-fence-registry-and-mount.md`
Consumes:  the landed code of 01–03
Produces:  docs true to the landed code
Decisions:
- Re-read `docs/features/agent-tower/design.md` (§ Status, § Vocabulary, § Agent events, § The agents plugin) and the
  `claude-stream.md` task lines (§ Subagents) line by line against the landed code; fix every stale line.
- Lines known stale at plan time (re-verify each; numbers move): `AGENTS.md` ~170 and ~304 ("running subagent
  lines", "the agents plugin's subagent lines") and its agent event list near ~472; `docs/features/layouts/design.md`
  ~89 ("the running subagent lines under each session row") and ~108 (the `Space z l a` row: "two running
  subagents", now two subagents and two tasks); `DESIGN.md`'s agents lines sentence, against what 02 landed. Run
  `grep -rn "subagent line\|subagentLines\|subagent-lines" AGENTS.md DESIGN.md docs` for any other.
- `docs/features/visuals/plan-visuals/01-fence-registry-and-mount.md` line ~21 names
  `src/plugins/agents/page/subagent-lines.test.ts`, which 02 moved: change it to `roster-lines.test.ts`. That plan
  belongs to another run, so edit only that path and commit it by name.
- `wigley:writing-for-agents` applies to every edit.
Done when: every stale line is fixed and committed, or the re-read found none and says so
Commit:    one commit for the group, naming only these paths (`git commit -- <paths>`): another session may have
           uncommitted edits in this tree

## Proof
