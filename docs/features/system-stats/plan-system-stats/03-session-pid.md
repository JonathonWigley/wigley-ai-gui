# 03 — Session process pid reaches chat

Status: not started
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Read first: `docs/features/session-host/design.md` § Protocol (the pid paragraph) and
`docs/features/system-stats/design.md` § Session processes.

Files:
- modify `src/contracts/session-host-protocol.ts` — protocol 3, `SpawnedEvent`, `SubscribeReply.pid`
- modify `src/contracts/session-host.ts` — `HostedProcessEvents.spawned`, `HostedProcess.pid`
- modify `src/session-host/process-table.ts` — `ProcessSubscriber.spawned`, the pid in `subscribe`
- modify `src/session-host/host-server.ts` — push `spawned` to the spawner, `pid` in the `subscribe` reply
- modify `src/session-host/session-host-test-doubles.ts` — `fakeChild` pid, `recordingSubscriber` records `spawned`
- modify `src/session-host/host-children.test.ts` — its `[1, REPORT]` keys and `pid: 1` record follow `fakeChild`'s
  new pid (4321)
- modify `src/main/session-host/host-link.ts` — route `spawned` to `pushed`
- modify `src/main/session-host/session-host-client.ts` — hold the pid per process entry
- modify `src/shared/fake-session-host.ts` — `spawned(id, pid)`, `addRunning` pid, `HostedProcess.pid`
- modify `src/contracts/agent.ts` — `AgentProcessEvents.pid`
- modify `src/main/claude-code/claude-code-harness.ts` — pass the pid up on start and on attach
- modify `src/shared/fake-agent-harness.ts` — `FAKE_AGENT_PID`, emitted on start
- modify `src/plugins/chat/contract.ts` — `ChatSessionInfo.pid`
- modify `src/plugins/chat/main/chat-sessions.ts` — write `pid` in `chat.session`
- modify `src/plugins/chat/main/preview/chat-preview.ts` — `pid: null` in its session literal
- test `src/session-host/process-table.test.ts`, `src/session-host/host-server.test.ts`,
  `src/main/session-host/session-host-client.test.ts`, `src/shared/fake-session-host.test.ts`,
  `src/main/claude-code/claude-code-harness.test.ts`, `src/shared/fake-agent-harness.test.ts`,
  `src/plugins/chat/main/chat-sessions.test.ts`
- modify (a `ChatSessionInfo` literal gains `pid`; each file is in the tree now):
  `src/plugins/chat/main/chat-slots.test.ts`, `src/plugins/chat/page/start.test.ts`,
  `src/plugins/chat/page/chat-view.test.ts`, `src/plugins/chat/page/session-part.test.ts`,
  `src/plugins/chat/page/chat-commands.test.ts`, `src/plugins/chat/layouts/default/layout.test.ts`,
  `src/plugins/auto-retro/main/retro-done.test.ts`, `src/plugins/auto-retro/main/start.test.ts`.
  `npm run typecheck` names any literal this list misses; fix it the same way.

Consumes: nothing from another task. Tree members used: `SubscribeReply`, `HostMessage`, `ProcessSubscriber`,
`HostedProcessEvents`, `HostedProcess`, `AgentProcessEvents`, `ChatSessionInfo`, `SessionSlots.setInfo`.

Produces:
- `src/contracts/session-host-protocol.ts`:
  - `export const SESSION_HOST_PROTOCOL = 3;`
  - `SubscribeReply` gains `pid: number | null;` — the process's OS pid while `running` is true and the host knows
    it; null otherwise
  - `export interface SpawnedEvent { type: 'spawned'; id: string; pid: number; }` in the Versioned part, after
    `ClosedEvent`
  - `HostMessage` gains `| SpawnedEvent`
- `src/contracts/session-host.ts`:
  - `HostedProcessEvents` gains `spawned(pid: number): void;` — once, to the events `spawn` was given, when the OS
    reports the process's pid; never to the events an `attach` was given
  - `HostedProcess` gains `readonly pid: number | null;` — the OS pid once the host reports it; null before and after
    the process runs (the plan.md File Structure line, word for word)
- `src/session-host/process-table.ts`:
  - `ProcessSubscriber` gains `spawned(id: string, pid: number): void;`
  - `ProcessTable.subscribe(id, subscriber): { running: boolean; log: string | null; pid: number | null }`
- `src/main/session-host/host-link.ts`: `HostLinkDeps.pushed(message: LineEvent | ClosedEvent | SpawnedEvent): void`
- `src/shared/fake-session-host.ts`:
  - `FakeHostedProcessRecord` gains `pid: number | null;`
  - `FakeSessionHost` gains `spawned(id: string, pid: number): void;`
  - `FakeSessionHost.addRunning` argument gains `pid?: number;` (left out: null)
- `src/contracts/agent.ts`: `AgentProcessEvents` gains `pid(pid: number): void;`
- `src/shared/fake-agent-harness.ts`: `export const FAKE_AGENT_PID = 4242;`
- `src/plugins/chat/contract.ts`: `ChatSessionInfo` gains `pid: number | null;` — the session's agent process pid
  while `running`; null otherwise (the plan.md File Structure line, word for word)

Decisions:
- **Protocol bump.** `SESSION_HOST_PROTOCOL` goes from 2 to 3. Nothing else changes for the bump: the new app finds
  `host-v2.json`, lists that host's processes as `current: false` and drains it (`other-hosts.ts` `drainOlder`). A row
  whose process lives in the protocol 2 host is unheld and publishes `pid: null`; the panel shows that process as an
  ordinary row. Frozen shapes (`HelloMessage`, `HelloReply`, `ListMessage`, `ListedProcess`, `ListReply`,
  `DrainMessage`, `PipeLogRecord`, `SessionHostRecord`, `RecordedHostChild`, `HostChildrenRecord`, the file-name
  functions) do not change. `ListedProcess` gets no pid.
- **When the host reports the pid.** In `ProcessTable.spawn`, right after `deps.spawn` returns, the process is set in
  the table, and `wireChild` has run: when `child.pid !== undefined`, call `subscriber.spawned(request.id, child.pid)`
  in the same call. Node sets `child.pid` synchronously when the OS started the child and leaves it undefined when the
  spawn failed (its `error` event follows), so no `spawn` event listener is needed. A child with no pid gets no
  `spawned`. `TableProcess` gains `pid: number | null` (`child.pid ?? null`).
- **`subscribe`'s pid.** `pid` is `hosted.pid` whenever `running` is true (the log-incomplete case included), and null
  whenever `running` is false. The host server spreads it into the `subscribe` reply as it spreads `running` and `log`
  now.
- **Only the spawner hears `spawned`.** The host server's per-connection `ProcessSubscriber` gets
  `spawned: (id, pid) => push({ type: 'spawned', id, pid })`. A later subscriber learns the pid from its `subscribe`
  reply only.
- **Client pid per entry.** `ProcessEntry` in `session-host-client.ts` gains `pid: number | null` (null at creation).
  A pushed `spawned` sets `entry.pid` and calls the live subscriber's `events.spawned(pid)`, through the same
  `pushed` → buffer → `deliver` path as a `line` (the `buffer` union gains `SpawnedEvent`). `attachOver` sets
  `entry.pid = reply.pid` when the reply is `running` with a log. `deliver` always sets `entry.pid` on `spawned`,
  and calls the subscriber's `spawned` only when `spawn` made that subscriber (a `fromSpawn` flag): a same-id
  `attach` replaces the subscriber, and its events never hear `spawned`. `endEntry` and `hostDied` set `entry.pid = null`.
  `hostedProcess(entry, subscriber)` returns an object with `get pid() { return entry.ended ? null : entry.pid; }`.
  The refused-duplicate object `spawn` returns has `pid` null (its entry is ended).
- **Fake session host.** `spawn` and `addRunning` records start with `pid` null (or `addRunning`'s `pid`).
  `spawned(id, pid)` sets the last open record's `pid` and calls its `events?.spawned(pid)` at once, as `output` does;
  it throws for an unknown or closed id, as `output` does. Its `HostedProcess.pid` reads `record.closed === null ?
  record.pid : null`. `spawn` calls `spawned` on nothing by itself, so harness tests that do not call it see no pid.
  The record keeps the events `spawn` was given (`spawnEvents`); `spawned` calls them only while `record.events ===
  spawnEvents`, so after an `attach` replaced them it only sets the pid. Update the file's header comment, which
  lists what calls a record's events at once, to name `spawned`.
- **Agent contract member.** `AgentProcessEvents.pid(pid: number)` beside `activity`, with this comment: the OS pid of
  the session's agent process, once the harness knows it — after `start` once the process runs, and during an
  `attach` before its promise resolves; at most once per process object; a harness with no OS process of its own never
  calls it; the process's pid ends with `ended`. A non-null event was picked over `pid(number | null)`: `ended`
  already marks the end, so null would be a second signal for one fact.
- **Claude adapter, start.** `withSpawnHint` passes `spawned` through. `createPipeForwarder` forwards `spawned` when live and drops it
  before `goLive`, with a one-line comment that it cannot arrive earlier: `goLive` runs synchronously after
  `host.spawn`, and the host's `spawned` comes on a later socket read. `createClaudeSession`'s `pipeEvents` gains `spawned(pid)`: when not detached and not closed,
  `emit(() => events.pid(pid))` — through the microtask queue, as every other emission.
- **Claude adapter, attach.** In `attachClaudeProcess`, after the loop that calls `reportEffect` for the replay
  effects and before `forwarder.goLive`, call `events.pid(attached.process.pid)` directly when it is not null. A
  process whose `closed` was already delivered reads null and fires no `pid`; either way the `ended` that follows
  clears chat's pid.
- **Fake agent harness.** `startProcess` emits `events.pid(FAKE_AGENT_PID)` in the opening microtask of a started
  (not attached) process, right after `sessionStarted` and before `controls`. An attached fake process emits no pid of
  its own: a test's `replay` calls `events.pid(...)` when it needs one, as it stands for every other start emission.
  Update the file's header comment to name the pid.
- **Chat writes.** `processEvents` gains `pid(pid)`: when `isLive(session, processStart)`,
  `session.slots.setInfo({ pid })`. Every `setInfo` that writes `running` also writes `pid`:
  - the opening `slots.open` literal: `running: false, pid: null`
  - process start (`setInfo({ running: true })` after `harness.start`): `{ running: true, pid: null }`
  - attach start (`setInfo({ running: true })` before `harness.attach`): `{ running: true, pid: null }`
  - `ended`: `{ running: false, pid: null }`
  - `restAfterFailedAttach`: `{ running: false, pid: null }`
  - `endForClear`: `{ running: false, pid: null }`

  The pid is not saved with the session record: a relaunch reads it again from the host through the attach.

GIVEN a host table WHEN a process spawns and its child has pid 4321 THEN the spawner's subscriber gets `spawned('a', 4321)` in the `spawn` call
GIVEN a child that never ran (no pid) WHEN it spawns THEN no `spawned` is reported
GIVEN a running process WHEN another connection subscribes THEN the reply carries `pid: 4321`; for an unknown or ending process `pid: null`
GIVEN two connections WHEN the first spawns `a` THEN only the first receives `{ type: 'spawned', id: 'a', pid: 4321 }`
GIVEN the client WHEN the host pushes `spawned` for `a` THEN the spawn's events get `spawned(4321)` and `process.pid` is 4321, and after `closed` `process.pid` is null
GIVEN the client WHEN an attach's `subscribe` reply carries `pid: 4321` THEN the attached `process.pid` is 4321
GIVEN the Claude adapter on the fake host WHEN the host reports `spawned('p-1', 4321)` after `start` THEN the events hear `pid(4321)`
GIVEN the Claude adapter WHEN it attaches to a hosted process with pid 4321 THEN the events hear `pid(4321)` before the attach resolves
GIVEN chat WHEN a session's process starts on the fake harness THEN `chat.session[id].pid` is `FAKE_AGENT_PID`; WHEN the process ends THEN it is null
GIVEN chat restoring a row whose hosted process runs WHEN the attach replay reports `pid(4321)` THEN `chat.session[id].pid` is 4321

Tests:
- `src/session-host/session-host-test-doubles.ts`: `fakeChild`'s pid for a child that ran goes from `1` to `4321`, so
  no row rests on pid 1. `recordingSubscriber` gains `spawned: { id: string; pid: number }[]` and records each call.
- `process-table.test.ts`:
  - new `spawn_ChildPid_ReportedToTheSubscriberOnlyWhenItRan`, `it.each`:
    `{ ran: true, spawned: [{ id: 'a', pid: 4321 }] }`, `{ ran: false, spawned: [] }` — assert `spawned` right after
    `table.spawn`, with no await.
  - rows added to existing assertions: `keepWindow_Ending_ListsNotRunningAndRefusesAnAttach` expects
    `{ running: false, log: null, pid: null }`; `appendFailure_OneProcess_DeliversItsLinesAndRefusesItsAttach` expects
    `{ running: true, log: null, pid: 4321 }` and `{ running: true, log: logFile('healthy.jsonl'), pid: 4321 }`.
- `host-server.test.ts`: the two rows of `subscribe_Cases_RepliesThenPushesLines` gain the `pid` key (`known`:
  4321, `unknown`: null). New `spawned_GoesToTheSpawnerOnly_AndTheSubscribeReplyCarriesThePid` — connection `first`
  spawns `a`; connection `second` exists; `first` receives `{ type: 'spawned', id: 'a', pid: 4321 }`; after
  `settled(second)`, `second` received no `spawned`; `second`'s `subscribe` reply for `a` equals
  `{ type: 'subscribe', requestId, id: 'a', running: true, log: <a.jsonl path>, pid: 4321 }`; its reply for `nope`
  has `running: false, log: null, pid: null`.
- `session-host-client.test.ts`: `recordedEvents` gains `pids: number[]` from `spawned`; `replySubscribed` gains a
  `pid` argument (default `running ? 4321 : null`) and sends it. New `pid_SpawnedOrSubscribed_HeldUntilClosed`,
  `it.each` with rows `{ via: 'spawn' }` (host pushes `{ type: 'spawned', id: 'a', pid: 4321 }`; `pids` equals
  `[4321]`) and `{ via: 'attach' }` (subscribe reply `pid: 4321`; `pids` equals `[]`); each row then asserts
  `process.pid === 4321`, pushes `closed` for `a`, and asserts `process.pid === null`.
- `fake-session-host.test.ts`: new `spawned_ReachesTheEventsAndThePidUntilClose` — after `spawn('a')`,
  `spawned('a', 4321)` makes the events hear `4321` and `process.pid` 4321; an `attach('a')` process reads 4321;
  after `close('a', …)` both read null. Add `spawned` to any events literal the file builds.
- `claude-code-harness.test.ts`: `recordingEvents` gains `pid: (pid) => hear('pid', pid)`. New
  `pid_FromTheHost_ReachesTheEvents` in `createClaudeCodeHarness on the session host`, `it.each`:
  `{ via: 'start' }` — `start`, `host.spawned('p-1', 4321)`, `settle()`; `heard` holds `['pid', 4321]` once.
  `{ via: 'attach' }` — `host.addRunning({ ...running(logOf(ENDED_TURN_LOG)), pid: 4321 })`, `attach`; once the
  promise resolves and before any `settle`, `heard` holds `['pid', 4321]` once. `attach_RecordedLiveSession_EqualsTheLiveRun`
  stays as it is: neither run reports a pid.
- `fake-agent-harness.test.ts`: `start_RecordsRequestAndEvents_ThenControlsCommandsIdle` is renamed
  `start_RecordsRequestAndEvents_ThenPidControlsCommandsIdle`; its recorder gains `pid`; it expects names
  `['pid', 'controls', 'commands', 'activity']` and `heard[0]` equal to `['pid', FAKE_AGENT_PID]`, the other indexes
  moved by one.
- `chat-sessions.test.ts`: new `pid_ProcessLifecycle_PublishedOnlyWhileRunning`, `it.each`:
  - `{ given: 'a started process', expected: FAKE_AGENT_PID }` — start a session, flush
  - `{ given: 'the process ended', expected: null }` — start, flush, send `FAKE_END_TEXT`, flush
  - `{ given: 'a re-attached process', expected: 4321 }` — `scriptAttach('p1', { outcome: 'process', replay(events) { events.pid(4321); } })`, `restoreOne(test, hostedRecord(), [hostedP1()])`, flush
  - `{ given: 'a restored row whose process is gone', expected: null }` — `restoreOne(test, hostedRecord(), [])`

  Each row asserts `test.chat.sessions()[0].pid`. Existing tests that compare a whole `ChatSessionInfo` or
  `ChatSessionState` gain the `pid` value the session holds at that point.

Approach: the `ChatSessionInfo` literals in the page, layout and auto-retro tests take `pid: null` unless the test sets
`running: true` with a started process, where it takes the value the test's flow produces.

Done when: `npm run typecheck` passes; `npm run lint` passes; Vitest passes for `src/contracts/session-host-protocol.test.ts`,
`src/session-host/process-table.test.ts`, `src/session-host/host-server.test.ts`,
`src/session-host/host-children.test.ts`, `src/main/session-host/session-host-client.test.ts`,
`src/shared/fake-session-host.test.ts`, `src/main/claude-code/claude-code-harness.test.ts`,
`src/shared/fake-agent-harness.test.ts`, `src/plugins/chat/main/chat-sessions.test.ts`,
`src/plugins/chat/main/chat-slots.test.ts`, and every test file in the literal list above; `npm run selftest -- --plugin chat`
passes. A live check that a real `claude` session's pid reaches `chat.session` belongs to "08 — Final verification".

Commit: one commit for the group: "Session host reports each hosted process's pid (protocol 3); chat publishes it on chat.session".

## Proof

