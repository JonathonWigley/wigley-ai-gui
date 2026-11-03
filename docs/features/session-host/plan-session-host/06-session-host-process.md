# 06 — Session host process

Status: not started
Type: Task
Wave: 2 · Depends on: 01, 02
Plan: [plan.md](plan.md)

Files:
- create `src/session-host/session-host.ts` (the composition root and build entry)
- create `src/session-host/process-table.ts` · test `src/session-host/process-table.test.ts`
- create `src/session-host/pipe-log.ts` · test `src/session-host/pipe-log.test.ts`
- create `src/session-host/host-server.ts` · test `src/session-host/host-server.test.ts`
- create `vite.session-host.config.mts`
- modify `forge.config.mts`
- modify `scripts/check-layers.mts`

The implementer may split or name the inner modules otherwise. The root's file name, the built script's name, the
arguments, the folder layout and the protocol behaviour below are fixed.

Consumes:
- `src/contracts/session-host.ts` (all types), `SESSION_HOST_PROTOCOL`, `ClientMessage`, `HostMessage`,
  `ListedProcess`, `PipeLogRecord`, `SessionHostRecord`, every message type, `HOST_LOGS_FOLDER`,
  `hostRecordFile(protocol: number): string`, `hostLogFile(protocol: number): string`,
  `hostRecordProtocol(fileName: string): number | null` and `pipeLogFile(id: string): string` in
  `src/contracts/session-host-protocol.ts` ← 01
- `listenOnChannel(channel: string, handlers: ChannelHandlers): ChannelServer`,
  `connectToChannel(channel: string): Promise<Socket>`,
  `readLines(stream: Readable, received: (line: string) => void, options?: ReadLinesOptions): void`,
  `jsonLine(value: unknown): string` ← 02
- `Clock`, `Timers` in `src/contracts/ambient.ts` (in the tree)

## Produces

- The built host script `.vite/build/session-host.js`, in dev (`npm start`) and in the packaged app
  (`<resources>/app.asar/.vite/build/session-host.js`). Task 04 finds the host by this name on its command line.
  Task 07 spawns it.
- The host's command line: `<execPath> <hostScript> <folder> <channel>`, with `ELECTRON_RUN_AS_NODE=1`.
  `process.argv[2]` is the host folder; `process.argv[3]` is the channel path.
- The host folder layout (`<folder>` is `<app instance user data>/session-host`). Every name comes from 01's
  functions; the host writes no file name literal of its own:
  - `hostRecordFile(SESSION_HOST_PROTOCOL)` (`host-v1.json`) — a `SessionHostRecord`, written after the server
    listens, deleted at exit.
  - `hostLogFile(SESSION_HOST_PROTOCOL)` (`host-v1.log`) — the host's own diagnostic lines, emptied once this host
    owns the channel.
  - `<HOST_LOGS_FOLDER>/<pipeLogFile(id)>` (`logs/a.jsonl` for id `a`, `logs/x%3A1.jsonl` for id `x:1`) — one pipe
    log per hosted process, one `PipeLogRecord` JSON object per line. `list` and `subscribe` give the client the
    absolute path, so the client never computes it.
- The protocol behaviour in § Decisions, which task 07's client relies on.

## Decisions

### Build and packaging

- The root is `src/session-host/session-host.ts`, not `main.ts`: forge's Vite plugin names a build's output after its
  entry file, and a second `main` entry would write over `.vite/build/main.cjs`.
- `vite.session-host.config.mts` sets the output file name to `session-host.js` (Vite `build.lib.fileName` returning
  `'session-host.js'`, the format CommonJS). `package.json` has no `"type": "module"`, so Node loads `.js` as
  CommonJS. If forge's own setting wins over the config, the implementer finds the setting that does produce
  `session-host.js` and records it in the Proof. The name is fixed by plan.md § Boundary rules.
- `forge.config.mts`: add the build entry
  `{ entry: 'src/session-host/session-host.ts', config: 'vite.session-host.config.mts', target: 'main' }` after the
  preload entry. Set `[FuseV1Options.RunAsNode]: true`. Leave every other fuse unchanged.
- `scripts/check-layers.mts` gains `'src/session-host': { layers: ['src/contracts', 'src/shared', 'src/shared/local-channel'], packages: ['node:'] }`
  with a comment: "The session host process: no electron import (`docs/features/session-host/design.md`)."

### Start and exit

Start runs these steps in this order. A host that does not own the channel writes no file in `<folder>`: it does
not empty the diagnostic log, write a record or delete a pipe log, since all of these belong to the live host.

1. The root reads `argv[2]` and `argv[3]`. It makes `<folder>` and `<folder>/logs` (`recursive`).
2. **Probe.** It calls `connectToChannel(channel)` and sends `hello`. When a host answers with `protocol` equal to
   `SESSION_HOST_PROTOCOL` within 2000 ms, this host exits with code 0 without listening. Another host already owns
   the channel. A connect that rejects, a reply with another protocol, or no reply in 2000 ms is no answer; the host
   destroys that socket and goes on.
3. **Snapshot.** It reads the names in `logs/`. Only these names are sweep candidates (step 6).
4. **Listen** with `listenOnChannel`. When `failed` got an error whose `code` is `'EADDRINUSE'` (task 02: another
   listener took the channel after the probe), the host exits with code 0, as in step 2. When `listening` is false
   for any other error, the host appends the error to the diagnostic log and exits with code 1.
5. **Own.** When `listening` is true, the host empties `hostLogFile(SESSION_HOST_PROTOCOL)`, then writes
   `hostRecordFile(SESSION_HOST_PROTOCOL)` = `{ protocol: SESSION_HOST_PROTOCOL, channel, pid: process.pid }` through
   a temp file (`<record name>.tmp`) and a rename.
6. **Log sweep.** The host reads every other record in `<folder>` (each name with a `hostRecordProtocol` that is not
   null and not `SESSION_HOST_PROTOCOL`). It connects to each record's channel and sends `hello`. When no other host
   answers within 2000 ms each, each snapshot name belongs to a dead host: the host deletes each snapshot name that
   is not `pipeLogFile(id)` of a process in its table. When any other host answers, it deletes nothing. The host
   serves clients during the sweep: a process spawned during it has a name outside the snapshot, or is in the table,
   so the sweep never deletes a live log.

- **Client.** A connection is a **client** once it sends any message other than `hello`, `list` or `drain`. It stays
  a client until it disconnects. A connection that sends only `hello`, `list` or `drain` (another host's probe or
  sweep, task 07's older-host checks) is never a client: it does not hold the host open, and it does not start or
  stop a keep window. Task 07's client sends `setKeepIdle` on each new connection, so the app is a client at once.
- **Exit rule:** the host exits when it holds no process and no client is connected. It checks the rule when a
  process closes and when a client disconnects. After start it waits 30 000 ms for the first client; it checks the
  rule when that wait ends. (Task 07's client waits at most 10 000 ms for the channel.)
- On exit the host closes the server, deletes its record, and exits with code 0. A host that dies takes its
  processes with it: their pipes close.
- **Errors.** The host adds an `error` listener to each child's stdin, stdout and stderr, and to each connection
  socket. Each one appends the error to the diagnostic log, and the host goes on. An `EPIPE` on stdin from a write to
  a child that just died is one of these: the child's `close` still closes the process. A connection error is then
  handled as that connection's disconnect. A push or reply to a connection that is destroyed or not writable is
  dropped. Only an error outside these listeners (an `uncaughtException`) is written to the diagnostic log and
  ends the host with code 1.

### Processes

- `spawn` runs `request.command` with `request.args`, `cwd`, and `env` exactly as sent: the host adds nothing, so its
  own `ELECTRON_RUN_AS_NODE` never reaches a hosted process. stdio is three pipes; `windowsHide: true`; not detached.
  The host's spawn is an injected dep in the process table, of the type `ClaudeSpawn` has
  (`(command, args, { cwd, env }) => ChildProcessWithoutNullStreams`).
- The host refuses a `spawn` whose `id` it already holds, and every `spawn` while draining. It answers a refusal with
  `closed` `{ code: null, signal: null, error }` to that connection: `a process with id <id> already exists` or
  `the session host is draining`.
- A child `error` event before it ran (such as `ENOENT`) closes the process with `{ code: null, signal: null,
  error: error.message }`. A child `close` event closes it with `{ code, signal, error: null }`.
- **Pipe log:** the host splits stdout and stderr with 02's `readLines` and `{ flushPartialAtEnd: true }`, so a
  last line with no newline is logged when the stream ends, before the child's `close`. It writes no splitter of its
  own. Each `out` or `err` line and each `in` line (the text of a `write`) gets the next `seq` (1 first, per process)
  and `at = clock.now()`. At `spawn` the host creates the file `logs/<pipeLogFile(id)>` empty (it truncates a
  leftover file of that name). The host appends each record to it with a synchronous append **before** it pushes the
  `line` to subscribers. So a line pushed live is always in the file, and the client's read-then-live order has no gap.
  `in` lines are logged and never pushed.
- `write(id, text)` writes `text + '\n'` to stdin and logs it as `in`. `endInput` ends stdin. `kill` sends the
  signal. Each of these does nothing for an unknown or closed id.
- **When a process closes**, the host pushes `closed` to each subscribed connection, then deletes its pipe log
  and drops the process from its table. A closed process never shows in `list`. (Decided: the log lives as long as
  its process; a client that is still reading it gets a read error and task 07 treats it as no process.)

### Idle and the keep window

- Idle rule, per process: the state starts **idle**. An `in` line makes it busy. An `out` line whose text parses as a
  JSON object whose top-level `idleRule.key` equals `idleRule.value` (strict equality, string) makes it idle. Any
  other `out` line makes it busy (non-JSON included). An `err` line leaves the state unchanged.
- `keepIdleMinutes` starts at 60. `setKeepIdle` sets it for the whole host (last value wins) and re-arms each timer.
- **The keep window runs only while no client is connected** ("client" as in § Start and exit). For an idle process,
  the deadline is
  `keepIdleMinutes * 60 000` ms after the later of: the moment it turned idle, the moment the last client
  disconnected. A client connecting, or the process turning busy, cancels the timer. At the deadline the host ends the
  process.
- **End** = `endInput`; then `SIGTERM` after 3000 ms; then `SIGKILL` after another 3000 ms. These are
  `END_GRACE_MS` in `claude-code-harness.ts` (3000), the grace the harness's own `end` uses. A close cancels the
  pending signals.
- All times come from the injected `Clock` and `Timers`. The root builds them as `main.ts` does
  (`setTimeout(...)[Symbol.toPrimitive]()`).

### Protocol (newline JSON over the channel, `readLines` and `jsonLine`)

- `hello` → `{ type: 'hello', requestId, protocol: SESSION_HOST_PROTOCOL }`.
- `list` → `{ type: 'list', requestId, processes }`, one `ListedProcess` per process in the table:
  `running: true`, `code: null`, `signal: null`, `log` the absolute path of its `.jsonl`.
- `drain` → no reply. The host sets draining. It ends each idle process now and each other process when it turns
  idle (the **End** steps), whether or not a client is connected. Once the table is empty it exits, closing every
  connection.
- **One subscriber per process.** A process has at most one subscribed connection. A `spawn` subscribes the
  connection that sent it. A `subscribe` makes its connection the subscriber and replaces any earlier one, which gets
  no more `line` or `closed` for that id.
- `spawn` → no reply.
- `unsubscribe` → no reply. When the sending connection is the process's subscriber, the process has none from now
  on. From any other connection it does nothing. The process keeps running, and the keep window treats it as
  unattached only when no client is connected at all (the window rule above is unchanged).
- `write`, `endInput`, `kill`, `setKeepIdle` → no reply.
- `subscribe` → when the id is in the table, the host subscribes the connection, **then** replies
  `{ type: 'subscribe', requestId, id, running: true, log: <path> }`. For an unknown id it replies
  `running: false, log: null` and subscribes nothing.
- `stopAll` → the host sends `SIGTERM` to each process, `SIGKILL` 3000 ms later to each still open, and replies
  `{ type: 'stopAll', requestId }` once the table is empty. With an empty table it replies at once.
- `line` and `closed` are pushed to each subscribed connection.
- A line that is not JSON, or has an unknown `type`, is written to the diagnostic log and ignored. A disconnect drops
  that connection's subscriptions.

## Behaviour

GIVEN a process with rule `{ key: 'type', value: 'result' }`, keep 60, and no client WHEN it writes
`{"type":"result"}` at t = 0 THEN at t = 3 600 000 its stdin ends, at 3 603 000 it gets `SIGTERM`, at 3 606 000
`SIGKILL`.
GIVEN the same process WHEN a client is connected at the deadline THEN nothing ends; WHEN the client disconnects at
t = 5 000 000 THEN stdin ends at t = 8 600 000.
GIVEN a client subscribed to `a` WHEN `a` closes THEN the client gets `closed`, and `logs/a.jsonl` is gone.
GIVEN draining and a busy process WHEN it writes the result line THEN the host ends it, and exits once it closes.
GIVEN another live host on the channel WHEN a second host starts THEN the second exits with code 0, writes no
record, and leaves the live host's diagnostic log and channel as they were.
GIVEN a process with id `x:1` WHEN it writes a line THEN the line is in `logs/x%3A1.jsonl`.
GIVEN a child whose stdin errors with `EPIPE` WHEN the client writes to it THEN the host and its other processes
keep running.
GIVEN only another host's `hello` probe connected and an empty table WHEN the probe disconnects inside the
30 000 ms first-client wait THEN the host does not exit before that wait ends.

## Tests

Process table and pipe log (fake spawn with `PassThrough` stdio, as `fakeChild` in
`src/main/claude-code/claude-code-harness.test.ts`; a manual `Timers` fake and a settable clock; real `mkdtemp`
folders):
- `spawn_LinesBothWays_AppendsRecordsInSeqOrder` — after `write('hi')` and stdout `ok\n`, the file holds
  `{"seq":1,"dir":"in","at":1000,"text":"hi"}` then `{"seq":2,"dir":"out","at":1000,"text":"ok"}`; the listener got
  only seq 2.
- `idleRule_LineCases_SetsTheState` — table: start → idle; `in` → busy; `out` `{"type":"result"}` → idle; `out`
  `{"type":"assistant"}` → busy; `out` `not json` → busy; `err` after idle → idle.
- `keepWindow_IdleNoClient_EndsAfterTheWindowThenGraces` — the three times in § Behaviour.
- `keepWindow_ClientConnected_EndsNothingUntilItLeaves` — the second § Behaviour line.
- `setKeepIdle_Zero_EndsAnIdleUnattachedProcessAtOnce`.
- `close_EndsPendingSignals_AndDeletesTheLog` — a close at 3 601 000 sends no `SIGTERM`; the file is gone.
- `spawn_Refusals_CloseWithTheReason` — table: duplicate id → `a process with id a already exists`; draining →
  `the session host is draining`.
- `spawn_ChildError_ClosesWithTheMessage` — error `spawn x ENOENT` → `{ code: null, signal: null, error: 'spawn x ENOENT' }`.
- `pipeLog_IdCases_WritesTheSafeFileName` — table: id `a` → `logs/a.jsonl`; id `x:1` → `logs/x%3A1.jsonl`; id `../y`
  → `logs/..%2Fy.jsonl`, and no file is made outside `logs/`.
- `pipeLog_PartialLastLine_IsLoggedBeforeClose` — stdout writes `{"a":1}\n{"b"` and ends, then the child emits
  `close` → the file holds `{"a":1}` seq 1 and `{"b"` seq 2 before the log is deleted (assert in the `closed`
  listener); the listener got both lines.
- `stdinError_WriteAfterChildDied_KeepsTheHostAndOtherProcesses` — two processes `a` and `b`; `a`'s stdin emits an
  `EPIPE` error during `write('x')` → no throw, one diagnostic log line; `b` still logs and pushes a later line;
  `exit` was not called.

Server (real channel in a `mkdtemp` folder, fake spawn):
- `hello_RepliesTheProtocol` — `{ type: 'hello', requestId: 1, protocol: 1 }`.
- `subscribe_Cases_RepliesThenPushesLines` — known id → `running: true`, `log` the file path, then a later line
  arrives as `line`; unknown id → `running: false, log: null`.
- `list_TwoProcesses_ListsEachWithItsLogPath`.
- `subscribe_SecondConnection_ReplacesTheFirst` — after connection B subscribes to `a`, a new line reaches B only.
- `unsubscribe_Cases_StopsOnlyTheSubscriber` — table: from the subscriber → no further `line` reaches it and `a`
  keeps running; from another connection → the subscriber still gets lines.
- `stopAll_Cases_RepliesOnceEveryProcessClosed` — table: two processes → reply after both fake children emit
  `close`, `SIGKILL` to a child still open after 3000 ms; empty table → reply at once, no signal sent.
- `closed_SubscribedClient_GetsClosedThenLogGone` — the client subscribed to `a`; the fake child emits `close` with
  code 0 → the client gets `{ type: 'closed', id: 'a', exit: { code: 0, signal: null, error: null } }`; after that
  push, `logs/a.jsonl` does not exist; a following `list` does not name `a`.
- `connectionError_ResetSocket_IsADisconnect` — a client socket emits `error` (`ECONNRESET`) → the host logs it,
  drops that connection's subscriptions, does not exit while it holds a process, and a push to that connection
  throws nothing.
- `drain_IdleAndBusy_EndsEachAtTurnEndThenExits` — exit is a dep the test records.
- `exitRule_Cases_ExitsOnlyWithNoProcessAndNoClient` — table: the last client disconnects with an empty table →
  exit; no connection at all → exit at 30 000 ms, not before; a connection that sent only `hello` and `list`
  disconnects at 1 000 ms with an empty table → no exit until 30 000 ms; a client that sent `setKeepIdle` is
  connected at 30 000 ms → no exit.
- `keepWindow_ProbeConnection_IsNotAClient` — an idle process and no client; a connection sends `hello` at
  t = 1 000 000 and disconnects → stdin still ends at t = 3 600 000.
- `start_RecordAndSweep` — table:
  - no other host → writes `host-v1.json` = `{ protocol: 1, channel, pid }`; the diagnostic log is emptied; deletes a
    leftover `logs/old.jsonl`.
  - a live host behind `host-v0.json` → keeps `logs/old.jsonl`.
  - a client spawns `new` while the sweep waits on a dead `host-v0.json` channel (the sweep's `hello` timer not yet
    fired) → after the sweep, `logs/old.jsonl` is gone and `logs/new.jsonl` holds its lines.
  - `listening` false with an error other than `EADDRINUSE` → exit code 1, no record.
- `start_AnotherLiveHost_ExitsZeroWithoutRecord` — table: a live host answers the probe `hello` with protocol 1 →
  exit code 0; a test server on the channel that accepts and never replies (the probe gets no answer in 2000 ms,
  then `listenOnChannel` fails with `EADDRINUSE`) → exit code 0. In both
  rows: no `host-v1.json` is written, the live host's `host-v1.log` keeps its content, `logs/old.jsonl` is kept,
  and a new client still reaches the live host.

## Done when

`npm run typecheck`, `npm run lint` and `npm test` pass. `grep -n "RunAsNode\]: true" forge.config.mts` finds the
fuse. `npm run package` leaves `.vite/build/session-host.js` and no change to `.vite/build/main.cjs`'s name. This
proves that forge's Vite plugin keeps `build.lib.fileName` for the second entry.

**Packaged asar probe.** Task 07's `hostScript` rule rests on one claim: Electron in Node mode loads a script inside
`app.asar` with the `EnableEmbeddedAsarIntegrityValidation` and `OnlyLoadAppFromAsar` fuses on. After
`npm run package`, run the packaged binary as the host, with a `mkdtemp` folder `<tmp>` under
`/tmp/claude-scratch-survive/`:

`ELECTRON_RUN_AS_NODE=1 out/wigley-ai-gui-darwin-arm64/wigley-ai-gui.app/Contents/MacOS/wigley-ai-gui out/wigley-ai-gui-darwin-arm64/wigley-ai-gui.app/Contents/Resources/app.asar/.vite/build/session-host.js <tmp> <tmp>/h.sock`

Pass: `<tmp>/host-v1.json` exists within 5 s, and the process exits by itself with code 0 about 30 s later (no
client came). Record the command and the result in the Proof. On fail, stop and report it to the lead: tasks 07, 08
and 12 build on this claim, and the plan needs a new host script location before 08 starts. No task runs this probe
on Windows.

Commit: one commit for the group.

## Proof

