# 02 — Roster: running items only, kind, context, owner name

Status: not started
Type: Task
Wave: 2 · Depends on: 01
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/agents/contract.ts` · modify `src/plugins/agents/roster.ts` ·
           modify `src/plugins/agents/main/preview.ts` · modify `src/plugins/agents/main/start.ts` ·
           modify `src/plugins/agent-lines/page/running-work.ts` · modify `src/plugins/agent-lines/main/selftest-script.ts` ·
           test `src/plugins/agents/roster.test.ts` · test `src/plugins/agents/main/start.test.ts` ·
           test `src/plugins/agents/main/preview.test.ts` ·
           test `src/plugins/agents/page/rosters.test.ts` · test `src/plugins/agent-lines/page/running-work.test.ts` ·
           test `src/plugins/agent-lines/page/working-lines.test.ts`
Consumes:  `agentReplied { …, contextTokens, contextWindow }` and `agentLaunched { agentId }` ← 01
Produces:  in `src/plugins/agents/contract.ts`:
           `RosterAgent` = today's fields without `outcome`, plus `isBackground: boolean; contextTokens: number | null; contextWindow: number | null`
           `RosterTask` = today's fields without `outcome`, plus `ownerName: string`
           `RosterTool` and `RosterOutcome` unchanged
Decisions:
- Every listed agent and task is running. `agentFinished` (done or failed) and `taskFinished` (done or failed) remove
  the item. `sessionEnded` returns `{ agents: [], tasks: [] }` (the same object when both are already empty).
  `userMessage` returns `roster` unchanged. Remove `failEveryRunningItem`, `dropFinishedItems`, `failIfRunning`
  where they become unused.
- `agentSpawned` sets `isBackground: false`, `contextTokens: null`, `contextWindow: null`. `agentLaunched` sets
  `isBackground: true` (same object when already true or the agent is unlisted).
- `agentReplied` stores `model`, `spendUsd`, `contextTokens`, `contextWindow`; returns the same agent when all four
  are unchanged.
- `toolStarted` no longer checks the agent's outcome (every listed agent runs).
- `taskStarted` sets `ownerName`: `main` for `MAIN_AGENT_ID`, else the listed agent's `name`, else `subagent` (a task
  whose owner was never listed).
- Rewrite the comments that describe failed or finished items staying until a message: `contract.ts` (the roster
  types and the `AgentsChannel` comment: "finished ones included", "once a message drops its last finished item"),
  `roster.ts`, and `agents/main/start.ts` (its header and "A message drops every host's finished items").
- `agents/main/start.ts`: remove the `userMessage` fan-out into every host id's roster
  (`event.type === 'userMessage' ? [...hosts.keys()]`); the fold ignores `userMessage`, so the event folds into its
  own host only, like every other event.
- `agents/main/preview.ts` samples: `preview-agent-1` subagent, context 84_000 of 200_000; `preview-agent-2`
  background (`isBackground: true`), context 166_000 of 200_000; `preview-task-1` `ownerName: 'main'`;
  `preview-task-2` owned by `preview-agent-2`, `ownerName` its name (`Explore`). Every outcome on agents and tasks
  removed; tool outcomes kept. `preview.test.ts` asserts these values.
- `agent-lines/page/running-work.ts`: drop its `outcome === 'running'` filters; the roster lists only running items.
  `agent-lines/main/selftest-script.ts`: reword the `why` that says the roster "marks them finished" to say an
  interrupt ends the items and their lines leave.
GIVEN a running subagent WHEN `agentFinished` with outcome failed arrives THEN the roster no longer lists it
GIVEN a running task WHEN `taskFinished` failed arrives THEN the roster no longer lists it
GIVEN a roster with agents and tasks WHEN `sessionEnded` arrives THEN both lists are empty
GIVEN a roster with agents WHEN `userMessage` arrives THEN the fold returns the same roster object
GIVEN a listed subagent WHEN `agentLaunched` for it arrives THEN `isBackground` is true
GIVEN a subagent named `kind-fixer` WHEN it starts a task THEN the task's `ownerName` is `kind-fixer`, and stays so after the subagent finishes
GIVEN a subagent WHEN `agentReplied` with contextTokens 84000 and contextWindow 200000 arrives THEN the agent holds both
Tests:     replace the failed-stays and message-drops rows in `roster.test.ts` with the rows above.
           `start.test.ts`, rewritten rows: "a failed agent stays listed until the next message" becomes
           `[spawned, failed]` sending `[runningA]` then `[]`; "a row's old process ending fails only its own
           subagents" becomes `[spawned, {CLEARED_HOST: spawnedB}, sessionEnded]` sending `[runningA]`,
           `[runningA, runningB]`, `[runningB]`, with rosters `{ s1: [runningB] }`; "a message drops a cleared host's
           finished items" becomes one row proving a `userMessage` sends nothing; `failedA` fixtures removed.
           `preview.test.ts` asserts the sample values above. `rosters.test.ts`, `running-work.test.ts` and
           `working-lines.test.ts` fixtures move to the new shapes (no `outcome` on agents or tasks)
Done when: `npm run typecheck`, `npm run lint` and `npx vitest run src/plugins/agents src/plugins/agent-lines` pass
           (agent-strip may fail to compile until 03; typecheck is proved at 03 if so — record it in the Proof)
Commit:    one commit for the group

## Proof
