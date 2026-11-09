# 01 — Gate accepts wigley:spike

Status: not started
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Repo:      wigley-agents, worktree `~/Documents/ai-dev/.worktrees/wigley-agents-spike-level`
Files:     modify `tools/workflow-gate/workflow-gate` · test `tools/workflow-gate/tests/test_workflow_gate.py`
Consumes:  none
Produces:  `LEVEL_SKILLS` holds `"wigley:spike"` and `"spike"` in `tools/workflow-gate/workflow-gate`
Decisions: Spike is a level skill like the others (round 1, Q6) · the denial names Spike first, since it is first in the `workflows.md` table
Pinned:    the `DENIAL` text changes one phrase only: `load its skill: wigley:small, wigley:medium or wigley:feature` becomes `load its skill: wigley:spike, wigley:small, wigley:medium or wigley:feature`. The rest of the string stays.
GIVEN a main-agent transcript whose only level skill is `wigley:spike` (a Skill call, or a typed `/wigley:spike`, or a typed bare `/spike`) WHEN the hook runs THEN it passes
Tests:     add `"wigley:spike"` and `"spike"` to the skill tuple of `level_rows` in `GateDecision.test_table` (lines 76–86, measured at plan time, re-verify) · add a typed `/wigley:spike` row and a typed bare `/spike` row, each expecting `pass`, beside the table's existing typed-skill and typed-bare-name rows · update the expected `DENIAL` string in the test file to the pinned text
Done when: `cd tools/workflow-gate && python3 -m unittest discover -s tests` passes
Commit:    one commit for the group

## Proof
