# 07 — Chat main part

Status: not started
Type: Task
Wave: 3 · Depends on: 02, 03, 05, 08
Plan: [plan.md](plan.md)

Files:     create `src/plugins/chat/manifest.ts` · create `src/plugins/chat/contract.ts` ·
           create `src/plugins/chat/main/start.ts` · create `src/plugins/chat/main/chat-sessions.ts` ·
           create `src/plugins/chat/main/permission-tool.ts` · create `src/plugins/chat/main/recent-folders.ts` ·
           modify `src/plugins/manifests.ts` · modify `src/plugins/main.ts` ·
           test `src/plugins/chat/main/chat-sessions.test.ts` · test `src/plugins/chat/main/permission-tool.test.ts` ·
           test `src/plugins/chat/main/recent-folders.test.ts`

Consumes:
- `AgentHarness`, `AgentStart`, `AgentProcess`, `AgentProcessEvents`, `ChatEntry`, `SessionControl`,
  `ProcessActivity` in `src/contracts/agent.ts` ← 05
- `RandomUuid` in `src/contracts/ambient.ts` ← 05; `MainServices.randomUuid`, `MainServices.agentHarnesses`,
  `MainServices.window.isFocused()`, `MainServices.window.chooseFolder()` in `src/contracts/plugin.ts` ← 05
- `createFakeAgentHarness()` in `src/shared/fake-agent-harness.ts` ← 05 (tests only). This task needs from it: a
  harness whose `id` the test can set to `'claude'` (or is `'claude'`), the `AgentStart` each `start` received, the
  `AgentProcessEvents` each `start` received (so the test raises `entry`, `controls`, `activity`, `ended`), what each
  process was asked (`send` texts, `interrupt` count, `setControl` pairs, `end` calls), a way to make `start` throw,
  and a way to hold `end()`'s promise open until the test settles it. The member names are 05's; where 05 names
  them differently, this task uses 05's names.
- `OwnedSession`, `SessionsMainExports.open(info)`, `.mark(sessionId)`, `.selectedSessionId()`,
  `SessionsMainEvents.closed` in `src/plugins/sessions/contract.ts` ← 03
- `SessionsMainExports.contributeTools`, `.activate`, `ToolDefinition`, `ToolSession`, `ToolResult`,
  `ToolCallContext`, `AgentSession`, `SessionInfo` — in the tree, `src/plugins/sessions/contract.ts`
- `startLayoutRegistry(deps: LayoutRegistryDeps): Promise<LayoutRegistry>` with `logSource` in
  `src/shared/layouts/layout-registry.ts` ← 02; `LayoutChoice` in `src/contracts/layouts.ts` ← 02
- `src/plugins/chat/layouts/layout.d.ts` and `src/plugins/chat/layouts/default/layout.js` ← 08 (as `?raw` text)
- In the tree: `definePlugin` (`src/shared/define-plugin.ts`), `MainApi`, `MainPart`, `MainChannel`,
  `QualifiedEvents` (`src/contracts/plugin.ts`), `Alerts` (`src/contracts/alerts.ts`), `Files`
  (`src/contracts/files.ts`), `Clock` (`src/contracts/ambient.ts`), `Log` (`src/contracts/log.ts`),
  `createMemoryFiles()` (`src/shared/memory-files.ts`), `errorText` (`src/shared/error-text.ts`), the `*?raw`
  module declaration (`src/declarations.d.ts`)

Produces:
- `src/plugins/chat/contract.ts` — the block in plan.md's **Shared names and signatures**, with these return types
  made promises, since `MainChannel.handle` takes a handler of exactly the declared type and these handlers are async
  (forms' `FormsChannel` declares its layout methods the same way):
  ```ts
  recentFolders(): Promise<RecentFolder[]>;
  chooseFolder(): Promise<string | null>;
  layout(): Promise<LayoutChoice>;
  cycleLayout(step: 1 | -1): Promise<LayoutChoice>;
  copyLayout(): Promise<LayoutChoice>;
  ```
  Every other member, `ChatProfile`, `RecentFolder`, `StartRequest`, `ChatSessionState`, `PermissionAnswer`, and
  every message, word for word as plan.md shows. `start` stays synchronous (`start(request: StartRequest): string`).
  `LayoutChoice` is imported from `src/contracts/layouts.ts`; `ChatEntry`, `SessionControl`, `ProcessActivity` from
  `src/contracts/agent.ts`. `homeDir` is left out of the `ChatChannel` here: task 10 adds it with its handler. The
  comment above `ChatSessionState` reads: `` `sessionId` is the sessions plugin's id
  for the row. `` (plan.md's comment names a `label` field the interface does not have.)
- `src/plugins/chat/manifest.ts` — `export const chatManifest = definePlugin({ id: 'chat', dependsOn: ['sessions',
  'keys'], commands: {}, scopes: {}, keys: { page: [], editor: [], app: [], global: [], intercept: [] }, settings:
  { profiles: DEFAULT_PROFILES } })`, `DEFAULT_PROFILES: ChatProfile[]` =
  `[{ name: 'work', configDir: '~/.claude' }, { name: 'personal', configDir: '~/.claude-personal' }]`. Task 09 adds
  the page commands, scopes and keys.
- `src/plugins/chat/main/start.ts` — `export const chatMainPart: MainPart<typeof chatManifest>`; returns
  `{ commands: {}, dispose }`, no exports.
- `src/plugins/chat/main/chat-sessions.ts`:
  ```ts
  export interface ChatSessionsDeps {
    harnesses: readonly AgentHarness[];
    sessions: Pick<SessionsMainExports, 'open' | 'mark' | 'activate' | 'selectedSessionId'>;
    profiles: readonly ChatProfile[];
    homeDir: string;
    randomUuid: RandomUuid;
    recent: RecentFolders;
    send: MainChannel<ChatChannel>['send'];
    alerts: Pick<Alerts, 'announce'>;
    window: { show(): void; isFocused(): boolean };
    log: Log;
  }
  export interface ChatSessions {
    sessions(): ChatSessionState[];
    start(request: StartRequest): string;
    send(sessionId: string, text: string): void;
    interrupt(sessionId: string): void;
    setControl(sessionId: string, controlId: string, value: string): void;
    answerPermission(sessionId: string, entryId: string, answer: PermissionAnswer): void;
    // The sessions plugin's `closed` event for `sessionId`.
    closed(sessionId: string): void;
    // The `start` chat hands `sessions.contributeTools` with PERMISSION_TOOLS.
    permissionToolSession(session: AgentSession): ToolSession;
  }
  export function createChatSessions(deps: ChatSessionsDeps): ChatSessions;
  export const CHAT_HARNESS_ID = 'claude';
  export const TURN_FINISHED_TITLE = 'Turn finished';
  ```
- `src/plugins/chat/main/permission-tool.ts`:
  ```ts
  export const PERMISSION_TOOL_NAME = 'permission_prompt';
  export const PERMISSION_TOOLS: ToolDefinition[];          // one entry, below
  export interface PermissionRequest { toolName: string; input: unknown; toolUseId: string | null }
  // Throws naming the first field wrong.
  export function readPermissionRequest(args: unknown): PermissionRequest;
  export function permissionReplyText(answer: PermissionAnswer, input: unknown): string;
  export const DEFAULT_DENY_MESSAGE = 'The user denied this tool call.';
  export const CANCELLED_REASON = 'The tool call was cancelled before the user answered.';
  export const NOT_OWNED_TEXT = 'permission_prompt answers only for sessions the wigley-ai-gui app started.';
  ```
- `src/plugins/chat/main/recent-folders.ts`:
  ```ts
  export interface RecentFolders {
    // Newest first; [] when the file is missing or unreadable.
    list(): Promise<RecentFolder[]>;
    // Writes run one after another, each reading the file the last one wrote.
    record(projectDir: string, profile: string): Promise<void>;
  }
  export function createRecentFolders(deps: { data: Files; clock: Clock; log: Log }): RecentFolders;
  // `folder` first, any earlier entry for its projectDir dropped, at most MAX_RECENT_FOLDERS kept.
  export function addRecentFolder(folders: readonly RecentFolder[], folder: RecentFolder): RecentFolder[];
  export const RECENT_FOLDERS_FILE = 'recent-folders.json';
  export const MAX_RECENT_FOLDERS = 20;
  ```
- `src/plugins/manifests.ts`: `chatManifest` joins the list after `formsManifest`
  (`[sessionsManifest, formsManifest, chatManifest, keysManifest]`). `src/plugins/main.ts`: `chatMainPart` joins
  after `formsMainPart`, so forms' self-test script keeps running first.

Decisions:
- **Start** (`start(request)`), in this order, so nothing is opened when an input is wrong:
  1. the profile: the `deps.profiles` entry whose `name` is `request.profile`, else throw
     `chat has no profile "<name>"`;
  2. the harness: the `deps.harnesses` entry whose `id` is `CHAT_HARNESS_ID`, else throw
     `no agent harness "claude"`;
  3. `hostId = randomUuid()`; `owned = sessions.open({ sessionId: hostId, projectDir: request.projectDir,
     deadlineSeconds: null, harness: 'claude' })`; the chat state for `owned.session.id` is stored with
     `entries: []`, `controls: []`, `activity: 'idle'`, and `sessionStarted` is sent with it;
  4. `process = harness.start({ sessionId: hostId, resume: false, projectDir: request.projectDir, profileDir },
     events)` with `profileDir` the profile's `configDir` expanded (below). When `start` throws: `owned.end()`, the
     state dropped, `sessionEnded { sessionId, error: errorText(error) }` sent, the error rethrown (the page's invoke
     rejects with it);
  5. `recent.record(request.projectDir, request.profile)` runs without being awaited; a rejection logs
     `recent folders not saved: <errorText>` under source `chat`;
  6. returns `owned.session.id`.
- `configDir` expansion: `expandHome(configDir, homeDir)` from `src/shared/expand-home.ts` (task 05).
- **Events** of a started process, each for its own session only:
  - `entry(entry)`: replaces the state's entry with the same `id` in its place, else appends; sends
    `entry { sessionId, entry }`.
  - `controls(controls)`: replaces the state's controls; sends `controls { sessionId, controls }`.
  - `activity(activity)`: stored as the harness's activity. The **shown activity** is `'waiting'` while the session
    has a pending permission call, else the harness's activity. Each change of the shown activity is stored in the
    state's `activity` and sent as `activity { sessionId, activity }`; an unchanged one sends nothing.
  - `commands(names)`: ignored in plan A (plan B reads it).
  - `ended({ code, error })`: logs `session <id> ended (code <code>)` and, when `error` is non-null,
    `session <id> failed: <error>`; every pending permission call of the session resolves as a deny with
    `CANCELLED_REASON` (no entry sent); sends `sessionEnded { sessionId, error }`; drops the state; `owned.end()`.
  - Any event for a session already dropped (ended or closed) changes nothing and sends nothing.
- Chat main adds no `user` entry on `send`: the harness reports the user's message as a `user` entry, as every
  other entry, so one source builds every entry (plan B's resumed transcripts come from the adapter too).
- **Turn finished**: when the shown activity changes from `'working'` or `'waiting'` to `'idle'` and
  `!window.isFocused() || sessions.selectedSessionId() !== sessionId`: `alerts.announce(TURN_FINISHED_TITLE,
  path.basename(projectDir), onClick)` with `onClick` = `sessions.activate(sessionId)` then `window.show()`, and
  `sessions.mark(sessionId)`. The body is the project folder's name: sessions exports no row label.
- **Closed** (`closed(sessionId)`, from the `sessions.closed` event): for a session chat owns, the state is dropped at
  once (later events are ignored), pending permission calls resolve as denies with `CANCELLED_REASON` (no entry
  sent), then `process.end()` and, once it settles, `owned.end()`. A `closed` for a session chat does not own does
  nothing.
- **Unknown session ids**: `send`, `interrupt`, `setControl` and `answerPermission` for a session id chat holds no
  state for log `<method> for unknown session <id> ignored` under `chat` and do nothing, as `session-list.ts` does;
  `answerPermission` for an entry id that is not a pending permission of that session logs
  `answerPermission for unknown entry <entryId> ignored`.
- `send`, `interrupt`, `setControl` pass straight to the session's `AgentProcess`, whatever the activity.
- **Permission tool**: `PERMISSION_TOOLS` holds one definition, contributed in start with
  `sessions.contributeTools(PERMISSION_TOOLS, (session) => chat.permissionToolSession(session))`:
  - `name: 'permission_prompt'`; `description`:
    `"Answers Claude Code's permission prompts for a session the wigley-ai-gui app started: the app shows the tool call to the user, who allows or denies it. Claude Code calls it through --permission-prompt-tool; never call it yourself."`
  - `inputSchema`: `{ type: 'object', required: ['tool_name', 'input'], properties: { tool_name: { type: 'string',
    description: 'The tool asking for permission.' }, input: { type: 'object', description: "The tool call's input." },
    tool_use_id: { type: 'string', description: "The tool call's id." } } }` — no `additionalProperties: false`, so
    a field Claude adds later does not fail the call.
  - The request shape pinned today is Claude Code's documented one, `{ tool_name, input, tool_use_id? }`; the reply
    is one text content item holding `JSON.stringify({ behavior: 'allow', updatedInput: input })` or
    `JSON.stringify({ behavior: 'deny', message: reason ?? DEFAULT_DENY_MESSAGE })`. Where
    `docs/features/agent-chat/claude-stream.md` (task 01) records a different shape or name, the implementer follows
    claude-stream.md and records the change in the run log's Contract changes.
  - `permissionToolSession(session)` looks the chat state up by `session.id` on every `call` and in `end`, never once
    at creation: sessions builds tool sessions inside `open`, before chat stores the state. A call for a session
    with no chat state at call time resolves `{ content: [{ type: 'text', text: NOT_OWNED_TEXT }], isError: true }`;
    `end` for one does nothing.
  - For an owned session, a call whose args `readPermissionRequest` rejects resolves an error result holding the
    thrown message (`permission_prompt: tool_name must be a string`, `permission_prompt: input is missing`); a call
    for another tool name rejects with `chat has no tool "<name>"`, as forms' tool session does.
  - A valid call whose `signal` is already aborted resolves the deny reply with `CANCELLED_REASON`, adding no entry.
    Otherwise it adds the entry `{ kind: 'permission', id: 'permission-<n>', toolName, input, answer: null,
    raw: [args] }` (`n` counts from 1 per session), sends it, recomputes the shown activity (`'waiting'`), and waits.
  - `answerPermission(sessionId, entryId, answer)` sets the entry's `answer` to `{ allowed, reason }` (reason `null`
    stays `null` in the entry), sends the entry, resolves the call with `permissionReplyText(answer, input)`, and
    recomputes the shown activity.
  - The call's `signal` aborting first sets the entry's answer to `{ allowed: false, reason: CANCELLED_REASON }`,
    sends the entry, resolves the call with that deny, and recomputes the shown activity.
  - The tool session's `end` (the owned session ending) resolves that session's pending calls as on abort.
- **Recent folders**: `recent-folders.json` in chat's data folder (`api.data`) holds `RecentFolder[]` as JSON, newest
  first. `record` reads the list, applies `addRecentFolder` with `{ projectDir, profile, lastUsed: clock.now() }`, and
  writes `JSON.stringify(list, null, 2)`. `list` on a missing file returns `[]`; on text that is not a JSON array it
  logs `recent-folders.json unreadable: <errorText>` under `chat` and returns `[]` (the next `record` overwrites it).
- **Layouts**: `start.ts` starts `startLayoutRegistry({ data: api.data, send: (choice) => api.channel.send(
  'layoutChanged', choice), log, layoutTypes, defaultLayout, logSource: 'chat' })`, `layoutTypes` and
  `defaultLayout` imported as `../layouts/layout.d.ts?raw` and `../layouts/default/layout.js?raw`, as forms' start
  does. `layout`, `cycleLayout`, `copyLayout` are registered at start and await the registry, as forms'
  `serveLayouts` does; a failed start logs `layouts not started: <errorText>` under `chat` and every layout handler
  rejects with that error. `dispose` disposes the registry once it settles.
- **`start.ts` wiring**: `ChatApi = MainApi<typeof chatManifest, ChatChannel, Record<never, never>,
  QualifiedEvents<'sessions', SessionsMainEvents>>`. It builds `createRecentFolders({ data: api.data, clock, log })`
  and `createChatSessions` from `api.services` and `api.settings.profiles`, registers `sessions`, `start`, `send`,
  `interrupt`, `setControl`, `answerPermission` straight onto the chat module, `recentFolders` onto
  `recent.list()`, `chooseFolder` onto `services.window.chooseFolder()`, hears
  `api.events.on('sessions.closed', ({ sessionId }) => chat.closed(sessionId))`, and contributes the tool. It hands no
  self-test script (task 11 adds one).
- `sessions()` returns every held state in start order, each a copy (`entries` and `controls` copied arrays), so a
  page reload redraws every session whole.
- `chat-sessions.ts`, `permission-tool.ts` and `recent-folders.ts` import only `src/contracts`, `src/shared`, chat's
  own folder and `../../sessions/contract`; `node:path` for `basename` and `join` (the `src/plugins/chat/main` layer
  allows `node:` as forms' main does; task 05 writes its `LAYERS` entry).

GIVEN the default profiles, `homeDir` `/Users/u`, `randomUuid` returning `uuid-1`, the fake sessions' `open` returning
row id `row-1`, the clock at `1000` WHEN `start({ projectDir: '/work/app', profile: 'personal' })` runs THEN it returns
`row-1`, `open` got `{ sessionId: 'uuid-1', projectDir: '/work/app', deadlineSeconds: null, harness: 'claude' }`, the
harness got `{ sessionId: 'uuid-1', resume: false, projectDir: '/work/app', profileDir: '/Users/u/.claude-personal' }`,
`sessionStarted` carried `{ sessionId: 'row-1', projectDir: '/work/app', profile: 'personal', entries: [],
controls: [], activity: 'idle' }`, and `recent-folders.json` holds
`[{ projectDir: '/work/app', profile: 'personal', lastUsed: 1000 }]`
GIVEN a profile `home` not in the settings WHEN `start` runs THEN it throws `chat has no profile "home"` and `open` was
not called
GIVEN no harness with id `claude` WHEN `start` runs THEN it throws `no agent harness "claude"` and `open` was not called
GIVEN a harness whose `start` throws `spawn failed` WHEN `start` runs THEN it throws `spawn failed`, the owned session's
`end` ran once, `sessionEnded { sessionId: 'row-1', error: 'spawn failed' }` was sent and `sessions()` is `[]`
GIVEN a started session WHEN the harness sends entries `a` (text `x`), `b`, then `a` (text `xy`) THEN `sessions()[0]
.entries` is `[a(xy), b]` and three `entry` messages were sent, the last carrying `a(xy)`
GIVEN a started session WHEN the harness sends `controls` `[mode: auto]` THEN `controls { sessionId: 'row-1', controls:
[mode: auto] }` is sent and `sessions()[0].controls` equals it
GIVEN a started session, the window focused and `selectedSessionId()` `row-1` WHEN activity goes `working` then `idle`
THEN `activity` messages `working`, `idle` are sent and no alert or mark happened
GIVEN the window unfocused WHEN activity goes `working` then `idle` THEN `announce('Turn finished', 'app', …)` ran once
and `mark('row-1')` once; running the alert's `onClick` calls `activate('row-1')` and `window.show()`
GIVEN the window focused and `selectedSessionId()` `row-other` WHEN activity goes `working` then `idle` THEN the alert
and the mark happen once each
GIVEN activity `idle` WHEN the harness reports `idle` again THEN no `activity` message is sent and no alert happens
GIVEN a started session WHEN the harness sends `ended { code: 1, error: 'crashed' }` THEN `sessionEnded { sessionId:
'row-1', error: 'crashed' }` is sent, the owned `end` ran once, `sessions()` is `[]`, and a later `entry` sends nothing
GIVEN a started session WHEN `closed('row-1')` runs THEN `sessions()` is `[]` at once, the process's `end` ran, the owned
`end` has not run until that promise settles and has run once after it, and an `entry` raised after `closed` sends
nothing
GIVEN `closed('row-x')` for a session chat does not own WHEN it runs THEN no process ends and nothing is sent
GIVEN a started session WHEN `send('row-1', 'hi')`, `interrupt('row-1')`, `setControl('row-1', 'mode', 'plan')` run
THEN the process recorded `hi`, one interrupt and `['mode', 'plan']`
GIVEN no session `row-x` WHEN `send('row-x', 'hi')` runs THEN the log holds `send for unknown session row-x ignored`
under `chat` and no process recorded a send
GIVEN a started session with harness activity `working` WHEN `permission_prompt` is called with `{ tool_name: 'Bash',
input: { command: 'ls' }, tool_use_id: 'tu-1' }` THEN the entry `{ kind: 'permission', id: 'permission-1', toolName:
'Bash', input: { command: 'ls' }, answer: null, raw: [args] }` and `activity 'waiting'` are sent, and the call is
pending
GIVEN that pending call WHEN `answerPermission('row-1', 'permission-1', { allowed: true, reason: null })` runs THEN the
call resolves text `{"behavior":"allow","updatedInput":{"command":"ls"}}`, the entry is sent with `answer: { allowed:
true, reason: null }`, and `activity 'working'` is sent
GIVEN that pending call WHEN answered `{ allowed: false, reason: null }` THEN the call resolves
`{"behavior":"deny","message":"The user denied this tool call."}`; answered `{ allowed: false, reason: 'use rg' }` THEN
`{"behavior":"deny","message":"use rg"}`
GIVEN two pending calls WHEN the first is answered THEN no `activity` message is sent (still `waiting`)
GIVEN that pending call WHEN its signal aborts THEN the call resolves the deny with `The tool call was cancelled before
the user answered.` and the entry is sent with `answer: { allowed: false, reason: <that text> }`
GIVEN a call whose signal is already aborted WHEN it runs THEN it resolves that deny and no entry is sent
GIVEN a tool session for a session chat did not start WHEN `permission_prompt` is called THEN it resolves `isError:
true` with text `permission_prompt answers only for sessions the wigley-ai-gui app started.`
GIVEN a tool session created through `permissionToolSession` before `start` stored the state for its session id WHEN
`start` has run and `permission_prompt` is then called THEN the call reaches the permission flow (an entry is sent, the
call is pending), not the not-owned result
GIVEN args `{ tool_name: 7, input: {} }` WHEN the call runs on an owned session THEN it resolves `isError: true` with
text `permission_prompt: tool_name must be a string` and no entry is sent
GIVEN a pending call WHEN `answerPermission('row-1', 'permission-9', …)` runs THEN the log holds `answerPermission for
unknown entry permission-9 ignored` and the call stays pending
GIVEN `recent-folders.json` holding `/a` (work) and `/b` (personal) WHEN `record('/b', 'work')` runs at `2000` THEN the
file holds `[{ projectDir: '/b', profile: 'work', lastUsed: 2000 }, { projectDir: '/a', … }]`
GIVEN 20 recorded folders WHEN a 21st is recorded THEN the list holds 20 entries, the new one first and the oldest gone
GIVEN no `recent-folders.json` WHEN `list()` runs THEN it returns `[]`; GIVEN the file holds `{oops` THEN it returns
`[]` and the log holds a line starting `recent-folders.json unreadable:`
GIVEN two `record` calls started together WHEN both settle THEN the file holds both folders

Tests:
- `chat-sessions.test.ts` — over `createFakeAgentHarness()` (id `claude`), `createMemoryFiles()` behind
  `createRecentFolders` with a fixed clock, a fake sessions export written in the test (records `open`, `mark`,
  `activate`; `selectedSessionId` returns a value the test sets; `open` returns `{ session: { id: 'row-1', info },
  end }` with `end` counted), a recording `send`, a recording `announce`, and a window whose `isFocused` the test sets:
  - `start_opensTheSessionAndStartsTheHarness` — the first GIVEN's values, every one asserted.
  - `start_unknownProfile_throwsAndOpensNothing`, `start_noClaudeHarness_throwsAndOpensNothing`,
    `start_harnessThrows_endsTheOwnedSessionAndReportsTheError`.
  - `entry_sameIdReplacesInPlace`, `controls_storedAndSent`.
  - `turnFinished_focusedAndSelected_noAlert`, `turnFinished_unfocused_alertsAndMarks` (also runs `onClick`),
    `turnFinished_otherSessionSelected_alertsAndMarks`, `activity_unchanged_sendsNothing`.
  - `ended_reportsAndEndsTheOwnedSession`, `closed_endsTheProcessThenTheOwnedSession`,
    `closed_notOwned_doesNothing`.
  - `processCalls_passThrough`, `unknownSession_loggedAndIgnored` (each of `send`, `interrupt`, `setControl`,
    `answerPermission`, asserting each log line).
  - `permission_callAddsAWaitingEntry`, `permission_allow_repliesWithTheInput`, `permission_deny_defaultAndReason`,
    `permission_twoPending_staysWaiting`, `permission_abort_answersDenied`, `permission_alreadyAborted_noEntry`,
    `permission_unownedSession_errorResult`, `permission_toolSessionBeforeStart_reachesFlowAfterStart`,
    `permission_badArgs_errorResult`, `permission_unknownEntry_ignored`.
- `permission-tool.test.ts` — `readPermissionRequest_readsTheDocumentedShape` (`tool_use_id` absent → `toolUseId:
  null`), `readPermissionRequest_namesTheWrongField` (both error texts above), `permissionReplyText_allowAndDeny`
  (the three reply texts above, compared as exact strings).
- `recent-folders.test.ts` — `record_newestFirstDeduplicated`, `record_keepsAtMostTwenty` (builds its 20 folders in
  the test), `list_missingFile_empty`, `list_unreadableFile_emptyAndLogged`, `record_concurrentWritesKeepBoth`.

Approach:
- 07 imports 08's `layout.d.ts` and `default/layout.js` as `?raw` text. `src/declarations.d.ts` declares `*?raw`, so
  the typecheck and this task's tests pass before 08 lands; the app build needs both.
- The fake sessions export is the test's own: `SessionsMainExports` is a contract, and a hand-written object
  implementing the picked members is the double (`writing-tests`: doubles).

Done when: the typecheck and `npm run lint` pass; the test gate runs the three test files above.
Commit:    one commit for the group

## Proof

