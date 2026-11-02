# 03 — The fake harness runs tasks

Status: not started
Type: Task
Wave: 2 · Depends on: 01
Plan: [plan.md](plan.md)

Files:     modify `src/shared/fake-agent-harness.ts` · test `src/shared/fake-agent-harness.test.ts`
Consumes:  `taskStarted` / `taskFinished` in `AgentEvent` ← 01
Produces:  `FAKE_AGENTS_TEXT`'s turn emits two `taskStarted` events at the end of its existing event sequence, and
           an interrupt emits a `taskFinished` for each task still running
Decisions:
- The two tasks, in this order: `{ taskId: 'fake-task-<turn>-1', agentId: MAIN_AGENT_ID, description: 'Run the
  self-test' }` and `{ taskId: 'fake-task-<turn>-2', agentId: 'fake-agent-<turn>-1', description: 'Watch the build' }`.
  Both come after the whole existing agents-turn sequence (after the subagents' tool pairs), so the existing ordered
  array only gains a tail. `at` is `clock.now()`, as every other fake event.
- The process keeps its running tasks beside `runningSubagents`. On an interrupt, each running task gets
  `taskFinished` with outcome `failed`, in start order, before the subagents' first finish event (their Agent
  entries' `tool … Interrupted` lines and `agentFinished`). The next send's `finishSubagents` leaves tasks running,
  as the decoder leaves a real task past a turn end; a later agents send adds two more tasks with that turn's ids. The
  process ending needs no extra event: `sessionEnded` already clears a roster.
- Events only: the fake emits no Bash tool entry for a task.
- Update `FAKE_AGENTS_TEXT`'s comment to say the turn also starts the two tasks, the next send leaves them running and
  an interrupt ends them; say there that real Claude may keep a background Bash past an interrupt and the fake ends it
  to keep the self-test row's count exact. Add `taskStarted` / `taskFinished` to the file's header comment that lists
  the events a process emits.
GIVEN the agents text sent WHEN its turn runs THEN two `taskStarted` close its event sequence, owned by `main` and by
  the first subagent
GIVEN that turn running WHEN interrupted THEN each task's `taskFinished` (failed), in start order, comes before the
  subagents' finish events
GIVEN that turn running WHEN the next message is sent THEN no `taskFinished` is emitted
Tests:     in `fake-agent-harness.test.ts`: `timelineLine` prints a task event's `taskId` (`taskStarted fake-task-1-1
           main`, `taskFinished fake-task-1-1 failed`) so two finishes read apart. Extend
           `send_AgentsText_SpawnsTwoSubagentsAndHoldsTurn` (the full ordered array gains the two `taskStarted` with
           their exact `taskId`s, agentIds and descriptions), the `agentsTurn_$case` rows `interrupt…`,
           `interruptThenEnd…` and `interruptThenKill…` (two `taskFinished … failed` lines, `fake-task-1-1` then
           `fake-task-1-2`, before the first subagent finish line), and `send_FinishesSubagentsAsDone` (no
           `taskFinished` in its lines).
Done when: `npm run typecheck` passes; the test gate runs
           `fake-agent-harness.test.ts`
Commit:    one commit for the group

## Proof
