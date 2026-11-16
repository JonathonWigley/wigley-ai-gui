# 09 — Owned sessions join by row id

Status: not started
Type: Task
Wave: 6 · Depends on: 06, 08
Plan: [plan.md](plan.md)

Files (wigley-ai-gui):
- modify `src/contracts/agent.ts` — `AgentStart.sessionId`, `AgentProcessEvents.sessionId`, their comments
- modify `src/plugins/sessions/contract.ts` — `SessionInfo.rowId`, `RelayHello.row_id`, the comments of `connect`, `open`, `OwnedSession` and `SessionsMainEvents`
- modify `src/plugins/sessions/main/relay/relay-server.ts` — parse `row_id`
- test `src/plugins/sessions/main/relay/relay-server.test.ts`
- modify `src/plugins/sessions/main/session-list.ts` — `open` with no host id, `connect` by row id, `join`, `adopt`
- test `src/plugins/sessions/main/session-list.test.ts`
- modify `src/plugins/sessions/main/start.ts` — `driveSessionInfo` reads `rowId`; the drive actions' `sessionArgs` text
- test `src/plugins/sessions/main/start.test.ts`
- modify `src/plugins/claude-code/main/claude-code-harness.ts` — mint, pass and report the session id
- modify `src/plugins/claude-code/main/claude-launch.ts` — takes the resolved request type
- test `src/plugins/claude-code/main/claude-code-harness.test.ts`, `src/plugins/claude-code/main/claude-launch.test.ts`
- modify `src/shared/fake-agent-harness.ts` — mint and report an id
- test `src/shared/fake-agent-harness.test.ts`
- modify `src/plugins/chat/main/chat-sessions.ts` — chat stops minting host ids
- test `src/plugins/chat/main/chat-sessions.test.ts`
- modify `src/plugins/chat/main/start.ts` — drive `start`, exports `clear`, `callerGuard`'s `owns`, `randomUuid` leaves chat's deps
- test `src/plugins/chat/main/start.test.ts`
- modify `src/plugins/chat/contract.ts` — comments of `sessionOpened`, `sessionCleared`, `clear`
- modify `src/plugins/chat/main/selftest-script.ts` — the relay joins by row id
- modify, `rowId: null` added to each `SessionInfo` literal. Non-test files (measured at plan time, re-verify with `npm run typecheck`):
  - `src/plugins/chat/main/chat-sessions.ts` — the info chat's own `sessions.open` takes (line 1527 at plan time); `open` ignores `info.rowId`
  - `src/plugins/workflow/main/start.ts` — `selfTestToolSession`'s `info` (line 410 at plan time)
  - `src/plugins/chat/main/preview/chat-preview.ts`, `src/plugins/agents/main/preview.ts`
  - `src/plugins/docs/main/selftest-script.ts`, `src/plugins/notes/main/selftest-script.ts`, `src/plugins/forms/main/selftest-script.ts` (the `connect` helper and the idle `sessions.open`), `src/plugins/primer/main/selftest-script.ts`, `src/plugins/sessions/main/selftest-script.ts`
  - `src/plugins/forms/main/preview/layout-preview.ts`, `src/plugins/primer/main/preview/primer-preview.ts` (each `PREVIEW_SESSION`)
  - `src/shared/agent-forms/drive-actions.ts`
  - `src/plugins/sessions/main/start.ts` (`driveSessionInfo`) and `src/plugins/sessions/main/relay/relay-server.ts` (`sessionInfo`) set it as the Decisions below say
  - `src/plugins/chat/main/fixtures.ts` holds one today (`askFixturePermission`); task 08 removes it, so it needs none here
  Test files: every literal `npm run typecheck` names. Measured at plan time, re-verify: `src/plugins/agent-form-fakes.test-support.ts`, `src/plugins/sessions/contract.test-support.ts`, `src/plugins/chat/main/{chat-sessions,set-headless-tool,start-session-tool,start}.test.ts`, `src/plugins/docs/main/start.test.ts`, `src/plugins/forms/main/preview/layout-preview.test.ts`, `src/plugins/forms/main/start.test.ts`, `src/plugins/notes/page/start.test.ts`, `src/plugins/practice/main/{practice-sessions,practice-tools}.test.ts`, `src/plugins/primer/main/preview/primer-preview.test.ts`, `src/plugins/primer/main/start.test.ts`, `src/plugins/session-log/main/start.test.ts`, `src/plugins/sessions/main/{consumer-view,session-list,start,title-tool}.test.ts`, `src/plugins/sessions/main/relay/relay-server.test.ts`, `src/plugins/workflow-large-main.test.ts`, `src/plugins/workflow/main/{checklist-tool,headless-line,start,step-tool}.test.ts`, and the tests under `src/plugins/{agents,auto-retro}/` that tsc names
- modify `docs/features/agent-chat/design.md` — § Flow (the `sessions.open` line: no host id for a new session; the relay line: joins by row id), § Sessions and tabs (the join), and § Chat plugin's **Saved sessions** bullet (a new session is first saved once its harness reports its id) and **Clear** bullet (the host id moves when the fresh process reports it)
- modify `docs/features/agent-chat/claude-stream.md` § Launch — the `WIGLEY_SESSION_ROW` sentence adds that the relay's hello carries it as `row_id`; the base flags line before § Launch (`--session-id <fresh uuid4>`) stays
- modify `docs/features/followups.md` — remove the "Owned sessions join by an adapter key" item
- modify `docs/features/intent-alignment/master-plan.md` — tick its box

Files (wigley-ai-marketplace, `~/Documents/ai/wigley-ai-marketplace`):
- modify `plugins/wigley/scripts/forms/relay.py` — `hello_from_env` gains `row_id`
- test `plugins/wigley/scripts/forms/tests/test_relay.py`
- modify `plugins/wigley/scripts/forms/README.md` — § The relay's **Hello** bullet names `row_id`
- modify `plugins/wigley/.claude-plugin/plugin.json` and `plugins/wigley/.codex-plugin/plugin.json` — the version bump

Consumes:
- `AgentHarnessRegistry`, `services.agentHarnesses` ← 01; a session's harness is an open string ← 01
- `src/plugins/claude-code/main/claude-code-harness.ts`, `claude-launch.ts` (moved) ← 03
- `AgentProcessEvents.permission`, `AgentProcess.answerPermission` ← 08 (this task edits the same contract after it)
- `harnessToolUseId`, `McpServeOptions` ← 06 (this task edits `src/plugins/sessions/main/start.ts` after it)
- `OwnedSession.setHostSessionId(hostSessionId: string): void` — today's tree
- `ClaudeCodeHarnessDeps.randomUuid` — today's tree

Produces:
- `sessionId: string | null;` in `src/contracts/agent.ts` (`AgentStart`)
- `sessionId(id: string): void;` in `src/contracts/agent.ts` (`AgentProcessEvents`)
- `rowId: string | null;` in `src/plugins/sessions/contract.ts` (`SessionInfo`)
- `row_id?: string | null;` in `src/plugins/sessions/contract.ts` (`RelayHello`)
- `export type ClaudeStart = Omit<AgentStart, 'sessionId'> & { sessionId: string };` in `src/plugins/claude-code/main/claude-launch.ts`
- `hostSessionIdSettled(sessionId: string): Promise<string>;` in `src/plugins/chat/main/chat-sessions.ts` (`ChatSessions`)
- `sessionId: string;` in `src/shared/fake-agent-harness.ts` (`FakeAgentProcessRecord`: the id the process reported)
- `"row_id": env.get("WIGLEY_SESSION_ROW") or None,` in `plugins/wigley/scripts/forms/relay.py` (marketplace)

Decisions:
- An owned session joins its relay by row id; the hello gains `row_id`; `open` needs no host id (plan.md § Decisions). `SESSION_ROW_ENV` (`'WIGLEY_SESSION_ROW'`, `src/shared/session-env.ts`) already holds `AgentStart.rowId` in the Claude process's environment (`claude-launch.ts`), so the relay reads the app's row id.
- Every adapter reports its session id through `events.sessionId`; `AgentStart.sessionId` is null for a new session (plan.md § Decisions). The Claude adapter mints the uuid itself (design doc § Profiles and the default harness).
- `AgentStart.sessionId` (comment rewritten): null asks the harness for a new conversation, whose id the adapter mints or learns and reports; a string with `resume` false starts a conversation under that id (a row whose earlier start never got a message); a string with `resume` true resumes it. `attach` always gets a string from chat.
- `AgentProcessEvents.sessionId` (comment): the id the process's conversation runs under. Each `start` calls it once, before every other event of that process, in a later microtask like every event; each `attach` calls it once, first, before its promise resolves. Chat then emits every `agentEvent` with a host id, and holds no buffer of early events.
- The join rule (plan.md § Decisions; design doc § Joining an app-started session). `connect(info)` checks, in this order:
  1. `info.rowId` names an owned entry, and that entry's host id is null, or `info.sessionId` is null, or `info.sessionId` equals the entry's host id: join that entry.
  2. `info.sessionId` is held by an owned entry: join it (today's rule; an older relay sends no `row_id`).
  3. `info.sessionId` is in an entry's `retiredHostIds`: throw `Host session <id> was retired by session <app id>` (today's text). A relay of a cleared row's old process says its row id and the old host id, so it lands here and is refused.
  4. Otherwise connect a session of its own, keeping `info.rowId` on its info. A nested `claude -p` inside an app session, whose hello carries the row id and a different session id, lands here.
  A `rowId` that names a connected (not owned) entry, or no entry, counts as none.
- "A newer relay takes the join" holds for every join path: `join` replaces `joinedBy` as today, so a newer relay joined by row id takes the join from an older one joined by row id or host id.
- A join and its refusals (drafter, to keep today's "calls are refused once the session moves off the host id it joined under"): `join(entry, helloSessionId)` holds `joinedHostId = entry's host id ?? helloSessionId`. Each call's refusal check reads the entry's current host id `hostId`: null passes; else `joinedHostId` null takes `hostId`; then `hostId === joinedHostId` passes, any other value refuses with today's text `Session <app id> moved from host <joinedHostId> to <hostId>`.
- `setHostSessionId` on an entry whose host id is null sets it, retires nothing and keeps `joinedBy` (today's code retires only a non-null old id). It writes the row and emits `hostSessionChanged` as for a move, so docs' session source (`src/plugins/docs/main/start.ts`) is rebuilt with the host id. Workflow's `hostSessionChanged` handler (`src/plugins/workflow/main/start.ts`) changes nothing for a row it holds no flow for: `apply` and `store.rekey` ignore an unheld session (verified at plan time).
- `open(info, options)`: a null `info.sessionId` opens the row with a null host id and skips the host-held check. A kept row adopted with a null `info.sessionId` keeps its own host id (`adopt` calls `setHostSessionId` only for a non-null id). `open` ignores `info.rowId`: the row id comes from `options.rowId`.
- `SessionInfo.rowId` (comment): the owned row a relay's hello names (`row_id`, the process's `WIGLEY_SESSION_ROW`); null when the hello names none, and for every info a plugin builds itself.
- `relay-server.ts`: `row_id` joins `SESSIONS_HELLO_FIELDS` and `mistypedHelloField`'s checks (optional string, after `config_dir`); `sessionInfo` sets `rowId: hello.row_id ?? null`. `RelayHello.row_id` comment: "Absent reads as null."
- Chat stops minting host ids: the harness mints or learns the id and reports it. `HeldSession.hostId` becomes `string | null`: null for a new session from its open until its harness reports an id. `startNew` passes `hostId: null`. `randomUuid` leaves `ChatSessionsDeps` and chat's `start.ts` wiring of it, since no use is left (chat's drive `askPermission` keeps `services.randomUuid`).
- The process id leaves the host id (drafter; the session host takes any id the app chooses, `session-host/design.md` § Vocabulary): `startProcess` sets `session.processId = \`${session.sessionId}-${session.processStarts}-${now}\``. Saved records keep their old ids, which `attach` takes as they are.
- `startProcess` passes `sessionId: session.pendingClear !== null ? null : session.hostId`.
- One step adopts a reported id (drafter), `adoptHostId(session, id)`, called by the process's `sessionId(id)` handler while the event is live (`isLive`). It returns at once when `id` equals `session.hostId` and no clear is pending. Else it:
  1. calls `session.owned.setHostSessionId(id)`; a throw (another session holds `id`) is logged as `session <row id> not moved to host <id>: <error text>` and the step stops, the row unchanged;
  2. sets `session.hostId = id`;
  3. emits the deferred `sessionOpened` when one is pending;
  4. emits the pending `sessionCleared` with `oldHostSessionId` the pre-clear id, `newHostSessionId` `id`, `sent` the pre-clear `sent`, and the row's titles, folder and profile;
  5. resolves the row's `hostSessionIdSettled` waiters with `id`;
  6. calls `save()`.
- `processEvents` keeps `let hostSessionId = session.hostId`, and its `sessionId(id)` handler sets it before calling `adoptHostId`. `agentEvent` and `processEnded` keep emitting that variable, so an old process ending after a clear keeps its old id, as today.
- `sessionOpened` for a row opened with a null host id fires from `adoptHostId`, after the sessions row holds the id; a row with a host id (restored, resumed, attached) fires it at open, as today. A row that closes first fires neither `sessionOpened` nor `sessionClosed`, as a pool project's row whose claim fails (chat contract comment on `sessionOpened`). `HeldSession` holds the pending origin (drafter: `pendingOpened: SessionOrigin | null`). This moves the moment other plugins hear `sessionOpened` for a new row to the harness's report, one microtask after the start for Claude and the fake.
- Clear, so the saved file never pairs an old host id with a fresh conversation: `clear` no longer mints and no longer calls `setHostSessionId`. It keeps `session.hostId` at the old id, sets `pendingClear = { sent: <the old sent> }`, sets `sent` false, replaces the entries and starts the fresh process with `sessionId: null`. `sessionCleared` fires from `adoptHostId`. `conversation cleared in <folder name>` is still logged in `clear`, after the start. A clear of a row whose host id is null sets no `pendingClear`: nothing was reported, so nothing is cleared for listeners.
- A clear whose start throws leaves the row resting with the clear pending. Its next start passes `sessionId: null`, and that start's report fires `sessionCleared`. The `clear` comment in `ChatSessions` changes from "leaves the row resting under the new id, then rethrows, with `sessionCleared` already fired" to that.
- While a clear is pending, `sessionClosed`, the compaction `agentEvent` and every lookup by host id use the old id, and the snapshot saves the row with the old id and the pre-clear `sent` (drafter). A relaunch in that window brings back the old conversation; the window is one microtask for Claude and the fake.
- `snapshot` leaves out a row whose host id is null (drafter, matching agent-chat design § Saved sessions: "a start that fails leaves no record"). `openAndStart`'s failed-start path calls `keepSkipped` only for a non-null host id.
- Selection is held by row id (drafter): `selectedHostId` becomes `selectedRowId`, set in `openRow` (select), in `restore` and in `selected`; `snapshot` writes `selectedHostSessionId: held.get(selectedRowId)?.hostId ?? null`, null also when that row is left out. The clear's selection update (`if (selectedHostId === oldHostId)`) goes. The saved file's shape is unchanged.
- `requireNotDetached` takes a label: `openAndStart` passes `opening.hostId ?? \`in ${projectDir}\``, so the text reads `session in <folder> not started: chat is stopping` for a new session (drafter).
- No send gate runs while the row's host id is null (drafter): a new conversation has nothing to compact, and `SendGateInput.hostSessionId` stays `string`.
- `hostSessionIdOf(sessionId)` keeps its type; its comment adds "and for a held row whose harness has not reported an id yet".
- `hostSessionIdSettled(sessionId)`: resolves at once with the host id when the row holds one and no clear is pending; else resolves from `adoptHostId`. It rejects with `chat holds no session <id>` for a row chat does not hold, and with `session <id> closed before its harness reported a session id` when the row closes first.
- Chat's drive action `start` (`src/plugins/chat/main/start.ts`) awaits `chat.hostSessionIdSettled(sessionId)` in place of the synchronous `hostSessionIdOf` read and its `holds no host id` throw. Its description stays.
- Chat's exports `clear` awaits `chat.hostSessionIdSettled(sessionId)` after `chat.clear(sessionId)`, so its contract line "`sessions.hostSessionChanged` is emitted before it resolves" stays true (`src/plugins/workflow-large/main/actions.ts` relies on it).
- `callerGuard`'s `owns` becomes `(sessionId) => chat.activeTimeOf(sessionId) !== null` (null only for a row chat does not hold), so a row with no host id yet still counts as chat's (drafter).
- The Claude adapter (lines at the old path `src/main/claude-code/claude-code-harness.ts`, measured at plan time, re-verify): `startClaudeProcess` (line 745) builds `const started: ClaudeStart = { ...request, sessionId: request.sessionId ?? deps.randomUuid() }` and hands `started` to `claudeLaunch`, `createSessionFoldState`, `createClaudeSession`, `loadSessionDefinitions` and `readSessionReplies` in place of `request`. It queues `events.sessionId(started.sessionId)` with `queueMicrotask` before `deps.host.spawn`, so it precedes every emission the session queues.
- `attachClaudeProcess` (line 798) rejects with `Error('attach needs a session id')` for a null `request.sessionId`, before `deps.host.attach`. After that check it builds `const started: ClaudeStart = { ...request, sessionId: request.sessionId }` (TypeScript does not narrow `request` from its field's check), calls `events.sessionId(started.sessionId)` before the replay's events, and hands `started` to `createSessionFoldState`, `loadSessionDefinitions`, `readSessionReplies` (lines 810–813) and `createClaudeSession` in place of `request`.
- Parameter types: `claudeLaunch`'s `request` (`claude-launch.ts` line 60; it reads `request.sessionId` at line 90), `readSessionReplies`'s `request` (line 685; it passes `request.sessionId` to `readSavedReplies` at line 695) and `loadSessionDefinitions`'s `request` (line 672) become `ClaudeStart`, so the adapter's helpers take one started-request type. `createClaudeSession` (line 258) and `createSessionFoldState` (`session-fold.ts` line 242) read no `sessionId` and keep `AgentStart`; a `ClaudeStart` is assignable to it.
- The fake: `start` with a null `request.sessionId` mints `fake-session-<n>`, `n` counting from 1 per fake harness, and reports it; with a string it reports that string. It reports through `untilDetached`, before every other event of the start. `FakeAgentProcessRecord.sessionId` holds the reported id; `record.request` stays the request as given. `attach` reports `request.sessionId` first when it is not null. `untilDetached` gains `sessionId`.
- Every other `sessions.open` caller keeps passing its own host id, with `rowId: null`: `src/plugins/chat/main/preview/chat-preview.ts`, `src/plugins/agents/main/preview.ts`, the sessions drive action `open` (`src/plugins/sessions/main/start.ts`), and the self-tests of docs, notes, forms and sessions.
- The sessions drive actions' `sessionArgs` gain `rowId?: string`; `driveSessionInfo` sets `rowId: optionalString(args, 'rowId') ?? null`. A drive `connect` with a `rowId` joins as a relay would.
- Marketplace (design doc § Joining an app-started session): `hello_from_env` adds `"row_id": env.get("WIGLEY_SESSION_ROW") or None` after `config_dir`; its docstring adds "`row_id` is the app's row id for a session the app started". The README hello paragraph names `row_id` (`WIGLEY_SESSION_ROW`, the row id of a session the app started, which the app joins that row by), and its optional-fields sentence becomes "`harness`, `config_dir` and `row_id` are optional to the app, which reads an older relay that leaves them out as no harness, the default config folder and no row." plan.md settles that the README changes with `relay.py`, not ahead.
- Marketplace version: its `AGENTS.md` § Changing a plugin bumps `version` in both plugin manifests in the same commit. The patch goes up one from the version on the marketplace's `main` when the task runs (`2.3.3` → `2.3.4`, measured at plan time, re-verify).
- Compatibility: an app on this task with an older relay (no `row_id`) still joins by host id (rule 2), since chat sets the row's host id when Claude reports it, before the relay connects. An older app reads a newer relay's `row_id` as a host field (`SessionInfo.host`).
- Out of scope, for the Codex plan: a harness that reports its id after its relay connects meets rule 1's "host id is null" only on a new row; after a clear, the row still holds the old id, so a relay that connects before the report connects as its own session.

Mandatory:
- `AGENTS.md` § Architecture: "A plugin talks", "An MCP tool", "An agent harness", "A session control", and the sessions plugin's entry (the owned-session paragraph).
- `docs/features/agent-harnesses/design.md` — whole.
- `docs/features/agent-chat/design.md` — § Sessions and tabs, and § Chat plugin's **Saved sessions** and **Clear** bullets.
- `docs/features/session-host/design.md` § Vocabulary.
- The marketplace's `AGENTS.md` § Changing a plugin and § Done, and `plugins/wigley/scripts/forms/README.md` § The relay, its **Hello** bullet.
- `~/wigley-agents/WigleyRepos.md` § Landing, for the marketplace commit.

GIVEN a relay hello with `row_id` WHEN sessions parses it THEN `info.rowId` holds it and `info.host` does not.
GIVEN a hello whose `row_id` is not a string or null WHEN sessions parses it THEN it refuses with `relay hello field row_id has the wrong type`.
GIVEN `open` with a null host id WHEN it runs THEN the row opens with `hostSessionId` null.
GIVEN an owned row WHEN a hello names its row id under the join rule THEN the relay joins that row and adds none.
GIVEN an owned row with host `h1` WHEN a hello names its row id with session `h2` THEN the relay connects as its own session.
GIVEN a row moved from `h1` to `h2` WHEN a hello names its row id with session `h1` THEN the connect is refused as retired.
GIVEN a relay joined while the row had no host id WHEN the row's host id is first set THEN its calls still run, and a later move refuses them.
GIVEN chat starts a new session WHEN the harness starts THEN `AgentStart.sessionId` is null and the row has no host id.
GIVEN the harness reports `id` WHEN chat hears it THEN the row's host id is `id`, `sessionOpened` fires once with it, and the row is saved.
GIVEN a clear WHEN the fresh process reports `id` THEN `sessionCleared` fires with the old id and `id`.
GIVEN the Claude adapter gets a null session id WHEN it starts THEN it passes a fresh uuid as `--session-id` and reports that uuid first.
GIVEN the relay's environment has `WIGLEY_SESSION_ROW` WHEN it builds its hello THEN `row_id` holds that value.

Tests:
- `src/plugins/sessions/main/relay/relay-server.test.ts`
  - `refuses a hello whose %s has the wrong type and starts no session` — a row added: `['row_id', { row_id: 5 }]`.
  - `starts a session from hello $hello as $expected` — every `expected` gains `rowId: null`, and a row added: hello `{ ...HELLO, row_id: 'row-7' }` → `{ sessionId: 'session-1', projectDir: '/work/project', harness: 'claude', rowId: 'row-7', host: { deadline_seconds: 300 } }`.
- `src/plugins/sessions/main/session-list.test.ts` (the helpers `info` and `owned` gain `rowId: null`; `randomHex` ids read `00000001` and on)
  - `throws opening a session with no host id` is replaced by `open_NoHostId_OpensRowWithNullHost` — the row's `hostSessionId` is null; `connected` is emitted with `owned: true`; a second such open opens a second row.
  - `connect_HelloNamesOwnedRow_JoinsUnderTheRule` — `it.each` over an owned row (opened with host `rowHost`), then `connect({ ...owned(<hello>), rowId: '00000001' })`:
    | rowHost | hello `sessionId` | result |
    |---|---|---|
    | null | null | joins: `connected.session` is the owned session, one row |
    | null | `'host-9'` | joins |
    | `'host-1'` | `'host-1'` | joins |
    | `'host-1'` | null | joins |
    | `'host-1'` | `'host-2'` | own session: a new app id, two entries, `connected` emitted with `owned: false` |
  - `connect_RowIdOfRetiredHost_Refused` — open with `'host-1'`, `setHostSessionId('host-2')`; `connect` with `rowId: '00000001'`, `sessionId: 'host-1'` throws `/retired/`.
  - `connect_RowIdOfConnectedSession_ConnectsOwn` — a `rowId` naming a connected entry connects a new session.
  - `hands the join to a newer relay that says hello before the older one closes` (existing) — a case added in which the newer relay joins by `rowId` and the older one joined by host id; the older handle's `end` leaves the join alone.
  - `join_NoHostIdAtJoin_CallsRunUntilMovedOff` — open with null; join by row id with hello `sessionId` null; a call resolves; `setHostSessionId('host-1')`; a call resolves; `setHostSessionId('host-2')`; a call rejects `/moved from host host-1 to host-2/`.
  - `join_HelloIdDiffersFromFirstHostId_CallsRefused` — open with null; join by row id with hello `'host-9'`; `setHostSessionId('host-1')`; a call rejects `/moved from host host-9 to host-1/`.
  - `setHostSessionId_FromNoHostId_KeepsJoinAndEmitsChange` — open with null, join, `setHostSessionId('host-1')`: the row's `hostSessionId` is `'host-1'`, `hostSessionChanged` emitted once, a call through the join resolves.
  - `open_KeptRowNoHostId_AdoptsKeepingItsHost` — open with `'host-1'`, `keep()`, `open({ ...owned('x'), sessionId: null }, { select: true, rowId: '00000001' })` adopts: same session, host id `'host-1'`, no `connected` emitted.
- `src/plugins/sessions/main/start.test.ts` › `sessions drive actions` — `connect_RowIdArg_JoinsOpenedRow`: drive `open` (default id) then drive `connect` with `rowId` set to the `open` result's `rowId` and `sessionId: 'other'` → its `rowId` equals the opened row's.
- `src/plugins/claude-code/main/claude-code-harness.test.ts`
  - `start_NoSessionId_MintsPassesAndReportsIt` — deps' `randomUuid` answers `'uuid-1'` first: the spawn args hold `'--session-id', 'uuid-1'`, and the first event the process fires is `sessionId('uuid-1')`.
  - `start_GivenSessionId_ReportsIt` — request `sessionId: 's-1'`, `resume: false`: args hold `'--session-id', 's-1'`; first event `sessionId('s-1')`.
  - `attach_NullSessionId_Rejects` — rejects with `attach needs a session id`; the host's `attach` is not called.
  - `attach_ReportsSessionIdFirst` — the first replayed event is `sessionId('s-1')`.
- `src/plugins/claude-code/main/claude-launch.test.ts` — its request fixtures take `ClaudeStart`; no new test.
- `src/shared/fake-agent-harness.test.ts` › `start_NoSessionId_MintsCountingIds` — two starts with null report `'fake-session-1'` then `'fake-session-2'`, each first; a start with `'s-9'` reports `'s-9'`; `record.sessionId` holds each.
- `src/plugins/chat/main/chat-sessions.test.ts`: the `randomUuid` fake (line 526 at plan time) goes with the deps field. Every expectation of an id that fake minted (`uuid-<n>`) moves to the fake harness's `fake-session-<n>`, and every process id `uuid-<n>-<k>-1000` becomes `<row id>-<k>-1000`. A `uuid-<n>` the test writes as input data (a saved record, a `restoreOne` record, a `connected(…)` call, a `recordOpenHostId` argument) may stay. The `uuid-` lines measured at plan time, re-verify with `grep -n "uuid-" src/plugins/chat/main/chat-sessions.test.ts`: 575, 851, 859, 860, 900, 1477, 1521, 1528, 3477–3479, 3740, 3746, 4130, 4534, 4805, 4843, 4913, 4916, 4922, 4926, 4932, 4949, 4986, 5018, 5096, 5603, 5811, 5812, 5815, 7146, 7513, 8051, 8186, 8221, 8222, 8268, 8325, 8636, 8652, 8656, 8657, 8713, 8719, 8720, 8728, 8731, 8974. An expectation on a new row's `sessions.open` info `sessionId` (851 at plan time) or a new start's `record.request.sessionId` (860, 4913, 4916) reads `null`, since `record.request` stays the request as given, and the reported id is asserted on `record.sessionId`. So the clear at 4912–4932: `old.request.sessionId` is null and `old.sessionId` is `'fake-session-1'` (4913); `processes[1].request` holds `sessionId: null` and `processes[1].sessionId` is `'fake-session-2'` (4916); `hostIdChanges` (4922), the saved `hostSessionId` (4926) and `selectedHostSessionId` (4949) read `'fake-session-2'`; the process id `'uuid-2-2-1000'` (4932) reads `<row id>-2-1000`.
  - `startNew_NewSession_StartsWithNullAndAdoptsReportedId` — `processes[0].request.sessionId` is null; before the report `hostSessionIdOf` is null and no `sessionOpened` fired; after it `hostSessionIdOf` is `'fake-session-1'`, the sessions row's `hostSessionId` is `'fake-session-1'`, `sessionOpened` fired once with it, and the last save holds a record with it.
  - `startProcess_ProcessId_StartsWithRowId` — the existing process-id assertions (`'uuid-1-1-1000'` at 859 and 3746, `'uuid-1-1-1000'` and `'uuid-1-2-1000'` at 5811–5815) become `<row id>-1-1000` and `<row id>-2-1000`.
  - `openAndStart_StartThrows_NoOpenedNoClosedNoRecord` — `failNextStart`: no `sessionOpened`, no `sessionClosed`, no saved record.
  - `restart_NeverSentRow_PassesKnownHostId` — a row whose process ended before any message starts again with `sessionId: 'fake-session-1'`, `resume: false`.
  - `clear_FreshProcess_StartsWithNullAndFiresClearedOnReport` — the fresh start's `sessionId` is null; before its report `hostSessionIdOf` is the old id and no `sessionCleared` fired; after it `sessionCleared` fired once with `{ oldHostSessionId: 'fake-session-1', newHostSessionId: 'fake-session-2', sent: <the old sent> }`.
  - `clear_StartThrows_ClearPendingUntilNextStartReports` — `failNextStart` before `clear`: `clear` throws, no `sessionCleared`; the next send starts with `sessionId: null`, and its report fires `sessionCleared`.
  - `adoptHostId_IdHeldElsewhere_LogsAndKeepsRow` — the reported id is open in another row: the log line `session <row id> not moved to host <id>:` and the row's host id is unchanged.
  - `sendGate_NoHostId_NotRun` — a gate registered; a message written before the report runs no gate.
  - `hostSessionIdSettled_Cases` — `it.each`: a restored row resolves at once with its id; a new row resolves with the reported id; a pending clear resolves with the new id; a row closed before its report rejects `closed before its harness reported a session id`; an unknown row rejects `chat holds no session`.
  - `snapshot_SelectedNewRow_SavedByRowOnceIdArrives` — a new selected row saves `selectedHostSessionId: 'fake-session-1'` after its report.
- `src/plugins/chat/main/start.test.ts`
  - The drive `start` test — its result's `hostSessionId` is the fake's reported id, awaited.
  - `clear_Export_ResolvesAfterHostSessionChanged` — `sessions.hostSessionChanged` for the row is heard before the export's promise resolves.
- `plugins/wigley/scripts/forms/tests/test_relay.py` (marketplace)
  - `test_hello_reads_session_project_and_deadline_from_the_environment` — env gains `"WIGLEY_SESSION_ROW": "row-3"`; expected gains `"row_id": "row-3"`.
  - `test_hello_is_null_for_each_unset_value_and_codex_without_claudecode` — expected gains `"row_id": None`.
- Self-test: `src/plugins/chat/main/selftest-script.ts` `openSessions` — the relay's `sessions.connect` passes `{ sessionId: null, projectDir: selftest, harness: 'claude', rowId: id }`, so the chat round it asks proves the join by row id (today it passes `process.request.sessionId`, which is now null).

Approach:
- `connect` in `session-list.ts`: look up `entries.get(info.rowId)` only when `info.rowId` is not null and the entry is `owned`; then the rule's four steps in order. `join` takes the hello's `sessionId` as a second argument.
- `entriesHolding` keeps a `string` parameter; `open` calls it only for a non-null host id.
- `adoptHostId` lives beside `openRow` in `chat-sessions.ts`; the waiters for `hostSessionIdSettled` live on `HeldSession` and are rejected in `drop`.

Done when: compiles (`npm run lint` and `npm run typecheck`); the test gate runs the wigley-ai-gui tests above; from the marketplace root, `(cd plugins/wigley/scripts/forms && python3 -m unittest discover)`, `python3 scripts/check_manifests.py`, `python3 scripts/check_manifests.py --against origin/main`, `python3 scripts/check_pointers.py` and `claude plugin validate .` pass.

Commit: two commits in the one `ai` worktree, one per folder.
- wigley-ai-gui: one commit for the group. It also removes the "Owned sessions join by an adapter key" item from `docs/features/followups.md` § Harness seams, and ticks `- [ ] Owned sessions join by an adapter key [plan]` in `docs/features/intent-alignment/master-plan.md` § Lane H.
- wigley-ai-marketplace: one commit holding `relay.py`, `test_relay.py`, the README and the version bump in both manifests, landed per `~/wigley-agents/WigleyRepos.md` § Landing (the same worktree as the wigley-ai-gui commit, fast-forwarded into `main`, pushed).

## Proof
