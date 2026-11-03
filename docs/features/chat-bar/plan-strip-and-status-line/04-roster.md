# 04 — The roster keeps finished items, tools, model, effort and spend

Status: not started
Type: Task
Wave: 2 · Depends on: 03
Plan: [plan.md](plan.md)

Planned against the background-tasks plan's landed agents plugin in `.claude/worktrees/background-tasks` at
`229ca469`: `Roster { agents: RunningAgent[]; tasks: RunningTask[] }`, `foldAgentEvent` dropping finished items,
main's per-host rosters in `main/start.ts`, the preview's sample, and the page's `roster-line-order.ts` /
`roster-lines.ts`. Re-read them on `main` before starting.

Files:     modify `src/plugins/agents/contract.ts` · modify `src/plugins/agents/roster.ts` ·
           test `src/plugins/agents/roster.test.ts` ·
           modify `src/plugins/agents/main/start.ts` · test `src/plugins/agents/main/start.test.ts` ·
           modify `src/plugins/agents/main/preview.ts` · test `src/plugins/agents/main/preview.test.ts` ·
           modify `src/plugins/agents/main/selftest-script.ts` (the interrupt step's `why` only) ·
           modify `src/plugins/agents/page/roster-line-order.ts` · test `src/plugins/agents/page/roster-line-order.test.ts` ·
           modify `src/plugins/agents/page/roster-lines.ts` · test `src/plugins/agents/page/roster-lines.test.ts` ·
           modify `src/shared/fake-agent-harness.ts` (the `FAKE_AGENTS_TEXT` comment only)
Consumes:  `agentSpawned` (`name`, `model`, `effort`), `agentReplied`, `toolStarted` (`summary`), `taskStarted`
           (`command`) in `AgentEvent` ← 03
           `toolFinished`, `agentFinished`, `taskFinished`, `userMessage`, `sessionEnded` in `AgentEvent` (tree)
Produces:  in `src/plugins/agents/contract.ts` (plan.md § File Structure, exactly; `RunningAgent` and `RunningTask` are
           deleted):
           `export type RosterOutcome = 'running' | 'done' | 'failed';`
           `export interface RosterTool { toolUseId: string; tool: string; summary: string; outcome: RosterOutcome }`
           `export interface RosterAgent { agentId: string; agentType: string; name: string; description: string; startedAt: number; model: string | null; effort: string | null; spendUsd: number | null; tools: RosterTool[]; outcome: RosterOutcome }`
           `export interface RosterTask { taskId: string; agentId: string; description: string; command: string | null; startedAt: number; outcome: RosterOutcome }`
           `export interface Roster { agents: RosterAgent[]; tasks: RosterTask[] }`
           `AgentsChannel` unchanged: `invoke.rosters(): Record<string, Roster>`,
           `messages.rosterChanged: { sessionId: string; roster: Roster }`
           in `src/plugins/agents/roster.ts`: `export function foldAgentEvent(roster: Roster, event: AgentEvent): Roster`
           (signature unchanged)
           in `src/plugins/agents/page/roster-line-order.ts`:
           `export type RosterLine = { kind: 'agent'; agent: RosterAgent } | { kind: 'task'; task: RosterTask; isNested: boolean }`
           `export function orderRosterLines(roster: Roster): RosterLine[]` (signature unchanged)

## Decisions

**The fold** (`foldAgentEvent`). It still returns `roster` itself when the event changes nothing; main's change check
relies on that identity. Lists stay in start order; an item never moves.

| Event | Fold |
|---|---|
| `agentSpawned` | Unless its `agentId` is listed (any outcome): append `{ agentId, agentType, name, description, startedAt: at, model, effort, spendUsd: null, tools: [], outcome: 'running' }`. |
| `agentReplied` | Listed agent: set `model` to the event's `model` and `spendUsd` to its `spendUsd` (replace, not add: the event's spend is cumulative). Same values or unlisted: no change. Applies whatever the agent's outcome, since a reply line may trail its end. |
| `toolStarted` | `agentId` of a listed agent (never `main`) whose `outcome` is `running`: append `{ toolUseId, tool, summary, outcome: 'running' }` to its `tools` unless that `toolUseId` is listed. Else no change: a subagent line that trails the agent's end must not add a running tool nothing will finish. |
| `toolFinished` | That agent's listed tool, while `running`: `outcome` `done` when `ok`, else `failed`. Else no change. |
| `agentFinished` | Listed agent while `running`: `outcome` from the event, and each of its tools still `running` becomes `failed` (the decoder already fails them first; this guards a harness that does not). Its tasks are untouched. Else no change. |
| `taskStarted` | Unless its `taskId` is listed: append `{ taskId, agentId, description, command, startedAt: at, outcome: 'running' }`. |
| `taskFinished` | Listed task while `running`: `outcome` from the event. Else no change. |
| `sessionEnded` | Every `running` agent, every `running` tool of any agent, and every `running` task becomes `failed`. Nothing running: no change. |
| `userMessage` | Drop every agent and every task whose `outcome` is not `running`. A running agent keeps all its tools, finished ones included. A running task stays even when the agent that owns it is dropped. Nothing finished: no change. |
| every other event | no change |

**Every tool call is kept** (the user's answer, 2026-11-02).
`tools` holds every tool call of the agent, unbounded, because the open box lists every tool call (plan.md Design
Overview) and the line's count is `tools.length`. Each `toolStarted` and `toolFinished` then sends `rosterChanged`
with the whole roster, so a subagent with a few hundred calls sends a message of a few hundred small objects per call.
That cost is accepted; say so in a comment on `RosterAgent.tools` in `contract.ts`.

`sessionEnded` marks `failed`, not `done` (agent's decision). Today it drops every item because a process that exits
mid-run sends neither end; now items stay until the next message, so each needs an outcome. The decoder's rule is
that every end other than `completed` is `failed` (`task_notification` `stopped` / `killed`), and an item cut off by
the process's exit did not complete. A finished item keeps the outcome it had.

**Main** (`main/start.ts`). Per-host rosters under a row stay as today, and so does `rowRoster` (agents of every host,
then tasks of every host, each in the order the hosts' rosters began). Changes:

- A `userMessage` folds into every host roster of the row, not only the host that sent it: after a clear, the old
  process's finished items (marked by its `sessionEnded`) must also go on the user's next message, and only the new
  host sends one. A host roster left with both lists empty is dropped, as today; the row is dropped when it has no
  host left. One `rosterChanged` is sent when any host changed.
- Every other event folds into its own host's roster, as today.
- `sessions.closed` / `sessions.ended` still drop the row and send `{ agents: [], tasks: [] }`.
- The file's comments: a host id's roster is dropped once it lists neither (now: once a message drops its last
  finished item); say so.

**Contract comments** (`contract.ts`). Replace the `RunningAgent` / `RunningTask` comments: a `RosterAgent` is a
subagent of a session, running or finished since the user's last message; `startedAt` is its spawn's `at`; `model` is
the model of its latest `agentReplied` (a reply or its launch receipt, task 03), else the spawn's; `spendUsd` is the estimate of its latest reply, null before one or for an
unpriced model; `tools` are its tool calls in start order. A `RosterTask` likewise, `command` null when the harness
named none. `AgentsChannel`'s comment: `rosters` lists every session's roster that lists any item, finished ones
included; `rosterChanged` carries the whole roster after each change, both lists empty once a message drops its last
finished item or the row ends.

**Preview** (`main/preview.ts`). The sample keeps its two agents and two tasks, every item `outcome: 'running'`, so
the self-test's line counts and fit checks stay as they are. New fields:

- `preview-agent-1`: `name: 'map-sessions'`, `model: 'claude-sonnet-5-5'`, `effort: 'medium'`, `spendUsd: 0.0421`,
  `tools: [{ toolUseId: 'preview-agent-1-tool-1', tool: 'Read', summary: 'src/plugins/sessions/contract.ts',
  outcome: 'running' }]`.
- `preview-agent-2`: `name: 'Explore'`, `model: 'claude-haiku-5-5'`, `effort: null`, `spendUsd: 0.0187`, twelve tools
  `preview-agent-2-tool-<n>` for n = 1…12: odd n `{ tool: 'Grep', summary: 'append' }`, even n
  `{ tool: 'Read', summary: 'src/main/files/node-files.ts' }`; n 1–11 `done`, n 12 `running`. The tool count the line
  shows stays 12.
- `preview-task-1`: `command: 'npm run selftest'`; `preview-task-2`: `command: 'npm run test -- --watch src/main/claude-code/stream-decoder.test.ts'`.
- Update the sample's comment ("tool count past 9" now counts `tools`).

**The page keeps today's drawing, running items only** (the smallest edit; task 07 moves the drawing to
`agent-lines`):

- `orderRosterLines` first keeps only items whose `outcome` is `running`, then orders as today. A finished subagent
  draws no line; a running task of a finished subagent draws top-level, as a task of an unlisted agent does today.
  Its comment says it draws running items only.
- `roster-lines.ts`: `toolCalls: line.agent.tools.length` in place of `line.agent.toolCalls`. Nothing else changes;
  `AgentLineInput.toolCalls` in `layout.d.ts` keeps its name and meaning (tool calls started).
- `page/start.ts` is unchanged.
- The self-test interrupt step's `why` becomes: "Interrupt ends each running subagent and task, so the roster marks
  them finished and the page draws no line for them." Its expect line (`lines in agents-selftest: 0`) is unchanged.
- The fake harness's `FAKE_AGENTS_TEXT` comment "the process's end sends no `taskFinished`, since `sessionEnded`
  clears a roster" becomes "…since `sessionEnded` ends a roster's running items".

The design docs that describe the roster (`docs/features/agent-tower/design.md` § The agents plugin) are task 10's.

## GIVEN / WHEN / THEN

- GIVEN a roster with running agent `a` WHEN `agentFinished { a, done }` THEN `a` stays, `outcome: 'done'`.
- GIVEN that roster WHEN `userMessage` THEN `a` is gone; a still-running agent and its finished tools stay.
- GIVEN running agent `a` with a running tool and a running task WHEN `sessionEnded` THEN all three are `failed`.
- GIVEN agent `a` WHEN `agentReplied { a, 'claude-haiku-5-5', 0.0019 }` then `agentReplied { a, …, 0.0042 }` THEN
  `model` is `'claude-haiku-5-5'` and `spendUsd` `0.0042`.
- GIVEN a row cleared (old host `h1` with a failed agent after its `sessionEnded`, new host `h2`) WHEN `h2` sends
  `userMessage` THEN `h1`'s roster is dropped and the row's roster lists only `h2`'s items.
- GIVEN a roster with a done agent and a running task WHEN the page orders lines THEN one top-level task line.

## Tests

- `roster.test.ts`, table `foldAgentEvent_Event_FoldsRoster ($case)`: fixtures become `RosterAgent` / `RosterTask`.
  Rows renamed or added (each catches the fold rule it names):
  `SpawnIntoEmpty` (all new fields, `tools: []`, `spendUsd: null`, `running`), `SpawnOfListedFinishedId` (same),
  `RepliedSetsModelAndSpend`, `RepliedReplacesSpend` (not added), `RepliedSameValues` (same),
  `RepliedOnUnlistedId` (same), `ToolStartedAppendsToItsAgent`, `ToolStartedOnMain` (same),
  `ToolStartedOnFinishedAgent` (same),
  `ToolStartedOnUnlistedId` (same), `ToolStartedOfListedToolId` (same), `ToolFinishedOkIsDone`,
  `ToolFinishedErrorIsFailed`, `ToolFinishedOfFinishedTool` (same), `FinishedMarksOutcome` (agent kept),
  `FinishedFailsItsRunningTools`, `FinishedKeepsItsTask`, `FinishedOfFinishedAgent` (same),
  `TaskStartedCarriesCommand`, `TaskFinishedMarksOutcome` (task kept), `TaskFinishedOnUnlistedId` (same),
  `SessionEndedFailsEveryRunningItem`, `SessionEndedKeepsFinishedOutcomes`, `SessionEndedNothingRunning` (same),
  `UserMessageDropsFinishedAgentsAndTasks`, `UserMessageKeepsRunningAgentsFinishedTools`,
  `UserMessageKeepsRunningTaskOfFinishedAgent` (the done agent goes, its running task stays),
  `UserMessageNothingFinished` (same). The no-change rows for the other events stay, the `UserMessage` row moving to
  the last case.
- `start.test.ts`, the `agentsMainPart` table: fixtures become `RosterAgent` / `RosterTask`. Changed rows:
  "an emptied roster…" becomes "a finished agent stays listed until the next message" (`[spawned, finished,
  userMessage]`: sends the running roster, the done roster, then the empty roster; `rosters` `{}`); "a cleared row's
  old process ending keeps the new process's subagent" and "a row's old process ending drops only its own subagents"
  expect the old host's items `failed`, not gone. New row: "a message drops a cleared host's finished items"
  (`[{ host: CLEARED_HOST, event: spawned }, sessionEnded, userMessage]` from the current host: the last send lists
  nothing of `CLEARED_HOST`). "an event that leaves the roster as it was sends nothing" stays as it is: a message
  over a running-only roster still changes nothing.
- `preview.test.ts`: its sample expectations take the new fields (catches the sample losing a field the strip reads).
- `roster-line-order.test.ts`, the existing table: fixtures become `RosterAgent` / `RosterTask`; new rows
  `FinishedAgentDrawsNoLine`, `FinishedTaskDrawsNoLine`, `RunningTaskOfFinishedAgentIsTopLevel` (catch the page
  drawing finished items before task 07 exists).
- `roster-lines.test.ts`: fixtures take the new shape; `toolCalls` expectations read from `tools.length` (one
  fixture with 12 tools).

Self-test: the agents script's `roster lines` group runs unchanged (counts 4, 4, then 0 after the interrupt) and is
the proof that the page still draws running items only. No new step: what a kept finished item looks like is task
09's strip.

Done when: `npm run typecheck`, `npm test` and `npm run lint` pass; `npm run selftest -- --plugin agents` passes;
`grep -rn "RunningAgent\|RunningTask\|toolCalls: line.agent.toolCalls" src` prints nothing.
Commit:    one commit for the group

## Proof

