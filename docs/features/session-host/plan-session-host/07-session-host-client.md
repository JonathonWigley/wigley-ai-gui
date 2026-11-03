# 07 — Session host client

Status: not started
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
- `SESSION_HOST_PROTOCOL`, `ClientMessage`, `HostMessage`, `ListedProcess`, `PipeLogRecord`, `SessionHostRecord`
  and the message types in `src/contracts/session-host-protocol.ts` ← 01
- `channelPath(platform, home, username, instanceId, suffix, tempDir?)`, `connectToChannel(channel: string): Promise<Socket>`,
  `listenOnChannel(channel: string, handlers: ChannelHandlers): ChannelServer` (tests only),
  `readLines(stream: Readable, received: (line: string) => void): void`, `jsonLine(value: unknown): string` ← 02
- `Clock`, `Timers` in `src/contracts/ambient.ts`; `Log` in `src/contracts/log.ts` (in the tree)

## Produces

`src/main/session-host/session-host-client.ts`:

```ts
export type SessionHostSpawn = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,            // node:child_process
) => { unref(): void };

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

- `folder`: `path.join(app.getPath('userData'), 'session-host')`. A drive run and the self-test have their own user
  data, so each gets its own host.
- `channel`: `sessionHostChannel(process.platform, <the endpoint home the relay uses>, os.userInfo().username, appInstance.id)`.
- `hostScript`: `path.join(__dirname, 'session-host.js')`. Main's bundle is `.vite/build/main.cjs`, so `__dirname` is
  `.vite/build` in dev and `<resources>/app.asar/.vite/build` in the packaged app; task 06 writes
  `session-host.js` beside it in both. Electron's Node mode reads a script inside `app.asar`. Task 12 runs the
  packaged check.
- `execPath`: `process.execPath`; `env`: `process.env`; `spawn`: `node:child_process`'s `spawn`; `clock`, `timers`,
  `log`: main's own.

## Decisions

### Connecting

- `createSessionHostClient` starts connecting at once. Every method waits on that connection. `spawn` and
  `setKeepIdleMinutes` are synchronous: they queue their message until the connection is ready.
- **Connect:** `connectToChannel(deps.channel)`, send `hello` (`requestId` counts from 1 per connection), and wait for
  `HelloReply`. A reply whose `protocol` is not `SESSION_HOST_PROTOCOL` counts as no answer.
- **Start the host** when no host answers: call
  `deps.spawn(deps.execPath, [deps.hostScript, deps.folder, deps.channel], { detached: true, stdio: 'ignore', windowsHide: true, env: { ...deps.env, ELECTRON_RUN_AS_NODE: '1' } })`
  and `unref()` the result. Then try to connect every 100 ms (through `deps.timers`). Stop when a host answers, or
  when 10 000 ms (by `deps.clock`) have passed since the spawn. Spawn the host at most once per connect attempt.
- **A failed connect** (no answer in 10 000 ms, or the spawn throws) is logged under source `session-host`. Then:
  each queued `spawn` gets `closed({ code: null, signal: null, error: 'the session host did not start: <reason>' })`;
  `attach` resolves null; `list` resolves `[]`; `stopAll` resolves; a queued `setKeepIdleMinutes` is dropped. The
  next method call tries to connect again from the start.
- **On each new connection** (the first and each reconnect) the client sends the last `setKeepIdleMinutes` value, when
  one was set. Then it drains older hosts (below).

### Older hosts

- The client reads every `host-v*.json` in `deps.folder` whose `protocol` is not `SESSION_HOST_PROTOCOL`. For each
  record it connects to `record.channel` and sends `hello`. When the host answers, the client sends `drain` once per
  record per client, and closes that connection. When the connect fails, the record is stale: the client deletes the
  file. A file that does not parse is skipped and logged.
- `list()`: the current host's `list`, each `ListedProcess` mapped to
  `{ id, startedAt, running, current: true }`; then, for each older record, a fresh connection, `hello`, `list`, close,
  each mapped with `current: false`. An older host that does not answer adds nothing (its record is deleted as above).
- Older hosts get only `hello`, `list` and `drain`, the frozen messages.

### Processes

- `spawn(request, events)` sends `spawn` and returns a `HostedProcess` with `id = request.id`. `write`, `endInput` and
  `kill` send their messages. After `closed` they do nothing. The connection is subscribed to the process by the
  host.
- **One events object per id.** The client holds at most one live events object per id. A new `attach` to an id
  replaces the old one: the old object gets no more `line` or `closed`, and its `HostedProcess` still writes.
- `detach()` sends `{ type: 'unsubscribe', id }` and drops this object's events, when they are still the live ones
  for the id. The process keeps running. A later `attach` to the id is allowed. After `detach`, `write`, `endInput`
  and `kill` do nothing.
- Pushed `line` and `closed` go to the events of their `id`. `closed` fires once, then the id is forgotten.
- **attach(id, events):**
  1. Send `subscribe`. From now on, buffer this id's pushed `line` and `closed` messages.
  2. When the reply is `running: false`, resolve null and drop the buffer.
  3. Read the file at `reply.log`. Parse each `\n`-ended line as a `PipeLogRecord`; skip a last line without a
     newline. When the read fails, resolve null, drop the buffer, and log it (the process closed and the host deleted
     its log).
  4. Resolve `{ process, log }` with every record read, in file order.
  5. In a later macrotask (`deps.timers.set(…, 0)`), deliver each buffered `line` whose `seq` is greater than the last
     `seq` read, then a buffered `closed`; after that, deliver live messages as they come. So the caller has the log
     and has replayed it before the first live line.
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

## Tests

`src/main/session-host/session-host-client.test.ts`. A scripted host in the test: `listenOnChannel` on a socket in a
`mkdtemp` folder, `readLines` and `jsonLine`, answering each message as the test sets it and recording what it got.
Real temp folders; `afterEach` closes servers and removes folders, as `relay-server.test.ts` does. A manual `Timers`
fake and a settable clock drive the 100 ms polls and the 10 000 ms limit; the sockets are real.
- `create_HostAnswers_ConnectsWithoutSpawning` — `spawn` calls `[]`; the host got `hello`.
- `create_NoHost_SpawnsTheHostDetachedThenConnects` — one spawn call:
  `(execPath, [hostScript, folder, channel], { detached: true, stdio: 'ignore', windowsHide: true, env: { …, ELECTRON_RUN_AS_NODE: '1' } })`;
  `unref` called once; the test's spawn starts the scripted host; the next poll connects.
- `create_HostNeverAnswers_ClosesQueuedSpawnsWithTheReason` — the clock passes 10 000 ms; `closed` error starts with
  `the session host did not start:`; `list()` resolves `[]`.
- `attach_LogThenLive_DeliversOnlyLinesPastTheLastSeq` — the § Behaviour line. Assert also that no `line` reached the
  events before `await attach(…)` returned.
- `attach_Cases_ResolvesNull` — table: reply `running: false`; the log file missing.
- `list_CurrentAndOlderHosts_MergesWithTheCurrentFlag` — current lists `a`, an older host (record `host-v0.json`)
  lists `b` → `[{ id: 'a', startedAt: 1, running: true, current: true }, { id: 'b', startedAt: 2, running: true, current: false }]`;
  the older host got `drain` exactly once after two `list()` calls.
- `olderRecord_NoAnswer_IsDeleted` — `host-v0.json` naming a dead channel is gone after `list()`.
- `hostExits_OpenProcesses_CloseWithAnError` — the § Behaviour line, for one spawned and one attached process.
- `close_OpenProcesses_FiresNoClosed`.
- `detach_ThenAttach_SendsUnsubscribeAndDeliversToTheNewEventsOnly` — the host got `{ type: 'unsubscribe', id: 'a' }`;
  a later line reaches only the second attach's events; the host's death closes only the attached one.
- `attach_Twice_TheFirstEventsGetNothingMore`.
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

