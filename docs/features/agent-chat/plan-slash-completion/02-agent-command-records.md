# 02 — Agent command records from initialize

Status: not started
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     modify `src/contracts/agent.ts` · modify `src/main/claude-code/stream-decoder.ts` · modify `src/main/claude-code/claude-code-harness.ts` · modify `src/shared/fake-agent-harness.ts` · modify `src/plugins/chat/contract.ts` · modify `src/plugins/chat/main/chat-sessions.ts` · modify `src/plugins/chat/page/chat-view.ts` (compile-through only) · test `src/main/claude-code/stream-decoder.test.ts`, `src/main/claude-code/claude-code-harness.test.ts`, `src/shared/fake-agent-harness.test.ts`, `src/plugins/chat/main/chat-sessions.test.ts`
Consumes:  none
Produces:  in `src/contracts/agent.ts`:
           `export interface AgentCommand { name: string; description: string; argumentHint: string; aliases: string[]; }`
           `AgentProcessEvents.commands(commands: AgentCommand[]): void` (was `commands(names: string[])`)
           in `src/plugins/chat/contract.ts`: `ChatSessionState.commands: AgentCommand[]`; the channel message `commands: { sessionId: string; commands: AgentCommand[] }` (was `names: string[]`)
Decisions: `initialize` sent by the Claude adapter as its first stdin line, before `start` returns (round 1) · its `commands` become records; `init` keeps updating the list (Decided) · a failed `initialize` is logged and the list waits for `init` (Decided) · the record type is harness-neutral and lives in the contract; `initialize` and `init` JSON stay in `src/main/claude-code/` (AGENTS.md harness rule)
Pinned:    the request line: `{"type":"control_request","request_id":"<nextRequestId()>","request":{"subtype":"initialize"}}` · names carry no leading `/` (strip one if present, as `commandNames` does) · `description` and `argumentHint` default to `''` and `aliases` to `[]` when absent or not the right type · the `builtin` field is not carried
Decoder:   init stays `DecodedLine.commands: string[] | null` (names, as today). The `initialize` records go in a new field on the decoded control response: `controlResponse.commands: AgentCommand[] | null`, read from any success `control_response` whose `response.response.commands` is an array, else `null`. The harness uses them only when the pending kind is `initialize`.
Behaviour: Init merge, in the harness (it holds the last records): for each init name in order (`slash_commands` then `skills`, first kept, as today), take the first earlier record whose `name` or one of whose `aliases` equals it and that no earlier init name took; else a new record `{ name, description: '', argumentHint: '', aliases: [] }`. Records no init name took drop. The emitted list keeps init's order. Emit `commands` only when the merged list differs from the last emitted (chat main already skips equal lists by name; it compares records now).
           `initialize` answer: a `pendingRequests` kind `{ kind: 'initialize' }`. On success the decoder reads `response.response.commands` (an array of objects); on an error answer, log `Could not list commands: <error>` under `claude` (no notice entry: the user lost nothing they can act on). The answer's raw event joins the turn's events entry as every `control_response` does today.
GIVEN an initialize answer carrying `wigley:feature` with alias `feature` WHEN it is decoded THEN `commands` emits a record with that name, description and alias
GIVEN records from initialize including `{ name: 'docx', aliases: ['anthropic-skills:docx'] }` WHEN an init lists `anthropic-skills:docx` THEN the emitted list holds the `docx` record once, its description kept
GIVEN an init listing a name no record holds WHEN merged THEN that name gets a record with empty text
GIVEN an initialize error answer WHEN handled THEN a `claude` log line names the error and no `commands` emit
Tests:     `stream-decoder.test.ts`: `decode_InitializeResponse_ReadsCommandRecords` (name, description, argumentHint, aliases; a missing `aliases` reads `[]`) · the existing init test keeps asserting names; `decode_ControlResponseWithoutCommands_IsNull`
           `claude-code-harness.test.ts` (over its existing fake child process): `start_WritesInitializeFirst` — the first stdin line's `request.subtype` is `initialize` · `initialize_Answer_EmitsCommands` · `init_AfterInitialize_KeepsRecordMatchedByAlias` (the `docx` case) · `init_NewName_GetsEmptyRecord` · `init_DroppedName_LeavesList` · `initialize_Error_LogsAndEmitsNothing` · existing tests updated for the `initialize` line now written first: the `run.written` `toEqual([message])` assertions (lines ~173, 197, 228) gain the `initialize` line ahead, `run.written[2]` reads (lines ~256, 295) shift by one, and the `request_id` values move from `wigley-1` to `wigley-2` (and so on), since `initialize` takes `wigley-1`. The fake child keeps recording every written line
           `fake-agent-harness.test.ts`: the emitted `commands` assertion becomes records
           `chat-sessions.test.ts`: the `commands` send at line ~421 carries records
Fake:      `src/shared/fake-agent-harness.ts` emits `[{ name: 'fake-command', description: 'A fake agent command', argumentHint: '', aliases: ['fake-alias'] }]` — the alias gives task 05's self-test an alias to match
Compile-through: `chat-view.ts` passes `tab.state.commands.map((command) => command.name)` to the existing `completionWords` and reads the channel's `commands` field, so the build stays green until task 05 replaces both
Done when: `npm run typecheck`, `npm run lint` and the tests above pass
Commit:    one commit for the group

## Proof

