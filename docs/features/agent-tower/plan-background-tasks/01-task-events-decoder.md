# 01 — Task events in the contract and the Claude decoder

Status: done
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     modify `src/contracts/agent.ts` · modify `src/main/claude-code/stream-decoder.ts` ·
           modify `src/plugins/agents/roster.ts` · test `src/main/claude-code/stream-decoder.test.ts`
Consumes:  nothing
Produces:  in `src/contracts/agent.ts`, two `AgentEvent` members:
           `{ type: 'taskStarted'; at: number; taskId: string; agentId: string; description: string }`
           `{ type: 'taskFinished'; at: number; taskId: string; outcome: 'done' | 'failed' }`
           in `src/plugins/agents/roster.ts`, `case 'taskStarted':` and `case 'taskFinished':` returning `running`
           unchanged (02 replaces them)
Decisions:
- Each member gets a doc comment in the file's style: a process an agent started that runs apart from its turn;
  `agentId` is the agent that started it (`MAIN_AGENT_ID` or a subagent's id); a task outlives its turn and its
  agent, and ends only on its own `taskFinished` or the session's `sessionEnded`.
- `decodeSystem` handles `task_started`: when `task_type` is `local_agent`, keep `task_id` → `tool_use_id` (the Agent
  call id, which is the subagent's agent id) in a new map; when `task_type` is any other non-empty string, emit
  `taskStarted` with `taskId` `task_id`, `description` `description`, and `agentId` the map's entry for
  `parent_task_id`; when `parent_task_id` is absent, or present but not in the map, `agentId` is `MAIN_AGENT_ID` (the
  task still shows, at the top level). When `task_type` is missing or empty, emit nothing. Keep each started task id
  in a set; a repeated `task_started` for an id already in the set emits no second `taskStarted`.
- `task_notification` keeps calling `finishByNotification` for Agent calls as now, and also, when `task_id` is in the
  started set, emits `taskFinished` (`status` `completed` → `done`, any other → `failed`) and forgets the id. A
  notification for an unknown task id emits no `taskFinished`.
- Neither a `result` (`failPendingAgents`) nor `finishAgent` emits `taskFinished`. The local_agent map entry may stay
  after its subagent ends, so a task started later by a finished subagent's id still names its owner.
- Both subtypes still push their raw entry as today (`rawEntry`), so the chat transcript is unchanged.
- `at` is stamped wherever the decoder's other agent events get theirs; follow the existing path.
- The `workflow` plugin's `signalOf` has a `default` branch, so it needs no case.
GIVEN a main-agent `task_started` (`local_bash`, no parent) WHEN decoded THEN one `taskStarted` with `agentId` `main`
GIVEN a subagent's `local_agent` `task_started` and then a `local_bash` one whose `parent_task_id` is its `task_id`
  WHEN decoded THEN the `taskStarted` names the Agent call id as `agentId`
GIVEN a started task and then a turn's `result` WHEN decoded THEN no `taskFinished`; its `task_notification` later
  emits one
Tests:     rows added to the decoder's existing table of agent-event cases in `stream-decoder.test.ts`, built on new
           `taskStarted(...)` / extended `taskNotification(taskId, toolUseId, status)` line helpers shaped after
           `claude-stream.md`:
           `main background task start and end` — taskStarted main, then taskFinished done on `completed`
           `subagent task names its subagent` — agentId is the Agent call id
           `failed task`, `stopped task`, `killed task` — `status` `failed` / `stopped` / `killed` each give outcome
           failed
           `subagent task_started starts no task` — `local_agent` emits no taskStarted
           `task with no type starts nothing` — missing `task_type` emits nothing
           `task with an unknown parent` — `parent_task_id` no `local_agent` start named gives agentId `main`
           `task outlives the turn's result` — result between start and end emits no taskFinished
           `notification for an unknown task` — emits no taskFinished
           `repeated start and notification` — start, start, notify, notify gives one taskStarted, one taskFinished
           The existing `taskNotification(toolUseId, status)` helper gains a third parameter `taskId`, defaulting to
           today's fixed `'a4e45e22d2e0fef8f'`, so existing rows keep passing unedited.
Done when: `npm run typecheck` passes; the test gate runs `stream-decoder.test.ts`
Commit:    one commit for the group

## Proof

Commit 533539e · proof: diff read (both AgentEvent members, roster cases present); typecheck pass; worker ran lint and stream-decoder.test.ts (81 pass) · concerns: AGENTS.md agent-event bullet left as an example list; at stamped by the harness via AgentEventDraft, no decoder change
