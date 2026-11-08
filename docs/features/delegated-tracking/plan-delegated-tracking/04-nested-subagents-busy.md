# 04 — Nested subagents keep a session busy

Status: not started
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/workflow/main/agent-signals.ts` · modify `src/plugins/workflow/contract.ts` (two comments) ·
           test `src/plugins/workflow/flow.test.ts` ·
           test `src/plugins/workflow/main/agent-signals.test.ts`

Reads:     `AGENTS.md` § Architecture, the bullets "An agent event" and "An event", and the src tree entry `workflow/`.
           `docs/features/workflow/design.md` § Signals, the row "subagent started, finished" (already updated), and
           § Heavy's stages, the line "Running means the flow is busy: a turn or a subagent at any depth runs".

Consumes:  `signalOf(event: AgentEvent, flow: SessionFlow, fromCurrentHost: boolean): WorkflowSignal[]` in
           `agent-signals.ts`, which the tree holds · `SessionFlow.runningSubagents: readonly string[]` in
           `src/plugins/workflow/contract.ts`, which the tree holds

Produces:  no new signature. `signalOf` returns `[{ type: 'subagentStarted', agentId: event.agentId }]` for every
           `agentSpawned`, whatever its `parentAgentId`.

Decisions:
- `signalOf`, case `agentSpawned`: today it gives `subagentStarted` only when `event.parentAgentId === MAIN_AGENT_ID`
  (`agent-signals.ts`, line 34). After the change it gives `subagentStarted` for every `agentSpawned`, so the flow is
  busy while a subagent at any depth runs (round 1 notice).
- `signalOf`, case `agentFinished`, does not change: it gives `subagentFinished` only for an id in
  `flow.runningSubagents`. A nested id is now in that list, so its finish is now a signal.
- `signalOf`, case `sessionEnded`, does not change: it already maps every id in `flow.runningSubagents` to a
  `subagentFinished`. The list now holds nested ids too, so the path covers them with no edit (verified at plan time).
- The fold (`src/plugins/workflow/flow.ts`, cases `subagentStarted` and `subagentFinished`) does not change: it skips an
  id already in the list, and it removes one id per finish.
- A foreground nested call ends with its parent: the Claude decoder's `finishAgent`
  (`src/main/claude-code/stream-decoder.ts`) emits `agentFinished` for the ending agent and then for every Agent call
  still pending under it (verified at plan time). A launched background nested subagent is in `launchedAgents`, not
  `pendingAgents`, so it runs until its own end event, as a main-level launched subagent does today. When that event
  never comes, the flow stays busy until `sessionEnded`, the same edge a main-level launched subagent has. Nothing in
  this task changes the decoder.
- Readers of `runningSubagents` see nested ids from now on. `isBusy` (`workflow/contract.ts`) is the goal.
  `auto-compact/main/agent-wait.ts` waits until the list is empty, so its wait now also covers nested subagents. A
  nested subagent ends before its parent in the normal case, so that wait does not grow. No change there.
- Change the comment on `subagentStarted` in `src/plugins/workflow/contract.ts` (today: `From agentSpawned with
  parentAgentId MAIN_AGENT_ID.`) to say it comes from `agentSpawned` of any agent, a subagent's own included.
- Change the comment on `isBusy` in `src/plugins/workflow/contract.ts` (today: `A flow is busy while a turn runs or a
  main-agent subagent runs …`) to say a subagent at any depth.
- The comment on the `agentSpawned` case in `agent-signals.ts`, if any is added, says the same.

GIVEN a flow with subagent `a1` running WHEN an `agentSpawned` arrives with `agentId: 'a2'` and `parentAgentId: 'a1'`
THEN `signalOf` returns `[{ type: 'subagentStarted', agentId: 'a2' }]`.
GIVEN a flow with `a1` and `a2` running WHEN an `agentFinished` arrives for `a2` THEN `signalOf` returns
`[{ type: 'subagentFinished', agentId: 'a2' }]`.
GIVEN a flow with `a1` and its nested `a2` running WHEN a `sessionEnded` from the current host arrives THEN `signalOf`
returns a `subagentFinished` for `a1`, then for `a2`, then `turnEnded` (the existing row already holds this case).

Tests:     rows in the existing `it.each(ROWS)` of `describe('signalOf')` in `agent-signals.test.ts`:
- change the row `a subagent's own agentSpawned gives nothing` to `a subagent's own agentSpawned starts a subagent`,
  with expected `[{ type: 'subagentStarted', agentId: 'a2' }]`. Break caught: the depth check left in, so the flow
  reads as paused while a nested subagent runs.
- `src/plugins/workflow/flow.test.ts`, new `nestedSubagents_SpawnAndFinish_BusyUntilTheLastEnds`: fold the signals
  `signalOf` gives for spawn a1 (parent main), spawn a2 (parent a1), finish a2, finish a1, with no turn running. After
  a2 finishes, `runningSubagents` is `['a1']` and `isBusy` is true; after a1 finishes, the list is empty and `isBusy`
  is false. Break caught: a nested spawn dropped, or a finish that clears the whole list.
- keep the row `sessionEnded from the current host ends subagents, then the turn` as it is: its `running('a1', 'a2')`
  already pins that every listed id ends, nested ones included.

Done when: the code compiles; the test gate runs `agent-signals.test.ts`. No live check: the rows pin the rule.
Commit:    one commit for the group

## Proof

