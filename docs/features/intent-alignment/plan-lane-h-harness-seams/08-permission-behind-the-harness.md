# 08 — Permission behind the harness

Status: not started
Type: Task
Wave: 5 · Depends on: 05
Plan: [plan.md](plan.md)

Files:     modify `src/contracts/agent.ts` ·
           create `src/plugins/claude-code/main/permission-route.ts` ·
           modify `src/plugins/claude-code/main/claude-code-harness.ts` ·
           modify `src/plugins/claude-code/main/claude-launch.ts` ·
           modify `src/plugins/claude-code/main/start.ts` ·
           modify `src/plugins/claude-code/manifest.ts` ·
           modify `src/main/main.ts` (only if it still imports `CLAUDE_PERMISSION_TOOL` after task 03; `grep -rn
           CLAUDE_PERMISSION_TOOL src` must print nothing at the end) ·
           delete `src/plugins/chat/main/permission-tool.ts` and `src/plugins/chat/main/permission-tool.test.ts` ·
           modify `src/plugins/chat/main/chat-sessions.ts` · modify `src/plugins/chat/main/start.ts` ·
           modify `src/plugins/chat/main/fixtures.ts` · modify `src/plugins/chat/main/selftest-script.ts` ·
           modify `src/shared/fake-agent-harness.ts` ·
           modify `.agents/skills/drive/SKILL.md` (the `chat.askPermission` line) ·
           modify `docs/features/agent-chat/design.md` (§ Permissions and the launch line naming `<chat's tool>`) ·
           modify `docs/features/followups.md` · modify `docs/features/intent-alignment/master-plan.md` ·
           test `src/plugins/claude-code/main/permission-route.test.ts` (create; takes over
           `permission-tool.test.ts`' two cases) ·
           test `src/plugins/claude-code/main/claude-code-harness.test.ts` (its `permissionTool: 'tool'` deps become
           the route, 5 sites, measured at plan time, re-verify) ·
           test `src/plugins/claude-code/main/claude-launch.test.ts` ·
           test `src/plugins/claude-code/main/start.test.ts` (task 03 creates it) ·
           test `src/plugins/chat/main/chat-sessions.test.ts` (20 `permissionToolSession(` call sites, measured at
           plan time, re-verify) · test `src/plugins/chat/main/start.test.ts` ·
           test `src/shared/fake-agent-harness.test.ts`
Consumes:  `sessionsMainKey`, `SessionsMainExports.contributeTools(tools, start, options?)`, `ToolDefinition`,
           `ToolSession`, `ToolCallContext`, `AgentSession`, `ToolResult`, `textResult`, `errorResult` — in
           `src/plugins/sessions/contract.ts` today ·
           the `claude-code` plugin's `main/start.ts`, which builds the adapter and registers it ← 03 ·
           `ProcessRunner.spawn` and `services.agentEnvironment` ← 03 (unchanged here) ·
           `AgentStart.rowId` (today: chat passes the row's `sessionId`, which is the `AgentSession.id` sessions hands a
           tool session for that row)
Produces:  `export interface PermissionDecision { allowed: boolean; reason: string | null }` in `src/contracts/agent.ts`
           `export interface PermissionRequest {` in `src/contracts/agent.ts`
           `permission(request: PermissionRequest): void;` in `src/contracts/agent.ts` (on `AgentProcessEvents`)
           `answerPermission(requestId: string, decision: PermissionDecision): void;` in `src/contracts/agent.ts` (on `AgentProcess`)
           `export const PERMISSION_TOOL_NAME = 'permission_prompt';` in `src/plugins/claude-code/main/permission-route.ts`
           `export const CLAUDE_PERMISSION_TOOL =` in `src/plugins/claude-code/main/permission-route.ts`
           `export const CANCELLED_REASON =` in `src/plugins/claude-code/main/permission-route.ts`
           `export const NO_PROCESS_TEXT =` in `src/plugins/claude-code/main/permission-route.ts`
           `export function createPermissionRoute(` in `src/plugins/claude-code/main/permission-route.ts`
           `askPermission(rowId: string, call: FakePermissionCall): Promise<PermissionDecision>;` in `src/shared/fake-agent-harness.ts`
Decisions: - `PermissionDecision` keeps `{ allowed, reason }` (plan.md, Decided by the agent). Chat's `PermissionAnswer`
             (`src/plugins/chat/contract.ts`, the page-to-main channel shape) stays; chat main passes it on as a
             `PermissionDecision`, the same shape. (drafter)
           - `PermissionRequest` is what chat's permission entry and dialog need, and the adapter mints the entry
             (followups.md, Permission behind the harness):
             ```ts
             // A tool call waiting on the user. `entry` is the permission entry the adapter minted for it, `answer`
             // null; `entry.id` is the id `answerPermission` takes, unique among the process's entries.
             export interface PermissionRequest {
               entry: Extract<ChatEntry, { kind: 'permission' }>;
             }
             ```
             The process sends no `entry` event for a waiting request; it sends the answered entry (same id, `answer`
             set) through `entry` once the request is answered or cancelled. So an unattended row never shows an
             unanswered card. (drafter)
           - Contract comments to write. On `permission`: "A tool call waits on the user's answer. A request still
             waiting when the process closes is cancelled, and its answered entry comes before `ended`. After `detach`
             nothing comes." On `answerPermission`: "Answers the request `requestId` that `permission` raised. Does
             nothing for an id that is not waiting (answered, cancelled or unknown), logging it; it does not throw
             after `end`, since an answer may race the process's end."
           - `CLAUDE_PERMISSION_TOOL` and `PERMISSION_TOOL_NAME` leave `src/contracts/agent.ts` for
             `permission-route.ts`. `CLAUDE_PERMISSION_TOOL` keeps today's literal
             `mcp__plugin_wigley_wigley-forms__permission_prompt`; it is Claude's name for the marketplace plugin's
             server, not the app's server name, so it does not read `PlatformRelay.serverName` from task 06. (drafter)
           - The `claude-code` plugin contributes the tool itself: its manifest gains `dependsOn.main: ['sessions']`;
             `main/start.ts` builds one route, passes it to the adapter, and calls
             `sessions.contributeTools(PERMISSION_TOOLS, (session) => route.toolSession(session))`. The contribution
             lives and dies with the part (plan.md § Decisions; design.md § Permission prompts). The
             `dependsOn.main: ['sessions']` change needs no test of its own: `api.dependency(sessionsMainKey)`
             compiles only for an id the manifest's `dependsOn.main` lists (`MainApi.dependency` in
             `src/contracts/plugin.ts`); the part harness throws `part harness: fake dependency "sessions" is not in
             claude-code's dependsOn.main` for a fake dependency the manifest leaves out
             (`src/shared/plugin-part-harness.test-support.ts`), so `start.test.ts` fails without it; and
             `src/plugins/manifests.test.ts` › `manifests_DefaultDisabled_BreaksNoDependency` checks that the default
             `plugins.disabled` list turns off no plugin `claude-code` depends on.
           - `ClaudeCodeHarnessDeps.permissionTool: string` goes; the deps gain `permissions: PermissionRoute`, and
             `claudeLaunch` takes `CLAUDE_PERMISSION_TOOL` from `permission-route.ts` instead of a parameter. (drafter)
           - Routing (`permission-route.ts`, internals drafter):
             - `PERMISSION_TOOLS`, `readPermissionRequest` (renamed `readPermissionCall`, its three error texts
               unchanged: `permission_prompt: tool_name must be a string`, `permission_prompt: input is missing`,
               `permission_prompt: tool_use_id must be a string`), `permissionReplyText` and `DEFAULT_DENY_MESSAGE`
               (`The user denied this tool call.`) move here from chat's `permission-tool.ts`, bytes unchanged.
               `CANCELLED_REASON` (`The tool call was cancelled before the user answered.`) moves here too.
             - `route(rowId, target: Promise<PermissionTarget | null>): Disposable` records the row's process. A
               later `route` for the same row replaces the earlier; a dispose removes only its own record.
               `PermissionTarget` is `{ ask(call, signal): Promise<string> }`, resolving to the reply text.
             - `toolSession(session)` answers each call by `session.id` (the row id), looked up at call time. A name
               other than `permission_prompt` throws `claude-code has no tool "<name>"`. Arguments
               `readPermissionCall` rejects give `errorResult(<its text>)`. A row with no record gives
               `errorResult(NO_PROCESS_TEXT)`, with `NO_PROCESS_TEXT` =
               `permission_prompt answers only for sessions the wigley-ai-gui app started and still runs.` A record
               whose target promise is still pending (the process is attaching) is awaited; a target that settles
               null or rejects gives that same error result.
             - The tool session's `end()` aborts every call it still has waiting, through a per-call abort that
               follows both the call's `signal` and `end()`. Sessions calls `end()` when the relay disconnects and
               when the contribution is disposed at the plugin's stop.
           - The adapter's side (`claude-code-harness.ts`):
             - `startClaudeProcess` calls `deps.permissions.route(request.rowId, Promise.resolve(target))` once the
               session exists. `attachClaudeProcess` calls `route(request.rowId, attached)` before `host.attach`, with
               a promise that settles to the target when the attach resolves a process, and to null when the host has
               none or a later step rejects. Each process disposes its record when it closes or detaches.
             - `ask(call, signal)`: on a signal already aborted it resolves the cancelled reply and makes no entry.
               Else it mints `{ kind: 'permission', id: 'permission-<n>', at: clock.now(), toolName, input,
               answer: null, raw: [<the call's arguments>] }`, `<n>` counting this process's calls from 1 (outside the
               fold's counters: a replay cannot rebuild it, as with `control-notice-kill`), holds it waiting, and
               emits `permission({ entry })`.
             - `answerPermission(id, decision)` on a waiting id resolves the call with
               `permissionReplyText(decision, input)` and emits the entry with `answer: decision`. Any other id logs
               `answerPermission for <id> ignored: not waiting` (source `claude`).
             - Cancel: the call's abort, the tool session's `end()`, and the process's close each settle the waiting
               call with `permissionReplyText({ allowed: false, reason: CANCELLED_REASON }, input)` and emit the entry
               with `answer: { allowed: false, reason: CANCELLED_REASON }`. On close these entries go out before
               `sessionEnded` and `ended`. `detach()` settles every waiting call with the cancelled reply and emits
               nothing.
           - Plugin stop while a request waits: the contribution's dispose ends every tool session, so each waiting call
             is cancelled as above; the hosted process keeps running (design.md § A harness reloading).
           - Chat's side (`chat-sessions.ts`):
             - `processEvents` gains `permission(request)`: only while the process is live. An `unattended` row calls
               `process.answerPermission(request.entry.id, { allowed: false, reason: UNATTENDED_REASON })` at once and
               writes nothing (auto-retro relies on it; the adapter's answered entry shows the deny). Any other row
               writes `rowEntryOf(request.entry, processStart)`, records the pending request by its row entry id
               (holding the process start and `request.entry.id`), and runs `updateActivity`.
               `UNATTENDED_REASON` moves into `chat-sessions.ts`, bytes unchanged.
             - `answerPermission(sessionId, entryId, answer)` keeps its signature. For a pending row entry id it drops
               the pending record, calls `process.answerPermission(<the request id>, answer)` on the row's current
               process, and runs `updateActivity`; an unknown id logs `answerPermission for unknown entry <id>
               ignored` as today.
             - The `entry` handler drops the pending record of a permission entry that arrives with `answer` set.
             - A process's `ended`, `drop` and the clear path clear the row's pending records; they write no entry and
               resolve no call (the adapter does both). `PendingPermission`, `askPermission`, `permissionCall`,
               `settlePermission`, `cancelPending`, `showPendingCancelled`, `settleAllAsAborted`,
               `permissionToolSession` and the `permissionToolSession` member of `ChatSessions` go.
             - `shownActivity` still reads `waiting` while the row has a pending record.
           - Chat's `start.ts` stops contributing `PERMISSION_TOOLS`; the `set_headless` and `start_session`
             contributions stay.
           - The fake (`src/shared/fake-agent-harness.ts`):
             - `askPermissionsWith` and `FakePermissionAsk` go. The fake's process implements `answerPermission`,
               recorded as `{ method: 'answerPermission'; requestId: string; decision: PermissionDecision }` in
               `FakeAgentCall`.
             - A `fake: permission` turn starts its Bash tool, raises `permission({ entry })` with entry id
               `fake-permission-<n>` (`<n>` counting the process's requests), and waits. An answer emits the answered
               entry and finishes the tool, allowed `{ text: 'fake', isError: false }`, denied
               `{ text: 'Permission denied', isError: true }`; the turn then closes as today, unless an interrupt, a
               later send or the end came while it waited.
             - `askPermission(rowId, call)` raises the same request on the newest record whose `request.rowId` is
               `rowId` and that is neither ended nor detached; it rejects `fake harness has no live process for row
               <rowId>` when there is none. It resolves to chat's decision, or to `{ allowed: false, reason:
               CANCELLED_REASON }` with the cancelled entry when the process ends first. The fake keeps its own copy
               of the cancel text: `src/shared` may not import a plugin's `main/`.
           - Chat's fixtures and drive actions: `askFixturePermission(fake: FakeAgentHarness, rowId, request)` resolves
             the fake's `askPermission`. `chat.askPermission` runs only under the fake harness (the existing
             `fakeHarness()` lookup), since chat can no longer raise a card for a real Claude process; it still
             returns `{ toolUseId }`. `chat.permissionAnswer` returns the decision `{ allowed, reason }` once answered,
             else `{ pending: true }`. The drive skill's line says so. (drafter)
           - The self-test: `ChatSelfTestResult.permission` becomes `PermissionDecision | null`; the fixture's
             permission is asked through the fake that started the self-test's process (null when there is none);
             `fixtureProblems` reports `permission answer <JSON of the decision>` unless it is
             `{ allowed: true, reason: null }`. `ALLOW_REPLY`, `fakePermissionAsk` and the `askPermissionsWith` call in
             `open` go. Every expected log line stays (`[chat] permission entry added in chat-selftest`, `[chat]
             focused permission entry`, and the rest): the page logs on the entry, which still arrives.
Mandatory: AGENTS.md § Architecture: "An agent harness", "An MCP tool", "A plugin talks", "A registration", the
           `npm run lint` layer paragraph, and § Running and testing on the self-test; `docs/features/agent-harnesses/
           design.md` (whole); `docs/features/agent-chat/design.md` § Permissions; `docs/features/agent-chat/
           claude-stream.md` § Permission tool; `wigley:writing-code`, `wigley:writing-tests` and its
           `typescript-vitest.md`
GIVEN Claude calls `permission_prompt` for row R WHEN R's process runs THEN the process emits `permission` with an
      unanswered entry `permission-1` holding the tool name, input and `raw: [args]`, and the call waits
GIVEN a waiting request WHEN chat answers it allowed THEN the call's reply is
      `{"behavior":"allow","updatedInput":<input>}` and the answered entry follows through `entry`
GIVEN a waiting request WHEN chat answers it denied with reason null THEN the reply is
      `{"behavior":"deny","message":"The user denied this tool call."}`
GIVEN an unattended row WHEN its process raises a request THEN chat answers `{ allowed: false, reason:
      UNATTENDED_REASON }` at once, writes no unanswered entry, and the denied entry shows
GIVEN a call for a row with no live Claude process WHEN it arrives THEN it returns an error result with text
      `permission_prompt answers only for sessions the wigley-ai-gui app started and still runs.`
GIVEN a row whose process is attaching WHEN a call arrives THEN it waits for the attach and is then asked
GIVEN a waiting request WHEN the process closes THEN the call gets the cancelled deny and the cancelled entry comes
      before `ended`
GIVEN a waiting request WHEN the call aborts or its tool session ends (relay gone, plugin stop) THEN the call gets the
      cancelled deny and the cancelled entry shows
GIVEN a waiting request WHEN the process detaches THEN the call gets the cancelled deny and no event follows
GIVEN a pending card WHEN chat's row waits on it THEN the row's activity reads `waiting`, and `idle` once answered
Tests:     - `permission-route.test.ts` › `readPermissionCall_readsTheDocumentedShape` and
             `readPermissionCall_namesTheWrongField` — moved from `permission-tool.test.ts`, cases unchanged
           - `permission-route.test.ts` › `toolSession_RoutesByRowId` — two rows each with a target; a call on row
             `row-a` reaches only `row-a`'s target and returns `textResult(<its reply>)`
           - `permission-route.test.ts` › `toolSession_NoProcess_ErrorResult` — table: no record; a dispose removed
             it; the target promise settled null; it rejected — each `errorResult(NO_PROCESS_TEXT)`
           - `permission-route.test.ts` › `toolSession_TargetPending_WaitsForIt` — the call resolves only after the
             pending target promise resolves
           - `permission-route.test.ts` › `toolSession_End_AbortsWaitingCalls` — the target sees its signal aborted
           - `permission-route.test.ts` › `route_LaterRouteReplaces_DisposeRemovesOnlyItsOwn`
           - `permission-route.test.ts` › `toolSession_UnknownTool_Throws` — `claude-code has no tool "x"`
           - `claude-code-harness.test.ts` › `permission_CallRaisesRequestWithMintedEntry` — the request's entry is
             `{ kind: 'permission', id: 'permission-1', at: <clock>, toolName: 'Write', input: { file_path: 'a.txt' },
             answer: null, raw: [<args>] }`; a second call mints `permission-2`
           - `claude-code-harness.test.ts` › `answerPermission_RepliesAndEmitsTheAnsweredEntry` — table: allowed
             `{ allowed: true, reason: null }` → `{"behavior":"allow","updatedInput":{"file_path":"a.txt"}}`; denied
             null → the default deny message; denied `'no'` → `{"behavior":"deny","message":"no"}`
           - `claude-code-harness.test.ts` › `answerPermission_NotWaiting_LogsAndIgnores`
           - `claude-code-harness.test.ts` › `permission_Cancelled` — table: call aborted, tool session ended, process
             closed (the cancelled entry before `sessionEnded` and `ended`), process detached (reply only, no event)
           - `claude-code-harness.test.ts` › `permission_AttachingRow_WaitsThenAsks` — a call during `attach` is asked
             once the attach resolves; it errors with `NO_PROCESS_TEXT` when the attach resolves null
           - `src/plugins/claude-code/main/start.test.ts` › `start_ContributesPermissionTools_StopDisposesThem` —
             `startMainPart` (task 03's setup) with a fake `sessions` dependency whose `contributeTools(tools, start)`
             records `tools` and `start`, and returns a handle whose `dispose` counts and calls `end()` on every tool
             session `start` built (standing in for sessions, which does this: `session-list.test.ts` › `ends a
             disposed contribution in every live session and frees its names`). After start: one contribution, its
             tool names `['permission_prompt']`. A tool session built through the recorded `start` for a row with no
             process answers `permission_prompt` with `errorResult(NO_PROCESS_TEXT)`, so the contributed tool session
             is the route's. After `harness.stop()`: the dispose count is 1, and the tool session's `end()` ran once.
             No session host is faked here (the part harness leaves `sessionHost` unfaked), so a waiting call is not
             built in this test: `permission-route.test.ts` › `toolSession_End_AbortsWaitingCalls` and
             `claude-code-harness.test.ts` › `permission_Cancelled` (row "tool session ended") prove that `end()`
             cancels a waiting call with the reply
             `{"behavior":"deny","message":"The tool call was cancelled before the user answered."}`
           - `claude-launch.test.ts` — the existing `--permission-prompt-tool` case expects
             `mcp__plugin_wigley_wigley-forms__permission_prompt`
           - `chat-sessions.test.ts` — the permission cases rewrite to the fake: each `permissionToolSession(…).call`
             becomes `harness.askPermission(<row id>, call)`, and each assertion on the reply text becomes one on the
             fake's recorded `answerPermission` call. Keep: `permission_callAddsAWaitingEntry`,
             `permission_allow_repliesWithTheInput` (now: records `{ allowed: true, reason: null }`),
             `permission_deny_defaultAndReason`, `permission_twoPending_staysWaiting`,
             `permission_sessionEnds_answersCancelledAndShowsIt` (now: the fake's cancelled entry shows and the row
             leaves `waiting`), `permission_rowCloses_answersCancelledWithNoEntry` (now: no `answerPermission` call
             and no pending record), `permission_unknownEntry_ignored`, `send_HarnessIdleWithPermissionWaiting_
             WritesAtOnce`, `restore_UnattendedRecord_DeniesPermissionAtOnce` (now: one `answerPermission` call with
             `UNATTENDED_REASON` and no unanswered entry ever written). Delete, since the adapter and route own them
             now: `permission_abort_answersDenied`, `permission_alreadyAborted_noEntry`,
             `permission_unownedSession_errorResult`, `permission_toolSessionBeforeStart_reachesFlowAfterStart`,
             `permission_badArgs_errorResult`, `permission_RowAttaching_WaitsThenAsks`
           - `chat-sessions.test.ts` › `permission_AnswerForAnOldProcess_Ignored` — a pending card from the row's
             first process, then a clear: answering its entry calls no `answerPermission` and logs the unknown entry
           - `start.test.ts` — the contribution cases expect no `permission_prompt` contribution from chat;
             `permissionAnswer is pending until the user answers, then the reply` expects `{ allowed: true,
             reason: null }`; `askPermission rejects a resting session and raises no card` stays; add
             `askPermission_NoFakeHarness_Rejects` with `chat runs on no fake harness`
           - `fake-agent-harness.test.ts` › `send_PermissionText_AsksThenFinishesTheTool` — rows become: allowed →
             tool result `fake`, reply as today; denied → `Permission denied`, `fake agent was refused`. The `ask
             failing` and `no ask set` rows go. `send_PermissionText_InterruptedWhileAsking_EmitsNothingOnTheAnswer`
             and `heldCompaction_LateAnswerToAnInterruptedPermissionTurn_LeavesItOpen` answer through
             `answerPermission` instead of the ask
           - `fake-agent-harness.test.ts` › `askPermission_RaisesOnTheRowsLiveProcess` — table: live row → resolves
             chat's decision; no live record → rejects `fake harness has no live process for row r9`; process ends
             first → resolves the cancelled decision and emits the cancelled entry
           - Self-test: `src/plugins/chat/main/selftest-script.ts` keeps its permission steps ("permission cursor",
             "permission card", the needs-you status step); they now run through `events.permission`, so the fixture
             step proves the route from the fake to the card and back through `answerPermission`. No step is added.
Done when: `npm run lint` and `npm run typecheck` pass; `grep -rn 'CLAUDE_PERMISSION_TOOL\|PERMISSION_TOOL_NAME'
           src/contracts src/plugins/chat src/main` prints nothing; the test gate runs the tests above and the chat
           self-test
Commit:    one commit for the group; it also removes "Permission behind the harness" from `docs/features/followups.md`
           § Harness seams, ticks its box in `docs/features/intent-alignment/master-plan.md` step 3, rewrites
           `docs/features/agent-chat/design.md` § Permissions' first sentence to "anything that mode would still prompt
           reaches Claude's `permission_prompt` MCP tool, which the `claude-code` plugin contributes to sessions and
           routes by the row id to the session's process; the process raises a permission request and chat shows it as
           a permission entry", replaces `<chat's tool>` in its launch line with `<the claude-code plugin's tool>`, and
           updates the drive skill's `chat.askPermission` line to "under the fake harness returns a `toolUseId` at
           once; `chat.permissionAnswer` with that id answers `{ pending: true }` until the card is answered, then the
           decision `{ allowed, reason }`"

## Proof

