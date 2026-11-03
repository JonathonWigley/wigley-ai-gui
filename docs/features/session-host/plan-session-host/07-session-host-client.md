# 07 — Session host client

Status: in progress
Type: Task
Wave: 2 · Depends on: 01, 02
Plan: [plan.md](plan.md)

Files:
- create `src/main/session-host/session-host-client.ts` · test `src/main/session-host/session-host-client.test.ts`
- create `src/main/session-host/session-host-channel.ts` · test `src/main/session-host/session-host-channel.test.ts`

The implementer may add inner modules in `src/main/session-host/`. The check-layers rule for this folder lands in
task 02.

Consumes:
- `SessionHost`, `HostedSpawn`, `HostedProcess`, `HostedProcessEvents`, `HostedProcessInfo`, `HostedExit`,
  `PipeLine` in `src/contracts/session-host.ts` ← 01
- `SESSION_HOST_PROTOCOL`, `ClientMessage`, `HostMessage`, `ListedProcess`, `PipeLogRecord`, `SessionHostRecord`,
  the message types, and `hostRecordProtocol(fileName: string): number | null` in
  `src/contracts/session-host-protocol.ts` ← 01. The client writes no host file name literal: it finds records with
  `hostRecordProtocol` and reads pipe logs at the path the host gives.
- `channelPath(platform, home, username, instanceId, suffix, tempDir?)`, `connectToChannel(channel: string): Promise<Socket>`,
  `listenOnChannel(channel: string, handlers: ChannelHandlers): ChannelServer` (tests only),
  `readLines(stream: Readable, received: (line: string) => void, options?: ReadLinesOptions): void` (default options),
  `jsonLine(value: unknown): string` ← 02
- `Clock`, `Timers` in `src/contracts/ambient.ts`; `Log` in `src/contracts/log.ts` (in the tree)

## Produces

`src/main/session-host/session-host-client.ts`:

```ts
export type SessionHostSpawn = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,            // node:child_process
) => {
  unref(): void;
  // node:child_process reports ENOENT, EACCES and EMFILE as an `error` event, not a throw.
  on(event: 'error', listener: (error: Error) => void): unknown;
};

export interface SessionHostClientDeps {
  folder: string;        // <app instance user data>/session-host
  channel: string;       // sessionHostChannel(...)
  hostScript: string;    // the built session-host.js
  execPath: string;      // process.execPath
  env: NodeJS.ProcessEnv;
  spawn: SessionHostSpawn;
  clock: Clock;
  timers: Timers;
  log: Log;
}

export interface SessionHostClient extends SessionHost {
  // Disconnects from every host. Kills nothing; fires no `closed`.
  close(): Promise<void>;
}

export function createSessionHostClient(deps: SessionHostClientDeps): SessionHostClient
```

`src/main/session-host/session-host-channel.ts`:

```ts
export function sessionHostChannel(
  platform: NodeJS.Platform,
  home: string,
  username: string,
  instanceId: string,
): string  // channelPath(platform, home, username, instanceId, `-session-host-v${SESSION_HOST_PROTOCOL}`)
```

### How task 08 builds it (for 08; 07 does not edit `main.ts`)

- `folder`: per run mode (08 § main.ts). The live app and a drive run use
  `path.join(app.getPath('userData'), 'session-host')`; a drive run's user data is its own, so it gets its own host.
  The self-test uses `path.join(<its temp home>, 'session-host')`, because every self-test shares one user data
  folder; the self-test's teardown deletes the temp home, and the host folder with it.
- `channel`: `sessionHostChannel(process.platform, <the endpoint home the relay uses>, os.userInfo().username, appInstance.id)`.
- `hostScript`: `path.join(__dirname, 'session-host.js')`. Main's bundle is `.vite/build/main.cjs`, so `__dirname` is
  `.vite/build` in dev and `<resources>/app.asar/.vite/build` in the packaged app; task 06 writes
  `session-host.js` beside it in both. Electron's Node mode reads a script inside `app.asar`: task 06's Done when
  proves it on the packaged macOS build before 08 starts. No task runs it on Windows (task 12 runs on macOS).
- `spawn`: `node:child_process`'s `spawn` returns a `ChildProcess`, which has `unref` and `on('error', …)`, so it
  fits `SessionHostSpawn` as is.
- `execPath`: `process.execPath`; `env`: `process.env`; `spawn`: `node:child_process`'s `spawn`; `clock`, `timers`,
  `log`: main's own.

## Decisions

### Connecting

- `createSessionHostClient` starts connecting at once. Every method waits on that connection. `spawn` and
  `setKeepIdleMinutes` are synchronous: they queue their message until the connection is ready.
- **Connect:** `connectToChannel(deps.channel)`, send `hello` (`requestId` counts from 1 per connection), and wait for
  `HelloReply`. **No answer** is any of: the connect rejects; the reply's `protocol` is not `SESSION_HOST_PROTOCOL`;
  no reply within **1000 ms** of the `hello` (by `deps.timers`). On no answer the client destroys that socket. This
  1000 ms wait is the same for every `hello` and older-host `list` the client sends.
- **Start the host** when no host answers: call
  `deps.spawn(deps.execPath, [deps.hostScript, deps.folder, deps.channel], { detached: true, stdio: 'ignore', windowsHide: true, env: { ...deps.env, ELECTRON_RUN_AS_NODE: '1' } })`,
  add an `error` listener to the result, and `unref()` it. Then try to connect every 100 ms (through `deps.timers`),
  each try bounded by the 1000 ms `hello` wait. Stop when a host answers, or when 10 000 ms (by `deps.clock`) have
  passed since the spawn. Spawn the host at most once per connect attempt: a try with no answer never spawns again.
- **A failed connect** is logged under source `session-host`. It is one of: no answer in 10 000 ms (reason
  `no answer in 10000 ms`); the spawn throws; the spawn result emits `error`. The last two end the attempt at once,
  with the error's message as the reason. Then: each queued `spawn` gets
  `closed({ code: null, signal: null, error: 'the session host did not start: <reason>' })`; `attach` resolves null;
  `list` resolves `[]`; `stopAll` resolves; a queued `setKeepIdleMinutes` is dropped (its value is kept as the last
  value). An `error` from the spawn result after the attempt ended is logged and does nothing more. The next method
  call tries to connect again from the start.
- **On each new connection** (the first and each reconnect) the client sends `setKeepIdle` with the last
  `setKeepIdleMinutes` value, or 60 (the host's default) when none was set yet. This makes the connection a client
  at once (task 06 § Start and exit: a connection that sends only `hello`, `list` or `drain` is not one). Then it
  drains older hosts (below).
- The client adds an `error` listener to every socket it opens. It logs the error under source `session-host`. On the
  current host's socket the following `close` is the host dying (below). A message to a socket that is destroyed is
  dropped.

### Older hosts

- The client reads every file in `deps.folder` whose `hostRecordProtocol(name)` is not null and not
  `SESSION_HOST_PROTOCOL`: an **other record**. A record is **older** when its protocol is lower than
  `SESSION_HOST_PROTOCOL`, and **newer** when it is higher (a newer app's host that still runs after a downgrade).
- For each older record the client connects to `record.channel` and sends `hello`. When the host answers (any
  `protocol`), the client sends `drain` once per record per client, and closes that connection. The client never
  drains a newer record's host: the design lets an app drain only an older host. It logs a newer record once per
  record per client.
- When the connect to any other record's channel rejects, the record is stale: the client deletes the file. A connect
  that succeeds but gets no reply in 1000 ms keeps the file (the host may be busy). A file that does not parse is
  skipped and logged.
- `list()`: the current host's `list`, each `ListedProcess` mapped to `{ id, startedAt, running, current: true }`;
  then, for each other record (older and newer), a fresh connection, `hello`, `list`, close, each mapped with
  `current: false`. So chat refuses a send to a row whose process runs in a newer host, and no second agent process
  resumes that session. A host that does not answer adds nothing.
- Other hosts get only `hello`, `list` and `drain`, the frozen messages.

### Processes

- `spawn(request, events)` sends `spawn` and returns a `HostedProcess` with `id = request.id`. `write`, `endInput` and
  `kill` send their messages. After `closed` they do nothing. The connection is subscribed to the process by the
  host.
- **One events object per id.** The client holds at most one live events object per id. A new `attach` to an id
  replaces the old one: the old object gets no more `line` or `closed`, and its `HostedProcess` still writes.
- `detach()`: when this object's events are still the live ones for the id, it sends
  `{ type: 'unsubscribe', id }` and drops them. When they are not (a later `attach` replaced them), it sends nothing:
  the host's subscription is per connection, so an `unsubscribe` would cut off the newer subscriber. This matches
  task 01's fake. Either way the process keeps running, a later `attach` to the id is allowed, and after `detach`
  this object's `write`, `endInput` and `kill` do nothing.
- Pushed `line` and `closed` go to the events of their `id`. `closed` fires once, then the id is forgotten.
- **attach(id, events):**
  1. Send `subscribe`. From now on, buffer this id's pushed `line` and `closed` messages.
  2. When the reply is `running: false`, resolve null and drop the buffer.
  3. Read the file at `reply.log`. Parse each `\n`-ended line as a `PipeLogRecord`; skip a last line without a
     newline. When the read fails, send `{ type: 'unsubscribe', id }` (when these events are still the live ones for
     the id), resolve null, drop the buffer, and log it. Most often the process closed and the host deleted its log;
     on any other read error the unsubscribe leaves the process unowned, as a detach does, so the keep window and
     drain still end it.
  4. Resolve `{ process, log }` with every record read, in file order.
  5. In a later macrotask (`deps.timers.set(…, 0)`), deliver each buffered `line`, then a buffered `closed`; after
     that, deliver live messages as they come. So a caller that replays the log in the continuation of its `await`
     has replayed it before the first live line (01's `SessionHost.attach` comment).
  6. **Seq filter, for the life of these events:** the client keeps the highest `seq` read from the file or delivered
     for the id. It drops every `line` (buffered or live) whose `seq` is at or below it. A line the host appended
     before the read can still be in transit on the socket after the flush; the filter keeps it from reaching the
     events twice.
- **The host dies while connected** (the socket closes, and `close()` was not called): each process this client
  spawned or attached that has not closed and is not detached gets
  `closed({ code: null, signal: null, error: 'the session host exited' })`. Each pending `attach` resolves null; each
  pending `list` resolves `[]`; each pending `stopAll` resolves. The next method call reconnects, which starts a new
  host.
- `stopAll()` sends `stopAll` to the current host and resolves on its reply. It does not touch older hosts.
- `close()` ends every connection, clears every timer, and fires no `closed`. Methods after `close` do nothing;
  `attach` resolves null and `list` resolves `[]`.

## Behaviour

GIVEN a live host on the channel WHEN the client is created THEN `spawn` is never called.
GIVEN no host WHEN the client is created THEN it spawns `execPath` with `[hostScript, folder, channel]`,
`detached: true`, `stdio: 'ignore'`, `ELECTRON_RUN_AS_NODE: '1'`, calls `unref`, and connects once the host listens.
GIVEN a log file with seq 1–3 WHEN `attach` runs and the host pushes seq 3 and 4 during the read THEN the result log
holds seq 1–3, and the events get only seq 4, after the promise resolved.
GIVEN a spawned process WHEN the host's socket closes THEN the events get `closed` with error `the session host exited`.
GIVEN a host record with a higher protocol than `SESSION_HOST_PROTOCOL` WHEN `list()` runs THEN its processes list
with `current: false`, and its host gets no `drain`.
GIVEN no host WHEN the host spawn emits `error` (`spawn x ENOENT`) THEN each queued spawn closes with
`the session host did not start: spawn x ENOENT` at once, not after 10 000 ms.

## Tests

`src/main/session-host/session-host-client.test.ts`. A scripted host in the test: `listenOnChannel` on a socket in a
`mkdtemp` folder, `readLines` and `jsonLine`, answering each message as the test sets it and recording what it got.
Real temp folders; `afterEach` closes servers and removes folders, as `relay-server.test.ts` does. A manual `Timers`
fake and a settable clock drive the 100 ms polls and the 10 000 ms limit; the sockets are real.
- `create_HostAnswers_ConnectsWithoutSpawning` — `spawn` calls `[]`; the host got `hello`, then
  `{ type: 'setKeepIdle', minutes: 60 }` before any `setKeepIdleMinutes` call.
- `create_SpawnEmitsError_FailsAtOnce` — the test's spawn returns an object that emits `error` (`spawn x ENOENT`) in
  a later microtask; a queued `spawn` gets `closed` error `the session host did not start: spawn x ENOENT` with the
  clock not moved; no unhandled `error`; `spawn` calls 1.
- `connect_HostNeverRepliesToHello_CountsAsNoAnswer` — a test server on the channel accepts and never replies; after
  1000 ms on the timers fake the client spawns the host once; later polls that also get no reply spawn nothing more.
- `create_NoHost_SpawnsTheHostDetachedThenConnects` — one spawn call:
  `(execPath, [hostScript, folder, channel], { detached: true, stdio: 'ignore', windowsHide: true, env: { …, ELECTRON_RUN_AS_NODE: '1' } })`;
  `unref` called once; the test's spawn starts the scripted host; the next poll connects.
- `create_HostNeverAnswers_ClosesQueuedSpawnsWithTheReason` — the clock passes 10 000 ms; `closed` error starts with
  `the session host did not start:`; `list()` resolves `[]`.
- `attach_LogThenLive_DeliversOnlyLinesPastTheLastSeq` — the § Behaviour line. Assert also that no `line` reached the
  events before `await attach(…)` returned. Add a row where the scripted host pushes seq 3 only after the flush
  timer ran (seq 3 is in the file): the events still get only seq 4.
- `attach_Cases_ResolvesNull` — table: reply `running: false` → null, no `unsubscribe` sent; the log file missing →
  null, and the host got `{ type: 'unsubscribe', id: 'a' }`.
- `list_CurrentAndOtherHosts_MergesWithTheCurrentFlag` — current lists `a`, an older host (record `host-v0.json`)
  lists `b`, a newer host (record `host-v2.json`) lists `c` →
  `[{ id: 'a', startedAt: 1, running: true, current: true }, { id: 'b', startedAt: 2, running: true, current: false }, { id: 'c', startedAt: 3, running: true, current: false }]`;
  after two `list()` calls the older host got `drain` exactly once and the newer host got none; `host-v2.json` still
  exists.
- `otherRecord_Cases_DeletesOnlyWhenTheConnectFails` — table: `host-v0.json` naming a dead channel → gone after
  `list()`; `host-v0.json` naming a server that accepts and never replies → kept, adds nothing to `list()`;
  `host-v1.json.tmp` → not read.
- `hostExits_OpenProcesses_CloseWithAnError` — the § Behaviour line, for one spawned and one attached process.
- `close_OpenProcesses_FiresNoClosed`.
- `detach_ThenAttach_SendsUnsubscribeAndDeliversToTheNewEventsOnly` — the host got `{ type: 'unsubscribe', id: 'a' }`;
  a later line reaches only the second attach's events; the host's death closes only the attached one.
- `attach_Twice_TheFirstEventsGetNothingMore`.
- `detach_StaleObject_SendsNoUnsubscribe` — attach `a` (first), attach `a` again (second), detach the first → the
  host got no `unsubscribe`; a later line reaches the second events.
- `setKeepIdleMinutes_Reconnect_SendsTheLastValueAgain` — set 30, the host dies, the next call reconnects; the new
  host gets `{ type: 'setKeepIdle', minutes: 30 }`.

`src/main/session-host/session-host-channel.test.ts`:
- `sessionHostChannel_Darwin_UsesTheProtocolSuffix` — `('darwin', '/Users/u', 'u', 'wigley-ai-gui')` →
  `/Users/u/.agents/wigley-ai-gui/app-session-host-v1.sock`.

## Done when

`npm run typecheck`, `npm run lint` and `npm test` pass. Only tests name `createSessionHostClient` until task 08
wires it in `main.ts`.

Commit: one commit for the group.

## Proof

