# 11 — Doc re-read

Status: not started
Type: Task
Wave: 6 · Depends on: every code task (01–10)
Plan: [plan.md](plan.md)

Files:     modify `docs/features/workflow/design.md` · `AGENTS.md` · `docs/keymap.md` · `docs/features/layouts/design.md` ·
           `docs/features/agent-tower/design.md`
Consumes:  the landed code of 01–10
Produces:  each doc written ahead agrees with the landed code
Decisions: these docs were written before the code (commit `22dfcf9`), so each is a hypothesis
           (`wigley:writing-for-agents` § Doctrine before code).

Read each doc line by line against the landed code:

- `docs/features/workflow/design.md` — every stage's entry rule, display and actions against `stages/*/`; the signal
  table against main's mapping of `chat.agentEvent` and the sessions events; § Where it draws against the page part
  and the layout contract; § Auto-start against main's countdown and the two settings' names and defaults; § Keys
  against `src/plugins/keymap.ts`; § Stage modules against `addStage`, `foldFlow` and `stages/index.ts`.
- `AGENTS.md` — the `workflow/` entry in the plugin list against the folder as built (every file and folder it names
  exists, and every folder the plugin has is named); the "A composer part" bullet against chat's `addComposerPart`.
- `docs/keymap.md` — the `w` row against the binds.
- `docs/features/layouts/design.md` — the `workflow` owner row against the Layout contract's parts; the
  `Space z l w` row against the preview.
- `docs/features/agent-tower/design.md` — the three new event rows against `AgentEvent`.

Fix every stale line in the doc, never the code. A line whose code is missing is a concern for the review.

GIVEN the landed code WHEN each doc is read THEN every fact in it is true of the code.
Tests:     none: prose only.
Done when: every line is checked and every stale line is fixed.
Commit:    one commit, `Workflow docs: re-read against the landed plugin`, pathspec-scoped to the five docs.

## Proof
