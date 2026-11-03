# 10 — Doc re-read

Status: not started
Type: Task
Wave: 6 · Depends on: 01, 02, 03, 04, 05, 06, 07, 08, 09
Plan: [plan.md](plan.md)

Files:     modify `docs/features/chat-bar/design.md` · `AGENTS.md` · `DESIGN.md` · `docs/features/plugin-framework/design.md`
           · `docs/features/layouts/design.md` · `docs/features/usage/design.md` · `docs/features/agent-tower/design.md`
           · `docs/features/agent-chat/design.md`
Consumes:  the landed code of 01–09
Produces:  docs that match the landed code
Decisions: the docs written ahead are hypotheses (`wigley:writing-for-agents` § Doctrine before code) · the agent-tower
           and agent-chat edits were left to this task because another plan edited those docs at plan time

Steps:

1. Read each doc written ahead (plan.md § Docs written ahead) line by line against the landed code. Fix every line the
   code contradicts: a name, an id (the camelCase ids when task 01 ruled them), a key, a part name, an order, a
   default.
2. `docs/features/agent-tower/design.md`: § Status and § The agents plugin, Page — the agents page draws nothing and
   exports the rosters; the lines are the `agent-lines` plugin, in `plugins.disabled` by default; the roster keeps
   finished items until the next `userMessage`. § Agent events — the new fields on `agentSpawned`, `toolStarted` and
   `taskStarted`, and the `agentReplied` row. § Vocabulary, Roster — its new contents.
3. `docs/features/agent-chat/design.md`: the Chat tab line that names "the box's vim mode" and the control chips —
   the status line replaces the bar, and the cursor shape shows the mode.
4. `docs/features/layouts/design.md`: the previews table row for `Space z l a` when the preview changed.
5. Grep the repo's docs for the old names and fix each hit: `composerBar`, `modeLabel`, `RunningAgent`,
   `RunningTask`, `subagent lines` naming the agents plugin as their drawer.

GIVEN the landed code WHEN each doc line is read against it THEN no line states a name, key, order or default the
code does not hold.
Tests:     none (docs only).
Done when: every doc above is re-read and its stale lines fixed; the grep in step 5 finds no stale use.
Commit:    one commit, the doc paths only, by name.

## Proof
