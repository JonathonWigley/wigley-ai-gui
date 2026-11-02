# 04 — Fake harness emits agent events

Status: done
Type: Batch
Wave: 3 · Depends on: 02, 03 (precondition: the usage plan `docs/features/usage/plan-usage/` has landed; its task 03 gave the fake its `usage` and `planUsage` part)
Plan: [plan.md](plan.md)

Files:     modify `src/shared/fake-agent-harness.ts` · test `src/shared/fake-agent-harness.test.ts` · modify `src/plugins/chat/main/start.ts` (the drive action's description only)
Consumes:  `AgentEvent` (widened), `MAIN_AGENT_ID` ← 02; `AgentProcessEvents.agentEvent` and the fake's `usage` emissions ← the usage plan's task 03 (in the tree)
           `createFakeAgentHarness(clock: Clock)`, its per-id `at` stamping, and `FAKE_STEPS_TEXT` with its held steps turn: all in the tree from the activity-line plan (its tasks 04 and 08, a precondition of this plan)
Produces:  `export const FAKE_AGENTS_TEXT = 'fake: agents';` in `src/shared/fake-agent-harness.ts`
           the fake's `events.agentEvent` emissions described below, in `src/shared/fake-agent-harness.ts`
Decisions: **clock**: the fake already takes `clock: Clock` (activity-line plan), and `main.ts` already passes the app's clock to it. Every agent event's `at` is `clock.now()` when emitted. `main.ts` needs no change here (the activity-line plan did that work)
           **events for what the fake already simulates** (plan.md Decided: the fake harness emits the same events):
           - start: `sessionStarted`, first, in the start microtask before `controls`
           - every `send` but a `FAKE_END_TEXT` one: `userMessage` right after the user entry, before `working`. A `FAKE_END_TEXT` send emits the user entry, `userMessage`, `working`, `sessionEnded`, then `ended`
           - `FAKE_TOOL_TEXT`: `toolStarted { agentId: MAIN_AGENT_ID, toolUseId: 'fake-tool-<turn>', tool: 'Bash' }` after the tool entry with no result, and `toolFinished { …, ok: true }` after the one with its result
           - `FAKE_STEPS_TEXT`: each `tool` step gets `toolStarted` then `toolFinished` on `MAIN_AGENT_ID`, emitted after the step's entry, with the step's toolUseId and tool name. `ok` is false for step 4 (the failing Bash) and true for the rest. The thinking step emits none
           - `end`, `kill`, and a held end's release: `sessionEnded` just before each `ended`
           - `usage`: left exactly as the usage plan made it (lead's ruling: this plan sits on top). No `compacted`: the fake simulates no compaction. Where the usage plan writes the agent id `'main'` as a literal, use `MAIN_AGENT_ID`
           **`FAKE_AGENTS_TEXT` on turn T** (10's self-test relies on these values): the user entry `user-T`, `userMessage`, `working`. Then for n = 1, 2: a `tool` entry `agent-T-n`, toolUseId `fake-agent-T-n`, name `Agent`, result `null`, followed by `agentSpawned { agentId: 'fake-agent-T-n', parentAgentId: MAIN_AGENT_ID, agentType, description }`. Then for n = 1, 2, the subagent's one tool call: entry `agent-T-n-tool` (toolUseId `fake-agent-T-n-tool`) with result `null`, then `toolStarted { agentId: 'fake-agent-T-n', toolUseId: 'fake-agent-T-n-tool', tool }`, then the same entry with result `{ text: 'fake', isError: false }`, then `toolFinished { …, ok: true }`. The turn is then held open as `FAKE_HOLD_TEXT` holds it: no result entry, activity stays `working`

           | n | agentType | description (also the Agent entry's summary) | Agent entry input | tool | tool input, summary |
           |---|---|---|---|---|---|
           | 1 | `wigley:sonnet-medium` | `Map the stream decoder` | `{ subagent_type: 'wigley:sonnet-medium', description: 'Map the stream decoder' }` | `Read` | `{ file_path: 'src/main/claude-code/stream-decoder.ts' }`, `src/main/claude-code/stream-decoder.ts` |
           | 2 | `Explore` | `Find every Files adapter` | `{ subagent_type: 'Explore', description: 'Find every Files adapter' }` | `Grep` | `{ pattern: 'append' }`, `append` |

           **how the two subagents end**, whichever comes first:
           - `interrupt` while they run: for each running subagent in spawn order, its Agent entry is re-sent with result `{ text: 'Interrupted', isError: true }`, then `agentFinished { outcome: 'failed' }`. Then the usual `Interrupted` notice and `idle`. The Claude adapter does the same on the interrupted turn's `result` (03), so the fake and Claude agree, and the self-test gets a key that ends the lines (10)
           - the next `send`: before that send's user entry, each running subagent's Agent entry is re-sent with result `{ text: 'fake subagent done', isError: false }`, then `agentFinished { outcome: 'done' }`. Then the send runs as usual
           - the process ending (`end`, `kill`, `FAKE_END_TEXT`): no `agentFinished`, only `sessionEnded`. This exercises the agents plugin's rule that `sessionEnded` finishes every listed subagent (plan.md Decided)
           The fake keeps the running subagents' ids per process, cleared by each of the three ends
           **drive description** (`chat/main/start.ts`, the `start` action's `description`): name `"fake: agents"` as "two subagents that run until an interrupt, the next message or the session's end". Name `"fake: steps"` too when the activity-line plan left it out, so "anything else an echo" stays true
           **test recording**: use the agent-event recording the usage plan gave `recordingEvents` in `fake-agent-harness.test.ts`. Below, `agentEvents` means the recorded agent events with `usage` left out: the usage plan's tests own those. No existing assertion changes
GIVEN a fake process from `startedProcess()` (start events cleared) over a clock at 1000 WHEN `FAKE_AGENTS_TEXT` is sent THEN `agentEvents` is `userMessage`, `agentSpawned` ×2 (the table's types and descriptions), then `toolStarted`/`toolFinished` for `fake-agent-1-1-tool` then `fake-agent-1-2-tool`, each at 1000; `heard` ends with `working` and holds no `result` entry
GIVEN that held turn WHEN `interrupt` is called THEN `agentEvents` gains `agentFinished failed` for `fake-agent-1-1` then `fake-agent-1-2`, before the `Interrupted` notice in `heard`
GIVEN that held turn WHEN another message is sent THEN `agentEvents` gains `agentFinished done` for both before that send's `userMessage`
GIVEN that held turn WHEN `end` is called THEN `agentEvents` gains `sessionEnded` alone
Tests:     `fake-agent-harness.test.ts`:
           - `send_AgentsText_SpawnsTwoSubagentsAndHoldsTurn`: the first GIVEN: full `agentEvents`, and the entry ids and kinds in `heard`. It catches wrong ids, types or descriptions that 10's screenshots depend on, and a turn that closes
           - `it.each` `agentsTurn_$ending_FinishesSubagents$as`, with rows `interrupt` → two `failed` then the notice; `send` → two `done` then the new `userMessage`; `end` → only `sessionEnded`. It catches an end that leaves lines running forever, or finishes them twice
           - `it.each` `sessionEvents_$case`, with rows `start` → `[sessionStarted]`; `plain send` → `[userMessage]`; `tool turn` → `[userMessage, toolStarted, toolFinished ok]`; `end` → `[sessionEnded]`; `end text` → `[userMessage, sessionEnded]`. Every row but `start` uses the file's `startedProcess()` (start events cleared); the `start` row records from `harness.start` and a flush. Each row runs at the fake clock's time. It catches an event the fake forgets for what it already simulates
           - `send_StepsText_EmitsStepsAndHoldsTurnOpen` (activity-line plan): assert its `agentEvents` too: six `toolStarted`/`toolFinished` pairs, step 4 `ok: false`
Done when: compiles; the test gate runs `fake-agent-harness.test.ts`; `npm run lint` passes. The self-test runs it in 10
Commit:    one commit for the group

## Proof

Commit f84719b · proof: diff read: FAKE_AGENTS_TEXT and the fake's agent events present, MAIN_AGENT_ID replaces the literal; typecheck clean; worker ran fake-agent-harness and its three consumer suites (161 pass) and lint · concerns: end, kill and a fake: end send clear the running-subagent list when called, so an agents send whose microtask has not run could refill it after; nothing reads it after the end
