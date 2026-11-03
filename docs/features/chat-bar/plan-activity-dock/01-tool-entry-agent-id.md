# 01 — Tool entries carry the agent's id

Status: done
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     modify `src/contracts/agent.ts` · modify `src/main/claude-code/tool-entries.ts` ·
           modify `src/main/claude-code/stream-decoder.ts` · modify `src/main/claude-code/transcripts.ts` ·
           modify `src/shared/fake-agent-harness.ts` · modify `src/plugins/chat/main/preview/preview-session.ts` ·
           modify `src/plugins/chat/layouts/layout.d.ts` (`ToolInput` only) ·
           test `src/main/claude-code/stream-decoder.test.ts` · test `src/main/claude-code/transcripts.test.ts` ·
           test `src/shared/fake-agent-harness.test.ts` · test every other test file whose tool entry literal the
           typecheck flags (at plan time: `src/plugins/chat/page/entry-list.test.ts`,
           `src/plugins/chat/page/chat-commands.test.ts`, `src/plugins/chat/layouts/default/layout.test.ts`,
           `src/plugins/chat/page/working-turn.test.ts`, `src/plugins/chat/page/activity-runs.test.ts`)
Consumes:  `MAIN_AGENT_ID` in `src/contracts/agent.ts` (exists) · `agentOf(event: Json): string` in
           `src/main/claude-code/stream-decoder.ts` (exists)
Produces:  `agentId: string` on the `tool` variant of `ChatEntry` in `src/contracts/agent.ts`, with the comment
           plan.md § File Structure gives
           `export function toolUseEntry(id: string, block: Json, raw: unknown, agentId: string): ToolEntry` in
           `src/main/claude-code/tool-entries.ts`
           `agentId: string` on `ToolInput` in `src/plugins/chat/layouts/layout.d.ts`, after `id`
Decisions: agent id on tool entries, no shim for older data (decision 6; plan.md precondition 2) · the Claude
           decoder takes the id from `agentOf(event)`, the same rule its agent events use (precondition 5) · history
           entries are the main agent's, since the reader skips sidechain lines (precondition 3)

## What changes

- `toolUseEntry` sets `agentId` from its new last parameter.
- `stream-decoder.ts` `toolEntry(block, event)` passes `agentOf(event)`.
- `transcripts.ts` passes `MAIN_AGENT_ID` at its one `toolUseEntry` call.
- `fake-agent-harness.ts`: `ToolCall` keeps `agentId` (it is `Omit<ToolEntryDraft, 'result' | 'raw'>`, so it
  gains the field). Each call site sets it: `MAIN_AGENT_ID` for the main agent's calls (tool turn, steps turn,
  workflow calls, permission call, the `Agent` calls `emitAgentsTurn` makes), and the subagent's id
  (`fake-agent-<turn>-<n>`, the `agentId` the same call's `toolStarted` event carries) for each subagent's own
  tool call. `ToolCall.agentId` is the one source: remove the `agentId` parameter from `startFakeTool`,
  `finishFakeTool`, `toolStartedEvent` and `toolFinishedEvent`, and have each read `call.agentId`. Two sites set the
  field at their literal: `emitStepsTurn` (it calls the event builders directly with `MAIN_AGENT_ID` today) sets
  `agentId: MAIN_AGENT_ID` on its calls, and `emitAgentsTurn` sets its local subagent `agentId` on each subagent's
  `ToolCall`.
- `preview-session.ts`: the three tool entries carry `agentId: MAIN_AGENT_ID`.
- `read-chat-layout.ts`'s compile-time check (`VARIANTS_FIT_INPUTS`) then holds with both sides changed; it needs no
  edit.

GIVEN a Claude assistant line with `parent_tool_use_id: null` and a `tool_use` block WHEN the decoder decodes it
THEN the tool entry's `agentId` is `main`
GIVEN the measured subagent Read line (`MEASURED_SUBAGENT_READ`, `parent_tool_use_id`
`toolu_01FqZQTLkePVaZcsvgWG3jqK`) WHEN the decoder decodes it THEN the tool entry's `agentId` is
`toolu_01FqZQTLkePVaZcsvgWG3jqK`
GIVEN a transcript with a tool call WHEN `transcriptEntries` reads it THEN the tool entry's `agentId` is `main`
GIVEN the fake harness WHEN it runs a `fake: agents` turn THEN each `Agent` entry's `agentId` is `main` and each
subagent's own tool entry's `agentId` is `fake-agent-<turn>-<n>`

Tests:     `decode_ToolUse_AddsToolEntryWithSummary` in `stream-decoder.test.ts` becomes a table
           `decode_ToolUse_AddsToolEntryWithSummaryAndAgent ($case)`. Each row carries the decoder's input line and
           a literal expected entry, asserted with `toMatchObject`:
           row `main` — input `line(toolUseEvent)`; expected `kind: 'tool'`, `id: 'tool-t1'`, `toolUseId: 't1'`,
           `name: 'Bash'`, `summary: 'ls -la'`, `result: null`, `agentId: 'main'` (the summary and result the old
           test pins stay asserted);
           row `subagent` — input `MEASURED_SUBAGENT_READ` as it is (it is already a JSON line; do not pass it
           through `line()`); expected `kind: 'tool'`, `id: 'tool-toolu_01Th9zCiM7nvQkeAH1gsms6w'`,
           `toolUseId: 'toolu_01Th9zCiM7nvQkeAH1gsms6w'`, `name: 'Read'`,
           `agentId: 'toolu_01FqZQTLkePVaZcsvgWG3jqK'` ·
           `transcriptEntries_Conversation_BuildsEntriesInOrder`
           in `transcripts.test.ts`: the expected tool entry gains `agentId: 'main'` ·
           `send_AgentsText_SpawnsTwoSubagentsAndHoldsTurn` in `fake-agent-harness.test.ts`: capture the `heard`
           entries of kind `tool` and assert, beside the existing `agentEvents` assertions: the two `agent-1-<n>`
           entries have `agentId: 'main'`, and the two `agent-1-<n>-tool` entries have `agentId: 'fake-agent-1-<n>'` ·
           `send_ToolText_EmitsToolWithResult`: the tool entry's `agentId` is `main` · every other tool entry
           literal or helper the typecheck flags gains `agentId: MAIN_AGENT_ID` (no new assertion)
Done when: `npm run typecheck` passes; the test gate runs the tests above
Commit:    one commit for the group

## Proof

Commit 91ff7c11 · proof: diff read: all three Produces present; typecheck green · concerns: permission-turn test literal in fake-agent-harness.test.ts gained agentId though tsc did not flag it (runtime toEqual)
