# 11 — Doc re-read

Status: not started
Type: Task
Wave: 9 · Depends on: 10
Plan: [plan.md](plan.md)

Each doc written ahead is a hypothesis until this task (`wigley:writing-for-agents` § Doctrine before code). Read each one line by line against the landed code on its `workflow-levels` branch. Fix every stale line, and commit the fixes. Use the worktrees, because `~/wigley-agents` and the clones do not hold these files until task 12 lands them.

Worktrees: `~/Documents/ai-dev/.worktrees/wigley-agents-workflow-levels/`, `~/Documents/ai-dev/.worktrees/wigley-ai-marketplace-workflow-levels/`, `~/Documents/ai-dev/.worktrees/wigley-ai-gui-workflow-levels/`.

Files:     modify, only for a stale line: wigley-agents `workflows.md`, `AGENTS.md` · wigley-ai-marketplace `plugins/wigley/skills/light/SKILL.md`, `plugins/wigley/skills/medium/SKILL.md`, `plugins/wigley/skills/feature/SKILL.md` (its `description` only) · wigley-ai-gui `docs/features/workflow-levels/design.md`

Consumes:  `MainWorkflow`, `WorkflowMainExports.addWorkflow`, `claims`, `firstStage` ← 01 · `createWorkflowDraw`, the badge and the `No workflow` tag ← 02 · `SET_WORKFLOW_CHECKLIST_TOOL`, the scoped `set_workflow_step` and the session note ← 03 · `runs.jsonl` and its keys ← 04 · `workflow-heavy` ← 05 · `workflow-light` ← 07 · `workflow-medium` ← 08 · `tools/workflow-gate/workflow-gate` ← 09 · the doc changes ← 10

Produces:  no new name. Each doc's verdict in this document's Proof: the path, then `no change` or the lines fixed.

Decisions: each doc's lines are checked against the source named here. A line this list does not name is still read and checked against the code it describes.

- **`workflows.md`** (wigley-agents):
  - The table's steps against the page stages' labels in `src/plugins/workflow-light/stages/*/page.ts` and `src/plugins/workflow-medium/stages/*/page.ts`, in order.
  - Its skills against each plugin's `claims`, and against `LEVEL_SKILLS` in `tools/workflow-gate/workflow-gate`.
  - "The skill's start is what the app and the edit gate read" against both of those.
  - "a session that only answers loads `wigley:light` too" against the gate and against task 07's Scope to `done`.
  - "Another skill … runs inside the level" against the claims: `wigley:debug`, `wigley:explore` and `wigley:review` claim nothing.
- **`AGENTS.md`** (wigley-agents): the Contents line and the Required reads row, against `workflows.md`'s path.
- **`plugins/wigley/skills/light/SKILL.md`:**
  - `step` values `build`, `check`, `land`, `done` against the `reportedAs` values in `workflow-light`.
  - "The skill's start already shows Scope" against `firstStage`.
  - `set_workflow_checklist`'s `items`, `text` and `done`, and "the whole list each time", against `workflow/main/checklist-tool.ts`.
  - "which its session note says" against the session note task 03 landed.
  - The pointers: `wigley:writing-tests` § Picking tests for a gate, `~/wigley-agents/workflows.md` § Moving between levels, `~/wigley-agents/AGENTS.md` § Git, `~/wigley-agents/WigleyRepos.md` § Landing.
  - § A session that only answers: "Report `done` with the answer, so the trail goes from Scope straight to its end" against task 07's `done` rule and the drawn trail.
- **`plugins/wigley/skills/medium/SKILL.md`:**
  - `step` values `build`, `review`, `fix`, `land`, `done`, and "Steps may move back", against `workflow-medium`.
  - "The skill's start already shows Interview" against `firstStage`.
  - The pointers: `../feature/SKILL.md` § The interview and its Design review, `wigley:make` § Commits and § The test gate, `wigley:review`'s `triage.md`, `correctness.md` and `reporting.md`, the `wigley:reader-opus` agent.
  - What Fix does with a second review against `fixCycles` in `workflow-medium`.
- **The `description` of `plugins/wigley/skills/feature/SKILL.md`:** "Heavy" against `workflows.md`.
- **`docs/features/workflow-levels/design.md`** (wigley-ai-gui):
  - The Shape tree, the `layouts/workflow-light/` path, and the part hosts against the plugins as landed.
  - "Only the flow's current workflow folds its stage rules" against the fold in `workflow/flow.ts`.
  - § How the app learns against `set_workflow_step` and `set_workflow_checklist` as landed.
  - § Where it draws against the row, composer and side parts. "beside the stage text" and "one letter, L, M or H, in the level's colour, with the full word in its tooltip" against `PageWorkflow.badge`, `PageWorkflow.label` and the theme tokens.
  - § The run log against the pinned keys `at`, `sessionId`, `projectDir`, `workflow`, `movedUpFrom`, `activeMs`, `costUsd`, `fixCycles`.
  - **A stale line known now.** § Decisions says "Sessions outside the app draw nothing. A tool call with the app closed would start the app, so only the note in app-started sessions tells an agent to call the tools." That holds for Light and Medium. `wigley:feature` and `wigley:make` call `set_workflow_step` on any host that has the tool (`wigley:feature` § Reporting the step), and Heavy's skills do not change here. Fix the line to say so, and say that a terminal Heavy run can start a closed app.
- **Fix the doc, not the code.** A doc line the code contradicts is a doc fix, unless the code contradicts `plan.md`. That goes to a Run log ruling.
- **Edits** to these files follow `wigley:writing-for-agents`. A skill fix needs no version bump here: the series bumps once, in task 12.

GIVEN a doc line that names a step, skill, tool, key, path or section WHEN the implementer checks it against its source THEN the line matches, or it is fixed in this task

Tests:     none: the doc checks are reads. The commands below return the pinned values: Also `command grep -c 'closed app' docs/features/workflow-levels/design.md` is 1 or more, because that is the one stale line known at plan time.
           `command grep -c 'plan.md' <wigley-ai-gui worktree>/docs/features/workflow-levels/design.md` — the count is 1 or more: Heavy's checklist line stays
           `command grep -n 'set_workflow_step' <wigley-ai-gui worktree>/docs/features/workflow-levels/design.md` — a line names `wigley:feature` or Heavy as the skills that call it from a terminal

Done when: every doc above has its verdict in Proof; `python3 scripts/check_pointers.py` passes from the marketplace worktree's root when a marketplace skill changed.

Commit:    one commit per repo that changed, on its `workflow-levels` branch, by pathspec. No commit in a repo with no fix.

## Proof

