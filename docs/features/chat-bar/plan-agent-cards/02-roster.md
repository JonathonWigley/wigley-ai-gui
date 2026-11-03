# 02 — Roster: running items only, kind, context, owner name

Status: not started
Type: Task
Wave: 2 · Depends on: 01
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/agents/contract.ts` · modify `src/plugins/agents/roster.ts` ·
           modify `src/plugins/agents/main/preview.ts` · modify `src/plugins/agent-lines/page/running-work.ts` ·
           test `src/plugins/agents/roster.test.ts` · test `src/plugins/agents/main/start.test.ts` ·
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
- Rewrite the file comments in `contract.ts` and `roster.ts` that describe failed items staying until a message.
- `agents/main/preview.ts`: drop the outcomes, give the samples the new fields (one background agent, one context at
  166_000 of 200_000, one task owned by a sample subagent).
- `agent-lines/page/running-work.ts`: drop its `outcome === 'running'` filters; the roster lists only running items.
GIVEN a running subagent WHEN `agentFinished` with outcome failed arrives THEN the roster no longer lists it
GIVEN a running task WHEN `taskFinished` failed arrives THEN the roster no longer lists it
GIVEN a roster with agents and tasks WHEN `sessionEnded` arrives THEN both lists are empty
GIVEN a roster with agents WHEN `userMessage` arrives THEN the fold returns the same roster object
GIVEN a listed subagent WHEN `agentLaunched` for it arrives THEN `isBackground` is true
GIVEN a subagent named `kind-fixer` WHEN it starts a task THEN the task's `ownerName` is `kind-fixer`, and stays so after the subagent finishes
GIVEN a subagent WHEN `agentReplied` with contextTokens 84000 and contextWindow 200000 arrives THEN the agent holds both
Tests:     replace the failed-stays and message-drops rows in `roster.test.ts` with the rows above; update
           `start.test.ts`, `rosters.test.ts`, `running-work.test.ts` and `working-lines.test.ts` fixtures to the
           new shapes (no `outcome` on agents or tasks)
Done when: `npm run typecheck`, `npm run lint` and `npx vitest run src/plugins/agents src/plugins/agent-lines` pass
           (agent-strip may fail to compile until 03; typecheck is proved at 03 if so — record it in the Proof)
Commit:    one commit for the group

## Proof
