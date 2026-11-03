# 08 — Claude adapter on the host

Status: in progress
Type: Task
Wave: 3 · Depends on: 05, 07
Plan: [plan.md](plan.md)

Files:     modify `src/main/claude-code/claude-code-harness.ts` · test `src/main/claude-code/claude-code-harness.test.ts` ·
           modify `src/main/claude-code/past-sessions.ts` · test `src/main/claude-code/past-sessions.test.ts` ·
           modify `src/main/claude-code/transcripts.ts` · test `src/main/claude-code/transcripts.test.ts` ·
           modify `src/shared/fake-agent-harness.ts` · test `src/shared/fake-agent-harness.test.ts` ·
           test `src/plugins/chat/main/chat-sessions.test.ts` (the `FakePastSessionCall` change only) ·
           modify `src/main/main.ts` ·
           modify `src/main/drive/drive-commands.ts` · test `src/main/drive/drive-commands.test.ts` ·
           modify `src/main/drive/drive-run.ts` · modify `scripts/drive.mts` · modify `.agents/skills/drive/SKILL.md`
Consumes:  `SessionHost`, `HostedSpawn`, `HostedProcess`, `HostedProcessEvents`, `HostedExit`, `PipeLine`,
           `IdleRule` in `src/contracts/session-host.ts` ← 01;
           `AgentStart.processId`, `AgentHarness.attach`, `AgentProcess.detach`, `AgentHarness.history`'s `before`
           in `src/contracts/agent.ts` ← 01; `MainServices.sessionHost` in `src/contracts/plugin.ts` ← 01;
           `createFakeSessionHost(clock: Clock): FakeSessionHost` and its `addRunning`, `output`, `close`,
           `failNextSpawn`, `processes` in `src/shared/fake-session-host.ts` ← 01;
           `createSessionHostClient(deps: SessionHostClientDeps): SessionHostClient`, `SessionHostClientDeps`
           in `src/main/session-host/session-host-client.ts` ← 07;
           `sessionHostChannel(platform, home, username, instanceId): string` in
           `src/main/session-host/session-host-channel.ts` ← 07;
           `SessionFoldState`, `createSessionFoldState`, `foldPipeLine`, `replayPipeLog`, `foldUsageInput`,
           `INTERRUPT_GRACE_MS`, and the harness's `spawnDirect` and `stopTimers` ← 05.
           Tree members: `loadAgentDefinitions` (`agent-definitions.ts`), `transcriptEntries` (`transcripts.ts`),
           `readHistory` (`past-sessions.ts`), `appEndpointDir` (`src/shared/app-endpoint-dir.ts`),
           `onQuit`, `onSelfTestExit`, `disposeParts`, `dataFolder`, `claudeHarness`, `driveHarness`,
           `ModeServicesContext` (`main.ts`); `optionalBoolean` (`src/shared/drive-args.ts`).
           05's `SessionFoldState.isContextRequestOwed` and its write helper.
Produces:  in `src/main/claude-code/claude-code-harness.ts`:
           `ClaudeCodeHarnessDeps` gains `host: SessionHost;` (`spawn: ClaudeSpawn` stays, for the one-shot CLI runs)
           `export const CLAUDE_IDLE_RULE: IdleRule = { key: 'type', value: 'result' };`
           `attach` and each process's `detach` (no stubs)
           in `src/main/claude-code/past-sessions.ts`:
           `export async function readHistory(files: Files, paths: Paths, projectsFolder: string, sessionId: string, before: number | null): Promise<ChatEntry[]>`
           in `src/main/claude-code/transcripts.ts`:
           `export function transcriptEntries(text: string, before: number | null = null): ChatEntry[]`
           in `src/shared/fake-agent-harness.ts`:
           `export type FakeAttachScript = { outcome: 'process'; turns?: number; replay(events: AgentProcessEvents): void } | { outcome: 'null' } | { outcome: 'reject'; message: string };`
           `FakeAgentHarness` gains `scriptAttach(processId: string, script: FakeAttachScript): void;` and
           `readonly attachCalls: readonly AgentStart[];`
           `FakeAgentProcessRecord` gains `attached: boolean; detached: boolean;`
           `FakeAgentCall` gains `| { method: 'detach' }`
           `FakePastSessionCall` gains `before: number | null;`
           in `src/main/main.ts`: `ModeServicesContext` gains `sessionHost: SessionHost;`
           in `src/main/drive/drive-commands.ts`: `DriveCommandsDeps.quit` becomes `quit(keepSessions: boolean): void;`
           and the `quit` command's args become `'{ keepSessions?: boolean }'`
           in `src/main/drive/drive-run.ts`: `DriveRunDeps.quit` becomes `quit(keepSessions: boolean): void;`

Read first: `AGENTS.md` (repo root) § Architecture, `docs/features/session-host/design.md` § Re-attach,
`docs/features/agent-chat/design.md` § Agent harness seam, and task 05's document (the fold this task drives). Load
`wigley:writing-code` before the first edit. When 07's landed `createSessionHostClient` or its deps differ from the
names above, use the landed ones and report the difference as a concern.

## Decisions

### Session processes run on the host

- `startClaudeProcess` replaces `spawnDirect(deps, spawnRequest, pipeEvents)` with
  `deps.host.spawn(spawnRequest, pipeEvents)`. `spawnRequest.id` becomes `request.processId` (05 used the session
  id) and `idleRule` becomes `CLAUDE_IDLE_RULE`. Nothing else in the process changes.
- `spawnDirect` leaves the production file. It moves into `claude-code-harness.test.ts` as the base of a test helper
  `childHost(fake): SessionHost`: `spawn` wraps the fake child as 05's `spawnDirect` did; `attach` resolves null;
  `list` resolves `[]`; `setKeepIdleMinutes` does nothing; `stopAll` resolves. The `started()` helper passes
  `host: childHost(fake)` and keeps `spawn` for the CLI tests. So every existing session test keeps its body.
- `spawnCli`, `runCli`, `startLogIn`, `readAuthStatus`, `readProfilePlanUsage` and `logOut` stay on `deps.spawn`: a
  one-shot run must not outlive the app.
- **A failed spawn.** `closed` with `exit.error` set ends the process with `{ code: null, error }`, `error` from 05's
  `spawnError(exit.error, command, cwd)`: the `claude.command` hint when the text holds `ENOENT`, else the text as it
  is (for example 07's `the session host did not start: <reason>` or `the session host exited`).

### attach

`attach(request, events)`:

1. Make the pipe events. Until step 6 they queue each `line` and a `closed`.
2. `await deps.host.attach(request.processId, pipeEvents)`. Null → resolve null.
3. Await `loadAgentDefinitions` for the request, as `start` runs it. Make `state = createSessionFoldState(request)`
   and set `state.definitions` to the result. Reason: a subagent line in the log decodes with its definition.
4. The log to replay is `log`, then each queued line whose `seq` is greater than the last `seq` in `log`, in order.
   The queue can hold lines with either host: 07 delivers its buffered lines in a `deps.timers.set(…, 0)` macrotask,
   which can run while step 3 awaits file reads, and the fake host delivers at once. A queued line can repeat a line
   in `log`; the `seq` filter drops it.
5. `effects = replayPipeLog(state, logToReplay, deps.clock.now())`.
6. Build the process object on `state` and the hosted process, by the same code `start` uses (move the shared body
   into one function that takes the state and the pipe). Emit `effects` in order, each by a direct call on `events`
   (no `queueMicrotask`), so each fires before the promise resolves (plan.md § File Structure: such events are
   replayed). Then switch the pipe events to live.
7. When `state.graceDeadline` is not null, arm the grace timer for `graceDeadline - deps.clock.now()` (05's rule).
8. When a `closed` was queued, handle it now by the live `closed` path: its `activity`, `sessionEnded` and `ended`
   emit after the replay, through `queueMicrotask` as live. Skip step 9's context request then.
9. When `state.isContextRequestOwed` (the log's last turn end has no `get_context_usage` request after it: the turn
   ended while no app was attached), write one context request through 05's write helper, as the live
   `requestContextUsage` effect does. Its line folds and the host logs it; its reply comes as a live line.
10. Start the `settings.json` read and, when `request.resume`, the saved replies read, as `start` does. Each applies
    through `foldUsageInput`. Their usage events come after the promise resolves, as live events, and only when the
    usage differs from the replay's last usage event (05's repeat rule). The saved replies read changes nothing when
    the replay folded a main reply (`withSavedReplies` keeps a known state).
11. Resolve the process.

- **When attach rejects after step 2** (the host attach succeeded, then the definitions load rejects or any later
  step throws), it calls the hosted process's `detach()` before it rethrows, so the host subscription does not leak
  and the host sends no more lines into a dead queue. It fires no event.
- **attach writes at most one line**: step 9's context request. Reason: live, the harness asks after every turn
  end, and the reply sets the window and the reported limit the row shows; a turn that ended while no app was
  attached left that request unwritten. Every other line the live run wrote is in the log, and the next live line
  or call writes what it needs. `requestCount` and `sendCount` continue from the replay, so a new request id or
  user entry id never repeats one in the log.
- **The usage seed.** `createSessionFoldState(request)` seeds `usage` from `request.resume` (05). The caller passes
  the `resume` value the process was launched with, as it passes the launch controls. With another value the
  replayed usage events before the first main reply differ from the live ones; the final usage state still matches
  after step 10's reads.
- **Controls seed from `request.controls`**, as `start` does (05). The caller passes the controls the process was
  launched with. A control the launch set and no line reported (effort) reads null after the replay when the caller
  passes `{}`.
- **A second attach** to the same process id after a detach (a chat plugin reload) runs the same steps on a new
  state. The host gives the new events the whole log again.
- **attach rejects** when the host attach or the definitions load rejects. It never fires `ended` for that.

### detach

`detach()` on a started or attached process: when it already ran or the process closed, it does nothing. Else it
calls `hostedProcess.detach()` and 05's `stopTimers()`, sets `isDetached`, and resolves every waiter in
`closeWaiters` (an `end()` already pending settles; a caller that awaits it does not hang). After that:

- every pipe event and every effect is dropped (no `ended` fires). The guard sits in the harness's `emit`, and it
  reads `isDetached` when the microtask runs, so an emission queued before `detach()` is dropped too;
- `send`, `interrupt` and `setControl` throw `Claude Code process has detached`; `end()` resolves at once;
  `kill()` does nothing;
- the hosted process keeps running. After an earlier `end()`, its stdin is already closed, so it runs to the end of
  its turn and exits; the end grace timers are cleared, so no SIGTERM follows. Chat's quit path calls `detach`, not
  `end` (task 09).

### History `before`

- `transcriptEntries(text, before)`: when `before` is not null, a line whose time is `>= before` gives no entry and
  pairs no tool result. A line's time is its top-level `timestamp` (ISO 8601) as `lineAt` reads it, or, with none,
  the time of the last line before it that had one (today's `lastAt` rule). `lastAt` follows every line, cut ones
  included, so a line with no timestamp after a cut line is cut too. A line that does not parse (today's `lineRaw`
  entry) takes `lastAt` as its time, and is cut when `lastAt >= before`. Each line is tested on its own (no stop at
  the first cut), since sidechain lines may interleave.
- So a tool call recorded before the cut whose result came after it shows as a tool entry with no result; the
  replay's live tool entry for the same call carries its result.
- `readHistory` gains `before` and passes it on. The harness's `history(sessionId, projectDir, profileDir, before)`
  passes it to `readHistory`. Chat passes the hosted process's `startedAt` (task 09).
- When the auto-compact plan's transcript rule has landed (a `compaction` entry's `afterTokens` from the next main
  reply), the after-size reads uncut lines only.

### Fake harness

- `history(sessionId, projectDir, profileDir, before)` returns the entries whose `at < before` (all for null) and
  records `before` in its `pastSessionCalls` entry (`null` for `listSessions`).
- `scriptAttach(processId, script)` sets the outcome of the next `attach` for that id, once; a later script for the
  same id replaces an unused one. `attach(request, events)` pushes `request` to `attachCalls`, then in a later
  microtask:
  - no script → resolves null;
  - `{ outcome: 'null' }` → resolves null;
  - `{ outcome: 'reject', message }` → rejects `new Error(message)`;
  - `{ outcome: 'process', turns, replay }` → pushes a record with `attached: true`, calls `replay(events)` (the
    test's events fire before the promise resolves), then resolves a process built as `start` builds one, but with
    none of `start`'s opening emissions (`sessionStarted`, controls, commands, `idle`). The process's turn counter
    starts at `turns` (0 when left out), so its next `send` returns `user-<turns + 1>` and its turn's ids
    (`assistant-<n>`, `result-<n>`, `tool-<n>`, `notice-<n>`) follow the ids the test's replay used. Reason: the
    real harness continues its counters from the replay; ids that restart at 1 would repeat replayed entry ids in
    chat.
- `detach()` on a fake process pushes `{ method: 'detach' }`, sets `record.detached = true` and clears the visual
  hold. The process's emissions go through a guard that drops every event once `record.detached` is true
  (`record.events` stays the very object the caller gave). After a detach, `send`, `interrupt` and `setControl` throw
  `fake agent process has detached`; `end()` resolves at once; `kill()` does nothing.
- Update the fake's header comment and the `FakeAgentHarness` comment for these members.

### main.ts

- In `startApp`'s `whenReady` handler, after `readStartInputs`, build one client:
  `createSessionHostClient({ folder, channel: sessionHostChannel(process.platform, inputs.homeDir,
  os.userInfo().username, appInstance.id), hostScript: path.join(__dirname, 'session-host.js'), execPath:
  process.execPath, env: process.env, spawn, clock, timers, log: pageLog.log })` (07 § How task 08 builds it;
  `inputs.homeDir` is the endpoint home `endpointEnv` uses). `spawn` is `node:child_process`'s `spawn`: its
  `ChildProcess` has the `unref()` and `on('error', listener)` that 07's `SessionHostSpawn` asks for. Every run mode
  builds the client.
- **The host folder per run mode**, in a helper beside `dataFolder` (same shape):
  - live app and drive run: `path.join(app.getPath('userData'), 'session-host')`. The live app's user data is its
    instance's own; a drive run's is `<run>/user-data`, which `restart` keeps and the run's final `quit` deletes.
  - self-test: `path.join(inputs.homeDir, 'session-host')`. Reason: every self-test shares one user data folder
    (`<appData>/wigley-ai-gui-selftest`), so a folder there would keep old pipe logs and a stale `host-v1.json`, and
    two self-tests at once would share it. The temp home is deleted by the self-test's teardown, so its host folder
    goes with it. Its channel already differs per run, since it is named from the temp home.
- Pass the client to `createWindow`, which puts it in `ModeServicesContext.sessionHost`. `claudeHarness` gains a
  `host` parameter and passes it as the harness's `host` dep; `liveServices` and `driveHarness` pass
  `context.sessionHost`. `startMainParts`' services get `sessionHost` in place of `unwiredSessionHost`.
- **Teardown.** The live app stops nothing: a quit leaves every process running. No mode calls `close()`; the app's
  exit ends the connection.
  - Drive run: only the end of the run stops the hosted processes. A drive `restart` keeps them, so a drive run can
    check a re-attach (task 12). The drive `quit` command takes `{ keepSessions?: boolean }` (default false) and calls
    `deps.quit(keepSessions)`; `drive-run.ts` passes it through. `scripts/drive.mts` `restart` sends `quit` with
    `{ keepSessions: true }`; the `quit` invocation sends `{}`. In `createWindow`, the drive run's `quit` dep records
    the flag in a local (`stopsSessionsOnQuit = !keepSessions`, true at start, so a quit no drive command asked for,
    such as the SIGTERM after a quit timeout, also stops them), then calls `app.quit()`.
  - Order: the stop runs after the parts' dispose has settled, so chat has detached every process before the host
    closes them, and chat sees no `closed` or `ended` to save. `createWindow`'s existing quit task
    `onQuit(() => disposeParts(startedParts))` becomes one task that awaits `disposeParts(startedParts)`, then, when
    `stopsSessionsOnQuit`, awaits `sessionHost.stopAll()`. `stopsSessionsOnQuit` is false outside a drive run. Reason: `onQuit` tasks all start at once (`startQuitWork`), so a separate task
    registered later would start before chat's dispose has finished. The drive run holds its quit until every quit
    task settles, so the stop finishes before the app exits.
  - Self-test: `onSelfTestExit('the session host', () => sessionHost.stopAll())`. The self-test runs the fake
    harness, so its host holds no process; the call only ends a host a step started. The teardown cap (5000 ms)
    bounds it.
  - A drive run that crashes, or exits through `failStart`, skips the quit tasks: its hosted processes run until the
    host's idle window ends them. This is accepted.
- **The drive skill.** In `.agents/skills/drive/SKILL.md`, step 5 says `quit` also ends the run's Claude sessions
  before it deletes `user-data/`, and the `restart` paragraph says `restart` keeps them running and re-attaches
  them. Edit it to `wigley:writing-for-agents`.
- Delete `unwiredSessionHost` and the task 01 stubs: `grep -rn "not implemented until task 08\|unwiredSessionHost"
  src` finds nothing in production files. Test doubles that build a whole `AgentProcess` keep their own `detach`.

## GIVEN / WHEN / THEN

- GIVEN a start request with `processId` `p-1` WHEN the harness starts it THEN the host gets a spawn with id `p-1`,
  the launch's command, args, folder and env, and the idle rule `{ key: 'type', value: 'result' }`.
- GIVEN a live session on the host WHEN a second harness attaches to its process THEN the events it fires before
  `attach` resolves equal the live run's final entries, agent events, controls and activity.
- GIVEN an attached process WHEN the user sends a message THEN its entry id and the next request id follow the
  replayed ones.
- GIVEN no running current process with that id WHEN `attach` runs THEN it resolves null and fires nothing.
- GIVEN a logged interrupt whose grace ended while no app was attached WHEN `attach` runs THEN the replay holds the
  grace notice at the deadline and ends `idle`.
- GIVEN a detached process WHEN the host outputs a line or closes THEN no event fires and the host kept the process.
- GIVEN a transcript with lines before and after `before` WHEN history is read THEN only the earlier lines' entries
  come.

## Tests

`src/main/claude-code/claude-code-harness.test.ts` (new cases on `createFakeSessionHost`, clock under test control):

- `start_SpawnsThroughTheHost`: with the test's `request` (`sessionId: 's-1'`, `resume: false`, `controls: {}`,
  `instructions: []`, `processId: 'p-1'`) and the `started()` deps (`env: {}`, `permissionTool: 'tool'`),
  `host.processes[0].request` is `{ id: 'p-1', command: '/bin/claude', args: ['-p', '--input-format',
  'stream-json', '--output-format', 'stream-json', '--include-partial-messages', '--verbose', '--session-id', 's-1',
  '--permission-mode', 'auto', '--permission-prompt-tool', 'tool'], cwd: '/proj', env: {}, idleRule: { key: 'type',
  value: 'result' } }`; its `writes[0]` is `JSON.stringify(contextUsageRequest('wigley-1'))`.
- `start_EnvWithUndefined_SpawnsWithoutIt`: deps `env: { KEEP: 'a', DROP: undefined }` → the spawn's `env` is
  `{ KEEP: 'a' }`.
- `start_HostSpawnFails_EndsWithHint`: `failNextSpawn('spawn /bin/claude ENOENT')` → one `ended` with `code: null`
  and an error matching `/\/bin\/claude.*\/proj/`.
- `attach_RecordedLiveSession_EqualsTheLiveRun` — the central test. Harness A runs 05's central script on the fake
  host (`host.output` for `out` and `err` lines; the clock moves 1000 per step). Harness B, on the same host, attaches
  with the same request and new recording events. Assert: the events B fired before its promise resolved are
  `sessionStarted` at the first log line's `at`, then entries equal to A's final entries (one per id, first-appearance
  order), A's agent events and usage events in order (without the one usage event A's `settings.json` read emitted
  at start, as in 05's central test), then `controls` equal to A's last (mode `plan`, effort `high`), `commands`, and
  `activity` equal to A's last. After `await settle()`, B has fired no usage event (its own settings read gives the
  same usage as the replay's last usage event) and the host record's `writes` gained nothing (no context request is
  owed: the log's one turn end has its request after it). Then `B.send({ text: 'three', images: [] })` returns
  `user-3`, and B's `interrupt()` after it writes request id `wigley-<n+1>`, `n` the highest id in the log.
- `attach_TurnEndedWhileDetached_RequestsContextOnce ($case)`, a record from `addRunning` whose log is a send
  `uuid-1` (`in`), `lifecycleInit`, `lifecycle('uuid-1', 'started')`, `successResult('ok', ['uuid-1'])` (`out`), then:
  | case | the log goes on with | host `writes` after attach |
  |---|---|---|
  | turn ended while away | nothing | `[JSON.stringify(contextUsageRequest('wigley-1'))]` |
  | request already written | `contextUsageRequest('wigley-1')` (`in`) | `[]` |
  | closed during attach | nothing; `host.close` before the promise resolves | `[]` |
- `attach_DefinitionsReject_DetachesTheHostedProcess`: `loadAgentDefinitions` catches every file error, so the test
  makes it reject through `paths`: a `posixPaths` wrapper whose `join('/proj', '.claude', 'agents')` throws
  `Error('no join')` (that call sits outside the load's `try`). The host attach succeeds, then `attach` rejects with
  `no join`; the fake host record's `detaches` is 1; no event fired; a later `host.output` for the id fires nothing.
- `attach_Cases_ResolvesByHostState ($case)`: no record → null, no event; `addRunning({ current: false, … })` → null;
  a closed record → null.
- `attach_GraceAcrossTheBoundary ($case)`, log ends with an unanswered interrupt at 1000 while working, fake timers:
  | case | clock at attach | before resolve | after |
  |---|---|---|---|
  | expired while away | 60000 | the grace notice at 6000; last `activity` `idle` | nothing more |
  | still pending | 3000 | no grace notice; last `activity` `working` | advance 2999 → nothing; advance 1 → the notice at 6000 and `idle` |
- `attach_LineDuringAttach_FoldsOnce`: a wrapper `SessionHost` over the fake host whose `attach` awaits the fake's
  `attach`, then calls the given events' `line` with the result log's last line (a repeat, same `seq`), then
  `host.output`s a new line (`seq` + 1), then resolves. The log's last line is `successResult('ok', ['uuid-1'])`; the
  new line is an assistant text line, message id `msg_2`, text `late`. Before the promise resolves, B's events hold
  `turnEnded` once for that result (a double fold gives two) and the `late` entry once.
- `attach_ClosedDuringAttach_EndsAfterTheReplay`: `host.close` before the promise resolves → the replay's events,
  then `sessionEnded` and `ended`.
- `detach_ThenOutputAndClose_FiresNothing`: after `detach()`, `host.output` and `host.close` fire no event; the
  record's `detaches` is 1 and `kills` is empty; `send` throws `Claude Code process has detached`; with fake timers
  and a pending interrupt grace, `vi.getTimerCount()` is 0.
- `detach_PendingEnd_Settles`: `end()`, then `detach()` before any `close` → the `end()` promise resolves; no `ended`
  fires; with fake timers, advancing 6000 sends no kill (`kills` is empty).
- `detach_QueuedEmission_Dropped`: `host.output` `REPLY_LINE`, then `detach()` in the same tick, then `await settle()`
  → no `entry` and no `agentEvent` is heard.
- `attach_AfterDetach_ReplaysAgain`: start, run a turn, `detach()`, attach with new events → the new events get the
  whole replay.

`src/main/claude-code/transcripts.test.ts`:

- `transcriptEntries_Before_KeepsLinesRecordedEarlier ($case)`, lines at `2026-01-01T00:00:00Z` (t0), t0 + 1 s and
  t0 + 2 s:
  | case | `before` | entries |
  |---|---|---|
  | none | null | all three lines' entries |
  | between | t0 + 1500 ms | the first two lines' entries |
  | at a line | t0 + 1000 ms | the first line's entry only (the cut is `>=`) |
  | no timestamp after a cut line | t0 + 1500 ms, a fourth line with no timestamp | the fourth gives nothing |
  | tool result after the cut | `tool_use` at t0, its `tool_result` at t0 + 2 s, `before` t0 + 1500 ms | the tool entry with no result |
  | unparseable line after a cut line | t0 + 1500 ms, a fourth line `oops` after the t0 + 2 s line | the fourth gives nothing |
  | unparseable line before the cut | t0 + 1500 ms, the line `oops` between t0 and t0 + 1 s | its raw entry, `at` t0, comes |

`src/main/claude-code/past-sessions.test.ts`: each `readHistory` call gains `, null`; add a row to the
`readHistory` describe, `readHistory_Before_PassesTheCut`, a two-line transcript and `before` between them → one
entry.

`src/shared/fake-agent-harness.test.ts`:

- `attach_Scripted_ResolvesAsSet ($case)`: no script → null; `null` → null; `reject` `gone` → rejects `gone`;
  `process` whose replay emits one entry → that entry fires before the promise resolves, the record has
  `attached: true`, and no `sessionStarted` follows; a second attach for the same id with no new script → null.
  `attachCalls` lists each request.
- `detach_StopsEventsAndRefusesCalls`: a `fake: hold` turn, `detach()` → no further event (the hold's later events
  included); `send` throws `fake agent process has detached`; `calls` ends with `{ method: 'detach' }`.
- Add a row to `history_KnownUnknownAndFailNext`: `before` `FAKE_HISTORY_AT + 1000` → only the user entry; its
  `pastSessionCalls` entry has that `before`.
- Add a row to `attach_Scripted_ResolvesAsSet`: `{ outcome: 'process', turns: 2, replay }` → the process's
  `send` returns `user-3`.
- The `pastSessionCalls` `toEqual`s at today's lines 1293 and 1335 gain `before` (`null` for `listSessions`).

`src/plugins/chat/main/chat-sessions.test.ts`: each whole-object `pastSessionCalls` expectation gains `before`: the
`listSessions` literal (today's line 537) gets `before: null`, and each `history` literal gets the `before` chat
passes (`null` until task 09). No other change.

`src/main/drive/drive-commands.test.ts`: `quit_KeepSessions_PassesTheFlag ($case)`: args `{}` → `quit` called with
`false`; `{ keepSessions: true }` → `true`; `{ keepSessions: 'yes' }` → rejects, as `optionalBoolean` rejects for
`hold`.

## Done when

- The Produces signatures are in their files. `grep -rn "not implemented until task 08\|unwiredSessionHost" src`
  finds no production file. `grep -n "createSessionHostClient" src/main/main.ts` finds the one call; no other
  production module names it. `grep -n "CLAUDE_IDLE_RULE\|'result' }" src --include='*.ts' -r` finds the rule only in
  `src/main/claude-code/`.
- `npm test`, `npm run typecheck` and `npm run lint` pass.
- The self-test run, a drive run's teardown and a real re-attach are checks of task 12 "Final verification".

## Commit

One commit for the group, by pathspec, the files above. Example message: `Run Claude sessions on the session host;
attach replays a pipe log; history cuts at the process start`.

## Proof

<written by wigley:make: commit sha, proof result, concerns; empty until the group lands>
