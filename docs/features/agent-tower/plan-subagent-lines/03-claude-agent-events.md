# 03 — Claude adapter emits agent events

Status: done
Type: Batch
Wave: 2 · Depends on: 01, 02 (precondition: the usage plan `docs/features/usage/plan-usage/` has landed; its task 03, `03-adapter-usage.md`, already changed both files this task edits)
Plan: [plan.md](plan.md)

Files:     modify `src/main/claude-code/stream-decoder.ts` · test `src/main/claude-code/stream-decoder.test.ts` · modify `src/main/claude-code/claude-code-harness.ts` · test `src/main/claude-code/claude-code-harness.test.ts`
Consumes:  `AgentEvent` (widened), `MAIN_AGENT_ID` ← 02; `AgentProcessEvents.agentEvent` and the adapter's `usage` emission ← the usage plan's task 03 (in the tree)
           `claude-stream.md` § Subagents, § Compaction ← 01. Read them before writing code: every raw field below is named as they record it
           `ClaudeCodeHarnessDeps.clock: Clock` and its wiring in `src/main/main.ts`, already in the tree from the activity-line plan (its task 04, a precondition of this plan). Check with `grep -n "clock: Clock" src/main/claude-code/claude-code-harness.ts`. If it is missing, add it as that task describes: `Clock` from `src/contracts/ambient.ts`, main.ts passing its `clock`
Produces:  `DecodedLine.agentEvents: AgentEventDraft[]` and `export type AgentEventDraft` (each non-`usage` `AgentEvent` member without `at`, distributive, shaped like `EntryDraft` in `entry-stamp.ts`) in `src/main/claude-code/stream-decoder.ts`
           `startClaudeProcess` emitting the non-`usage` agent events through `events.agentEvent` in `src/main/claude-code/claude-code-harness.ts`
Decisions: **on top of the usage plan** (lead's ruling): `usage` is the usage plan's. Its task 03 emits it from the harness, with `contextTokens`, `contextWindow` from `result.modelUsage`, the autocompact limits, `cacheExpiresAt` and `spendUsd`; this task adds no `usage` mapping and changes none of its fields. Read that task's changes to `stream-decoder.ts` and `claude-code-harness.ts` before writing code. If `DecodedLine` already has a field carrying agent-event data, add these drafts to it rather than a second field, and name the field it uses in the Proof; plan.md's File Structure takes that name. Where the usage plan writes the main agent's id as a literal `'main'`, use `MAIN_AGENT_ID`
           **the usage event stays the main agent's**: the usage plan leaves subagent context out of scope. If its usage reader takes `assistant` lines whatever their `parent_tool_use_id`, and § Subagents records `usage` on subagent `assistant` lines, restrict it to lines whose `parent_tool_use_id` is null. Otherwise a subagent's small context would overwrite the main agent's on the status bar
           **where it lives**: the decoder stays the only reader of Claude's JSON (plan.md Boundary rules). It adds agent event drafts to the `DecodedLine` it already returns, beside `entries`, and changes no entry it builds. The harness stamps each draft `at: deps.clock.now()` when it handles the line, and emits it through its microtask `emit`, after that line's entries, in decode order (plan.md Decided: the adapter stamps `at` from the injected clock). Events tied to the process rather than to a line come from the harness itself: `sessionStarted`, `sessionEnded`, `userMessage`
           **the Agent call is `agentSpawned` / `agentFinished` only**, never also `toolStarted` / `toolFinished` (plan.md Design review). Its chat entry stays the tool entry it is today
           **decoder mapping** (ids are the raw strings; `parent` is the line's top-level `parent_tool_use_id` when it is a string, else `MAIN_AGENT_ID`):

           | Raw line (claude-stream.md §) | Condition | Draft |
           |---|---|---|
           | `assistant`, each `tool_use` block (§ Assistant messages, § Subagents) | `name` is in `SUBAGENT_TOOLS` | `agentSpawned { agentId: block.id, parentAgentId: parent, agentType, description }` |
           | same | any other `name` | `toolStarted { agentId: parent, toolUseId: block.id, tool: block.name }` |
           | `user`, each `tool_result` block (§ Tool results, § Subagents) | `tool_use_id` is a spawned agent's id | `agentFinished { agentId, outcome: is_error === true ? 'failed' : 'done' }` |
           | same | `tool_use_id` had a `toolStarted` | `toolFinished { agentId: the agentId its toolStarted carried, toolUseId, ok: is_error !== true }` |
           | same | any other id | nothing |
           | `system` / `compact_boundary` (§ Compaction) | always | `compacted { beforeTokens, afterTokens }` |
           | `result` (§ Result; § Subagents probe 6) | a foreground Agent call is still pending (no `tool_result` yet) | `agentFinished { agentId, outcome: 'failed' }` for each, in spawn order |
           | `tool_progress` (§ Other events) | always | nothing: its `parent_tool_use_id` is the pending call's id, not a subagent's |

           - `SUBAGENT_TOOLS`: a `ReadonlySet<string>` of the Agent tool names § Subagents records the `tool_use` carrying on 2.1.314. Add `Task` too when § Subagents or § Init shows the CLI still lists it
           - `agentType`: `input.subagent_type` when a non-empty string. Otherwise the default § Subagents records for probe 2 (expected `general-purpose`)
           - `description`: `input.description` when a string, else `''`
           - `compacted`: `beforeTokens` = `compact_metadata.pre_tokens` when a number, else `0`. `afterTokens` = the after-size key § Compaction records, when a number, else `null`
           - the subagent's own `tool_use` and `tool_result` lines map by the same rows: their `parent` is the Agent call's id, so a subagent's tool calls count toward its line (plan.md Design review)
           **harness**:
           - `sessionStarted` is the process's first emission, queued in `startClaudeProcess` before the starting `controls`
           - `sessionEnded` is emitted inside `emitEnded`, just before `ended`, under the same once-only guard, so a spawn failure and a close each give one
           - `userMessage` is emitted in `send`, after the user entry. A `setControl` slash command emits none
           A process's subagents still running at exit get no `agentFinished`: the agents plugin's `sessionEnded` rule finishes them (plan.md Decided)
           **interrupted foreground subagents** (lead's ruling): an interrupt sends a `result` and no `tool_result` for the pending Agent call (claude-stream.md § Interrupt; § Subagents probe 6 records what 2.1.314 does). So on every turn's `result` the decoder emits `agentFinished failed` for each foreground Agent call it spawned and has seen no `tool_result` for, and forgets them. Background Agent calls are left to their end event. Adjust to what probe 6 recorded if it differs
           **background spawns** (lead's ruling, round-2 follow-up): a subagent is finished by its own end, never by its launch. For a background Agent call (`run_in_background: true`), whose `tool_result` arrives at launch, that result emits nothing; `agentFinished` comes from the end event § Subagents records for background subagents (01 probe 4), matched to the Agent call's id, with `done`/`failed` read from it. A background launch `tool_result` with `is_error: true` is the exception: the launch started no subagent and no end event will come, so it emits `agentFinished failed`. Only when § Subagents records no end event at all for a background subagent, stop and report: the line would then have no way to go before `sessionEnded`
           GIVEN a decoder WHEN it reads a background Agent `tool_use` `b1`, then `b1`'s launch `tool_result`, then a Read under `b1`, then `b1`'s recorded end event THEN the drafts are `agentSpawned b1 …`, `toolStarted b1 …`, `toolFinished b1 …`, `agentFinished b1 done`, and the launch result gives none
           **test recording**: use the agent-event recording the usage plan gave `recordingEvents` in `claude-code-harness.test.ts`. If it records into `heard`, this task's assertions filter `heard` to `agentEvent` items; if it has its own list, they read that. Either way they drop `usage` events, which the usage plan's tests own, and no existing assertion changes
GIVEN a decoder WHEN it reads an Agent `tool_use` (id `a1`, `subagent_type` `Explore`, description `read notes`), then a `tool_use` Read `t1` whose line's `parent_tool_use_id` is `a1`, then `t1`'s ok result, then `a1`'s ok result THEN the drafts are `agentSpawned a1 main Explore 'read notes'`, `toolStarted a1 t1 Read`, `toolFinished a1 t1 true`, `agentFinished a1 done`, and no tool draft for `a1`
GIVEN a harness over a clock at 1000 WHEN it starts, sends, and its stdout prints a Read `tool_use` with the clock at 2000, then the child closes THEN the agent events other than `usage` are `sessionStarted@1000`, `userMessage@1000`, `toolStarted@2000`, `sessionEnded@2000`
Tests:     `stream-decoder.test.ts`: one table `decode_AgentEvents_$case`. Each row feeds its lines, built with the file's helpers after the § Subagents / § Compaction excerpts, and asserts the concatenated `agentEvents` of all lines. Rows, each with the break it catches:
           - `main tool` → `toolStarted main` (a tool routed to no agent)
           - `spawn` → `agentSpawned` with type and description (input fields misread)
           - `spawn without type` → the § Subagents default type
           - `subagent tool start and ok result` → `toolStarted` and `toolFinished` with the agent's id (a parent id ignored)
           - `tool error result` → `toolFinished ok false` (`is_error` ignored)
           - `agent done` → `agentFinished done`, no `toolFinished` (the Agent call double-reported)
           - `agent failed` → `agentFinished failed`
           - `unknown tool result` → `[]`
           - `heartbeat` → `[]` for a `tool_progress` whose parent is a pending call (a heartbeat taken for a subagent)
           - `compaction` → `compacted` with `pre_tokens` and the after value or `null`
           - `background spawn` → the background GIVEN above (a launch result read as the end)
           - `background launch failed` → `agentSpawned`, then `agentFinished failed` from the error launch result (a line that never goes, since no end event follows)
           - `interrupted foreground subagent` → `agentSpawned`, then on the turn's `result` with no `tool_result`, `agentFinished failed`; a background spawn pending at that `result` gets none (a line left on screen after Ctrl+C, or a background line killed early)
           If the usage-reader restriction above applies, a row in the usage plan's decoder or harness usage test (whichever owns its usage rule): a subagent `assistant` line with `usage` gives no `usage` event (a subagent's context overwriting the main agent's)
           `claude-code-harness.test.ts`: `start_AgentEvents_StampedAtTheClockAndBracketedBySession`, the second GIVEN, where `started()` gains an optional `clock` argument (default the file's constant `{ now: () => 1000 }`), and the test passes a mutable `{ now: () => at }` whose `at` it sets to 2000 before writing the stdout line. It catches an unstamped or late-stamped `at`, a missing `sessionStarted` / `sessionEnded`, and a missing `userMessage`
Done when: compiles; the test gate runs `stream-decoder.test.ts` and `claude-code-harness.test.ts`; `npm run lint` passes
Commit:    one commit for the group

## Proof

Commit 93786d0 · proof: diff read: DecodedLine.agentEvents and AgentEventDraft present, harness emits sessionStarted/userMessage/sessionEnded and stamped drafts; mapping follows the lead rulings; worker ran both test files (87 pass), typecheck and oxlint/oxfmt on its files · concerns: isAsync is read from the line's top-level tool_use_result, so a user line with several tool_result blocks would apply it to each (every measured line had one); toolAgents keeps an interrupted tool's id for the process's life; agent-tower/design.md § Status lists 'the other events' under Waits and names skillStarted/fileWritten/turnEnded (doc re-read, 11)
