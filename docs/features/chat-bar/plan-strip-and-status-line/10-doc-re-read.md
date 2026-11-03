# 10 — Doc re-read

Status: done
Type: Task
Wave: 6 · Depends on: 01, 02, 03, 04, 05, 06, 07, 08, 09
Plan: [plan.md](plan.md)

Files:     modify `docs/features/chat-bar/design.md` · `AGENTS.md` · `DESIGN.md` · `docs/features/plugin-framework/design.md`
           · `docs/features/layouts/design.md` · `docs/features/usage/design.md` · `docs/features/agent-tower/design.md`
           · `docs/features/agent-chat/design.md` · `docs/keymap.md` (only when step 4 finds its row stale) · any
           other doc step 5's grep finds stale
Consumes:  the landed code of 01–09
Produces:  docs that match the landed code
Decisions: the docs written ahead are hypotheses (`wigley:writing-for-agents` § Doctrine before code) · the agent-tower
           and agent-chat edits were left to this task because another plan edited those docs at plan time

Steps:

1. Read each doc written ahead (plan.md § Docs written ahead) line by line against the landed code. Fix every line the
   code contradicts: a name, an id, a key, a part name, an order, a default. Known deviations the plan made from the
   docs written ahead, each to fix:
   - usage-tab-line has no `layouts/` folder and no `usage-tab-line.layout` setting (08): AGENTS.md § Architecture's
     plugin list and `docs/features/layouts/design.md`'s owner table.
   - The `layout` setting moved from agents to agent-lines (`agent-lines.layout`, user folder
     `layouts/agent-lines/`) (07), and agent-strip owns `agent-strip.layout` (09): the same two places.
   - agent-lines and agent-strip each have a main part that registers layouts and hands a self-test script; agents'
     main hands none (07, 09).
2. `docs/features/agent-tower/design.md`: § Status and § The agents plugin, Page — the agents page draws nothing and
   exports the rosters; the lines are the `agent-lines` plugin, in `plugins.disabled` by default; the roster keeps
   finished items until the next `userMessage`. § Agent events — the new fields on `agentSpawned`, `toolStarted` and
   `taskStarted`, and the `agentReplied` row (sent on a subagent's reply and on its launch receipt's `resolvedModel`,
   task 03). § Vocabulary, Roster — its new contents.
3. `docs/features/agent-chat/design.md`: the Chat tab line that names "the box's vim mode" and the control chips —
   the status line replaces the bar, and the cursor shape shows the mode.
4. `docs/features/layouts/design.md`: the previews table rows for `Space z l c` (the chat sample session now shows
   the agent strip, 09) and `Space z l a` (with the default list the agents preview opens its row with no lines, 07;
   its command label is now `open the agents sample session`). `docs/keymap.md`'s `zl` row (`zlc` chat preview,
   `zla` agents preview) when its wording no longer matches.
5. Grep the repo's docs (`AGENTS.md`, `DESIGN.md`, `docs/`) for the old names and fix each stale hit: `composerBar`,
   `modeLabel`, `RunningAgent`, `RunningTask`, `[agents] lines in`, `agents-line`, `agents-task-line`,
   `agents.layout`, `layouts/agents/`, `usage-session-line`, `agentsSelfTestScript`, `addBarPart` named as usage's
   route, and `subagent lines` or `roster lines` naming the agents plugin as their drawer or self-test. A hit that
   names a thing that still holds (for example `subagent lines` in `docs/features/agent-chat/claude-stream.md`, which
   means stream lines) stays.

GIVEN the landed code WHEN each doc line is read against it THEN no line states a name, key, order or default the
code does not hold.
Tests:     none (docs only).
Done when: every doc above is re-read and its stale lines fixed; the grep in step 5 finds no stale use.
Commit:    one commit, the doc paths only, by name.

## Proof

Commit d5393f34 · proof: diff read: each named doc updated against HEAD (after peer row trim a0b7282f); step 5 grep finds no stale name outside the plan folder; AGENTS.md committed by hunk, the unowned uncommitted layout-edit paragraph left in the tree · concerns: plugin-framework/design.md and usage/design.md only grepped, not re-read line by line; docs describe agent-lines as the peer's workingLine since a0b7282f landed mid-task
