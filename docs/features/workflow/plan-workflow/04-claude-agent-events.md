# 04 — Claude adapter emits the workflow events

Status: not started
Type: Batch
Wave: 2 · Depends on: 01
Plan: [plan.md](plan.md)

Files:     modify `src/main/claude-code/stream-decoder.ts` · test `src/main/claude-code/stream-decoder.test.ts` ·
           modify `src/main/claude-code/claude-code-harness.ts` · test `src/main/claude-code/claude-code-harness.test.ts` ·
           modify `docs/features/agent-chat/claude-stream.md` (§ Assistant messages, one fact)
Consumes:  the `skillStarted`, `fileWritten`, `turnStarted` and `turnEnded` members of `AgentEvent` ← 01
           `typedSkill(text: string): TypedSkill | null` in `src/shared/typed-skill.ts` ← 01
           in the tree: `DecodedLine.agentEvents: AgentEventDraft[]`, `AgentEventDraft`, `agentOf(event)`,
           `startAgentOrTool`, `finishAgentOrTool`, `failOpenTools`, `decodeSystem`, `decodeResult` and the
           `toolAgents` map in
           `stream-decoder.ts`; `emitAgentEvent(draft)`, `send(userInput)` and `CONTROL_COMMAND` in
           `claude-code-harness.ts`; the table `decode_AgentEvents_$case` in `stream-decoder.test.ts` and the test
           `start_AgentEvents_StampedAtTheClockAndBracketedBySession` in `claude-code-harness.test.ts`
Produces:  the decoder's `skillStarted`, `fileWritten`, `turnStarted` and `turnEnded` drafts in `DecodedLine.agentEvents`, in
           `src/main/claude-code/stream-decoder.ts`
           `send` emitting `skillStarted` for a typed slash command, in `src/main/claude-code/claude-code-harness.ts`
Decisions: **the decoder stays the only reader of Claude's JSON** (plan.md Boundary rules). It adds the new drafts
           to `agentEvents` beside the drafts it already builds. `AgentEventDraft` needs no change: it already
           covers every non-`usage` member, so `turnEnded` is the draft `{ type: 'turnEnded' }` and `turnStarted` is
           `{ type: 'turnStarted' }`. The harness stamps
           each draft `at` in `emitAgentEvent`, as it does now. `agentId` is `agentOf(event)`, the same id
           `toolStarted` carries for the same block: `MAIN_AGENT_ID` for a main-conversation line, else the Agent
           call's id. The decoder emits subagent events too; the workflow plugin keeps only `MAIN_AGENT_ID` ones
           (plan.md Decisions).
           **decoder mapping** (each new draft comes after the drafts the same block already gives):

           | Raw line | Condition | New draft |
           |---|---|---|
           | `assistant`, each `tool_use` block | `name` is `Skill` and `input.skill` is a non-empty string | after its `toolStarted`: `skillStarted { agentId, skill: input.skill, args }`; `args` is `input.args` trimmed when a string, else `''` |
           | `user`, each `tool_result` block | its `tool_use_id` is a write call (below) and `is_error` is not `true` | after its `toolFinished`: `fileWritten { agentId: the call's agentId, path }` |
           | `system`, subtype `init` | always | `turnStarted`, in `decodeSystem`'s `init` branch |
           | `result` | always | `turnEnded`, last in the line, after the drafts `failPendingAgents` gives |

           - **write calls**: a module constant `WRITE_TOOL_PATHS: Readonly<Record<string, string>>` maps each write
             tool to its path field: `Write`, `Edit` and `MultiEdit` to `file_path`, `NotebookEdit` to
             `notebook_path`. These are the four file-changing tools `tool-summary.ts` names. In
             `startAgentOrTool`, for a tool in the map whose path field is a non-empty string, record the path in
             a new map `writePaths: Map<string, string>`, keyed by the tool use id. In `finishAgentOrTool`, when
             `toolAgents` holds the id, read and delete the id's `writePaths` entry. Emit `fileWritten` only when
             the result is ok. `failOpenTools` deletes the `writePaths` entry of each call it fails.
           - **`fileWritten` comes on the ok result, not on the `tool_use`** (drafting decision): a Write that
             the permission tool denies, or that fails, writes no file. The workflow then reads a plan folder only
             after Claude wrote it. The turn's `result` line comes after the tool results, so `turnEnded` still
             follows `fileWritten`.
           - **`Skill` input**: `{"skill":"wigley:make","args":"<path>"}`; `args` is absent when the call passes
             none (seen in the user's Claude session transcripts, `"name":"Skill","input":{"skill":"wigley:writing-tests"}`).
             `claude-stream.md` records no `Skill` call. Add one bullet to its § Assistant messages: "A `Skill` call
             carries `input.skill`, the skill's name as `slash_commands` lists it (`wigley:make`), and `input.args`
             only when the call passes text." The `Skill` call keeps its `toolStarted` and `toolFinished`, like any
             tool.
           - **`turnStarted` on every `system/init`** (ruling: every turn, requested or not). Each turn of the main
             conversation opens on a `system/init` (`claude-stream.md` § Init, and the turns after a background
             subagent ends: `system/init` … `result` with `origin` `peer` or `task-notification`). Those unrequested
             turns carry no `userMessage`, so `turnStarted` is the one signal that a turn runs. The workflow reads it
             as busy (plan.md Decisions: busy is a turn or a subagent).
           - **`turnEnded` on every `result`**, the unrequested turns (`turnUnrequested`) and the control command
             turns (`/effort high`) included: each ends a turn of the main conversation, and a `turnEnded` with no
             turn running changes no flow.
           **typed slash commands come from the harness's send path.** Claude does not echo a sent message on
           stdout (`claude-stream.md` § Slash commands), so the decoder never sees it. In `send(userInput)`, after
           `emitAgentEvent({ type: 'userMessage' })`, compute `typedSkill(userInput.text)`. When it is not null and
           `CONTROL_COMMAND` does not match the text, call
           `emitAgentEvent({ type: 'skillStarted', agentId: MAIN_AGENT_ID, skill, args })`. A control command is the
           harness's own control change, not a skill. `setControl` emits no `skillStarted`. Every send reaches this
           path: the composer, chat main's `send` export (06) and chat's `launch` first message.
           **existing assertions**: every row of `decode_AgentEvents_$case` whose lines hold a `result` line
           (`INTERRUPTED_RESULT_LINE`, `RESULT_LINE` or a built result) gains `{ type: 'turnEnded' }` at that line's
           place in `expected`. No row of that table holds a `system/init` line, so `turnStarted` changes no existing
           row; no other decoder test asserts `agentEvents`. Those are the only changes to existing expectations.
           `claude-code-harness.test.ts` records the non-`usage` agent events in `agentEvents`; a test that asserts the
           whole `agentEvents` list across a result line or an init line gains `turnEnded` or `turnStarted` the same
           way. `start_AgentEvents_StampedAtTheClockAndBracketedBySession` writes neither line, so it does not change.
GIVEN a decoder WHEN it reads a main `Write` `tool_use` `w1` with `file_path` `/p/docs/features/x/plan-y/plan.md`,
then `w1`'s ok result, then a `result` line THEN the drafts are `toolStarted main w1 Write`,
`toolFinished main w1 true`, `fileWritten main /p/docs/features/x/plan-y/plan.md`, `turnEnded`
GIVEN a started harness WHEN the user sends `/wigley:make /p/plan-y` THEN `agentEvents` gains `userMessage`, then
`skillStarted { agentId: 'main', skill: 'wigley:make', args: '/p/plan-y' }`, both at the clock's time
Tests:     `stream-decoder.test.ts`: rows added to `decode_AgentEvents_$case`, built with `toolUseLine`,
           `toolResultLine` and the file's result line:
           - `main skill` → `toolUseLine('s1', 'Skill', { skill: 'wigley:feature', args: ' plan x ' })` gives
             `toolStarted main s1 Skill`, `skillStarted main wigley:feature 'plan x'` (input read wrong, args not
             trimmed)
           - `skill without args` → `{ skill: 'wigley:make' }` gives `skillStarted` with `args: ''`
           - `skill without a name` → `{ args: 'x' }` gives only `toolStarted` (an empty skill reported)
           - `subagent skill` → the same call with parent `a1` after `agentCall('a1')` gives `skillStarted` with
             `agentId: 'a1'` (a subagent's skill taken for the main agent's)
           - `write ok` → the first GIVEN (a write dropped, or a `fileWritten` before its `toolFinished`)
           - `edit, multi edit and notebook edit` → three calls and their ok results give three `fileWritten`
             drafts with each tool's path field (`notebook_path` read as `file_path`)
           - `write error result` → an `is_error: true` result gives `toolFinished ok false` and no `fileWritten`
             (a denied write reported as written)
           - `write left open at an agent's end` → a subagent `Write` under `a1`, then `a1`'s result, gives no
             `fileWritten`; a later ok `tool_result` for that write gives nothing (a `writePaths` entry kept past
             `failOpenTools`)
           - `read is no write` → a `Read` and its ok result give no `fileWritten`
           - `result ends the turn` → one result line alone gives `[{ type: 'turnEnded' }]` (a missing turn end)
           - `init starts the turn` → one `{ type: 'system', subtype: 'init' }` line alone gives
             `[{ type: 'turnStarted' }]` (a missing turn start)
           - `unrequested turn` → an init line, then a result line with `origin: { kind: 'task-notification',
             producer: 'session-task' }`, gives `turnStarted`, `turnEnded` (a turn Claude runs on its own left out)
           `claude-code-harness.test.ts`: a new table `send_SlashText_EmitsSkillStarted ($case)` over `started()`
           with the clock at 1000. Each row sends `text`, settles, and asserts `agentEvents` after the start's
           `sessionStarted`:
           - `skill with args`: `/wigley:make /p/plan-y` → `userMessage`, `skillStarted main wigley:make /p/plan-y`
           - `skill alone`: `/wigley:feature` → `userMessage`, `skillStarted … args ''`
           - `plain message`: `hi` → `userMessage` only
           - `control command`: `/effort high` → `userMessage` only (a control change reported as a skill)
           The table catches a send path that never reads the text, and a control command reported as a skill.
           The parse rule itself is `typed-skill.test.ts`'s (01).
Done when: compiles; the test gate runs `stream-decoder.test.ts` and `claude-code-harness.test.ts`; `npm run lint`
           passes
Commit:    one commit for the group

## Proof
