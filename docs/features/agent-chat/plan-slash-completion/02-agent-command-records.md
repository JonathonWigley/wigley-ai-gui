# 02 — Agent command records from initialize

Status: done
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     modify `src/contracts/agent.ts` · create `src/main/claude-code/claude-commands.ts` · test `src/main/claude-code/claude-commands.test.ts` · modify `src/main/claude-code/session-fold.ts` · modify `src/main/claude-code/claude-code-harness.ts` · modify `src/shared/fake-agent-harness.ts` · modify `src/plugins/chat/contract.ts` · modify `src/plugins/chat/main/chat-sessions.ts` · modify `src/plugins/chat/page/chat-view.ts` (compile-through only) · test `src/main/claude-code/session-fold.test.ts`, `src/main/claude-code/claude-code-harness.test.ts`, `src/shared/fake-agent-harness.test.ts`, `src/plugins/chat/main/chat-sessions.test.ts`
Consumes:  none
Produces:  in `src/contracts/agent.ts`:
           `export interface AgentCommand { name: string; description: string; argumentHint: string; aliases: string[]; }`
           `AgentProcessEvents.commands(commands: AgentCommand[]): void` (was `commands(names: string[])`)
           in `src/main/claude-code/claude-commands.ts`:
           `export function commandRecordsOf(initializeReply: Json): AgentCommand[]`
           `export function mergeInitNames(records: readonly AgentCommand[], names: readonly string[]): AgentCommand[]`
           in `src/main/claude-code/session-fold.ts`: `PendingRequest` gains `{ kind: 'initialize' }`; `SessionFoldState.commandRecords: AgentCommand[]`, `[]` at start; the `commands` effect carries `commands: AgentCommand[]`
           in `src/plugins/chat/contract.ts`: `ChatSessionState.commands: AgentCommand[]`; the channel message `commands: { sessionId: string; commands: AgentCommand[] }` (was `names: string[]`)
Decisions: `initialize` is the first stdin line of a started process (round 1) · its `commands` become records; `init` keeps updating the list (Decided) · a failed `initialize` is logged and the list waits for `init` (Decided) · the record type is harness-neutral and lives in the contract; `initialize` and `init` JSON stay in `src/main/claude-code/` (`AGENTS.md` harness rule) · records and merge sit in the fold, which owns stdin and control replies, so replay and live share them (Decided 2026-11-04) · the answer stays out of the chat entries, like `get_context_usage` (Decided 2026-11-04)
Pinned:    the request line: `{"type":"control_request","request_id":"<nextRequestId()>","request":{"subtype":"initialize"}}` · names carry no leading `/` (strip one if present, as `commandNames` does) · `description` and `argumentHint` default to `''` and `aliases` to `[]` when absent or not the right type · the `builtin` field is not carried · `stream-decoder.ts` keeps `DecodedLine.commands: string[] | null` for `init` (names, as today), and `controlResponse.response` already carries the reply data, so the decoder itself gains no field
Write:     in `createClaudeSession`'s `open()` in `claude-code-harness.ts`, write the `initialize` request immediately before `requestContextUsage()`. `initialize` takes `wigley-1` and the first context request moves to `wigley-2`. `attachClaudeProcess` does not call `open()`, so a re-attach writes no `initialize`
Fold:      - `foldRequestLine`: `request.subtype === 'initialize'` sets `pendingRequests` to `{ kind: 'initialize' }`
           - the `isKeptOut` predicate in `createSessionFoldState` returns true for `initialize` as well as `contextUsage`
           - `answerControlResponse`, a branch ahead of the mode branch: on an error answer push `{ kind: 'log', text: 'Could not list commands: <error>' }` and emit no `commands`, with no notice entry (the user lost nothing they can act on); on a success answer whose `commands` is absent or not a list, push `{ kind: 'log', text: 'Could not list commands: no list in the answer' }` and leave the held list; on any other success set `state.commandRecords = commandRecordsOf(response.response)` and push the `commands` effect. Such an answer replaces the list, also when an `init` came first
           - in the `decoded.commands !== null` block of `foldOutLine`: set `state.commandRecords = mergeInitNames(state.commandRecords, decoded.commands)` and push it as the `commands` effect. An `init` with zero names leaves the held list and pushes nothing, so a malformed line cannot empty a good list
           - `replayPipeLog`'s `lastCommands` takes the new type; its collapse to the last list stays
Merge:     `mergeInitNames`: for each init name in order, take the first record whose `name` or one of whose `aliases` equals it and that no earlier init name took; else a new record `{ name, description: '', argumentHint: '', aliases: [] }`. Records no init name took drop. The result keeps init's order. Duplicate check for chat main: replace `sameNames` with a comparison over all four record fields, since its only caller is the `commands` event
GIVEN an initialize answer carrying `wigley:feature` with alias `feature` WHEN it is folded THEN a `commands` effect holds a record with that name, description and alias
GIVEN records from initialize including `{ name: 'docx', aliases: ['anthropic-skills:docx'] }` WHEN an init lists `anthropic-skills:docx` THEN the emitted list holds the `docx` record once, its description kept
GIVEN an init listing a name no record holds WHEN merged THEN that name gets a record with empty text
GIVEN an initialize error answer WHEN folded THEN a log effect names the error and no `commands` effect follows
GIVEN a pipe log holding an initialize line and its answer WHEN `replayPipeLog` runs THEN the effects hold the records and no line is written
Tests:     `claude-commands.test.ts`: `commandRecordsOf_ReadsFields` (a missing `aliases` reads `[]`, a non-string `description` reads `''`) · `commandRecordsOf_NoList_IsEmpty` · `mergeInitNames_KeepsRecordMatchedByAlias` (the `docx` case) · `mergeInitNames_NewName_GetsEmptyRecord` · `mergeInitNames_DroppedName_LeavesList` · `mergeInitNames_RecordTakenOnce`
           `session-fold.test.ts`: `foldPipeLine_InitializeAnswer_EmitsRecords` · `foldPipeLine_InitializeAnswer_StaysOutOfEntries` · `foldPipeLine_InitializeError_LogsAndEmitsNothing` · `foldPipeLine_InitializeWithoutList_KeepsHeldList` · `foldPipeLine_InitWithNoNames_KeepsHeldList` · `replayPipeLog_InitializeInLog_ReportsRecords` · the existing `commands` assertion (`commands: ['compact']`) becomes a record
           `claude-code-harness.test.ts` (over its existing fake host): `start_WritesInitializeFirst` — the first written line's `request.subtype` is `initialize`, the second `get_context_usage` · `attach_WritesNoInitialize` · existing tests of a started process updated for the new first line: each `run.written` `toEqual` gains the `initialize` line ahead, each `run.written[n]` index moves by one, and each `wigley-N` of such a test moves to `wigley-N+1`. A test that hands an attach a pipe log keeps that log's ids. `grep -n 'run\.written\|wigley-[0-9]'` finds the lines
           `fake-agent-harness.test.ts`: the emitted `commands` assertion becomes records
           `chat-sessions.test.ts`: `commands_StoredAndSentOnChange` sends and asserts records, its first send being the fake's record; add `commands_SameNameNewDescription_Sent`
Fake:      `src/shared/fake-agent-harness.ts` emits `[{ name: 'fake-command', description: 'A fake agent command', argumentHint: '', aliases: ['fake-alias'] }]`. The alias gives task 05's self-test an alias to match
Compile-through: `chat-view.ts` passes `tab.state.commands.map((command) => command.name)` to the existing `completionWords`, and its `commands` channel handler reads the new `commands` field, so the build stays green until task 05 replaces both. A `commands: []` literal elsewhere (`chat/main/preview/chat-preview.ts`, test fixtures) already fits the new type
Done when: `npm run typecheck`, `npm run lint` and the tests above pass
Commit:    one commit for the group

## Proof

Commit 44850dec · proof: cherry-pick of 0640436c from the stopped worktree run onto main; session-fold auto-merged; diff read in the earlier run; typecheck exit 0; the five touched test files pass, 679 · concerns: isKeptOut is the decoder's parameter, not a fold name; an init with no names now emits nothing; alias match on an earlier record beats an exact name on a later one, as pinned, untested; initialize listing more than init drops records at the first init, check live in 07; leading-slash regex in both commandNames and withoutSlash
