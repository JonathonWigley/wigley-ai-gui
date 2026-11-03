# 02 — Local channel transport

Status: in progress
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:
- create `src/shared/local-channel/channel-path.ts` · test `src/shared/local-channel/channel-path.test.ts`
- create `src/shared/local-channel/local-channel.ts` · test `src/shared/local-channel/local-channel.test.ts`
- create `src/shared/local-channel/line-framing.ts` · test `src/shared/local-channel/line-framing.test.ts`
- modify `src/plugins/sessions/main/relay/endpoint.ts` (remove `channelPath` and its helpers)
- modify `src/plugins/sessions/main/relay/endpoint.test.ts` (remove the `channelPath` block; it moves)
- modify `src/plugins/sessions/main/relay/relay-server.ts`
- modify `src/plugins/sessions/main/relay/relay-server.test.ts` (import `channelPath` from its new place)
- modify `src/plugins/sessions/main/start.ts` (import `channelPath` from its new place, pass `''`)
- modify `scripts/check-layers.mts`

Consumes: nothing from this plan. `Log` in `src/contracts/log.ts` (in the tree).

## Produces

`src/shared/local-channel/channel-path.ts`:

```ts
export function channelPath(
  platform: NodeJS.Platform,
  home: string,
  username: string,
  instanceId: string,
  suffix: string,
  tempDir: string = os.tmpdir(),
): string
```

`src/shared/local-channel/local-channel.ts`:

```ts
export interface ChannelHandlers {
  connected(socket: Socket): void;
  failed(error: Error): void;
}
export interface ChannelServer {
  listening: Promise<boolean>;   // true once listening; false when listen failed (after `failed`)
  close(): Promise<void>;        // destroys every open socket, then closes the server
}
export function listenOnChannel(channel: string, handlers: ChannelHandlers): ChannelServer
export function connectToChannel(channel: string): Promise<Socket>  // rejects with the connect error
```

`src/shared/local-channel/line-framing.ts`:

```ts
export function readFirstLine(socket: Socket, received: (line: string) => void): void
export interface ReadLinesOptions {
  flushPartialAtEnd: boolean;   // true: a partial last line at the stream's end is delivered when not empty
}
export function readLines(
  stream: Readable,
  received: (line: string) => void,
  options: ReadLinesOptions = { flushPartialAtEnd: false },
): void
export function jsonLine(value: unknown): string
```

`Socket` is `node:net`'s; `Readable` is `node:stream`'s.

## Decisions

- **The relay's channel paths do not change** (behaviour unchanged). The relay passes `suffix` `''`, and the paths
  are byte-identical to today's. The suffix goes in four places:
  - Windows pipe: `\\.\pipe\<instanceId>-<username>-<homeHash><suffix>`
  - socket: `<home>/.agents/<instanceId>/app<suffix>.sock`
  - temp fallback: `<tempDir>/<instanceId>-<username>-<homeHash><suffix>.sock`
  - private fallback: `/tmp/<instanceId>-<username>/<homeHash><suffix>.sock`
  The 103-byte rule, the private folder check and its error text move unchanged. Task 07 passes
  `-session-host-v<SESSION_HOST_PROTOCOL>`.
- `listenOnChannel` holds what `startRelayServer` does today around the server: on a path that does not start with
  `\\.\pipe\`, it makes the socket's folder (`recursive`) and removes a stale socket file before `listen`. It tracks
  each socket and destroys the open ones in `close`. A server `error` calls `handlers.failed`. `listening` never
  rejects.
- **A live channel is never taken.** Today `startRelayServer` removes the socket file without a check, so a second
  listener deletes a live listener's socket. `listenOnChannel` removes the file only when it is stale: before the
  removal it calls `connectToChannel(channel)`. When that connect succeeds, it destroys that socket, removes
  nothing, calls `handlers.failed` with an `Error` whose `code` is `'EADDRINUSE'` and whose message is
  `channel <channel> is in use`, and `listening` resolves false. When the connect rejects, it removes the file and
  listens. A named pipe needs no check: `listen` on a pipe that is in use fails with `EADDRINUSE` itself. For the
  relay this changes nothing in practice: `main.ts` takes `app.requestSingleInstanceLock()`, so no second listener
  of the relay channel runs. Two listeners that both find a stale file in the same moment can still race; that
  window is the time between one removal and one `listen`, and it is accepted.
- `readLines`, `readFirstLine` and `listenOnChannel` add no `error` listener to a socket or stream they are given.
  The owner of the socket or stream adds one (the relay keeps its own; tasks 06 and 07 add theirs). `listenOnChannel`
  adds one to the server only.
- `readFirstLine` is today's `acceptConnection` reading: it collects bytes up to the first `\n`, pauses the socket,
  stops listening for data, puts the bytes after the newline back (`unshift`), then calls `received` with the line
  as UTF-8. The relay keeps its connection error log, its hello parsing, its refusals and `startSession`.
- `readLines` calls `received` once per `\n`-ended line, as UTF-8 without the newline, in order. It holds a partial
  line until its newline comes. When the stream ends (`end`), it drops a partial line by default; with
  `flushPartialAtEnd: true` it delivers a partial line that is not empty, once. Task 06 sets the option for a child
  process's stdout and stderr, where the last line may have no newline. Sockets use the default: a partial message
  at a socket's end is cut. A line split across chunks, and a multi-byte character split across chunks, come out
  whole.
- `jsonLine(value)` is `` `${JSON.stringify(value)}\n` ``. The relay's `replyLine` uses it.
- `relay-server.ts` keeps `startRelayServer(deps: RelayServerDeps): { close(): Promise<void> }` with the same
  signature and behaviour. It calls `listenOnChannel` with `connected` = today's accept path and `failed` = today's
  log line `channel <channel> failed: <message>` under source `relay`. It ignores `listening`.
- `scripts/check-layers.mts` gains, each with a one-line comment:
  - `'src/shared/local-channel': { layers: ['src/contracts'], packages: ['node:'] }`
  - `'src/main/session-host': { layers: ['src/contracts', 'src/shared', 'src/shared/local-channel'], packages: ['node:'] }`
    (for task 07, so 07 and 06 do not both edit this file in wave 2)
  - `'src/shared/local-channel'` added to the `layers` of `'src/plugins/sessions/main/relay'` and
    `'src/plugins/sessions/main'`
  - `'src/main/session-host'` added to the `layers` of `'src/main/main.ts'` (for task 08)
- `src/shared/local-channel/` imports no `electron` and nothing from `src/plugins`.

## Behaviour

GIVEN suffix `''` WHEN `channelPath('darwin', '/Users/u', 'u', 'wigley-ai-gui', '')` runs THEN it returns
`/Users/u/.agents/wigley-ai-gui/app.sock`, the relay's path today.
GIVEN a server on a temp socket WHEN a client connects and writes `{"a":1}\n{"b"` then `:2}\n` THEN `readLines` gets
`{"a":1}` and `{"b":2}`.
GIVEN a stale socket file at the path WHEN `listenOnChannel` runs THEN `listening` resolves true.
GIVEN a live listener on the path WHEN `listenOnChannel` runs again THEN `listening` resolves false, `failed` gets
`EADDRINUSE`, and the first listener still accepts connections.

## Tests

- `src/shared/local-channel/channel-path.test.ts`: move every `channelPath` case from `endpoint.test.ts` unchanged
  but for the new `''` argument (the expected values stay the same). Add
  `channelPath_SuffixCases_AddsTheSuffixToEachForm` — a table over the four forms with suffix `-session-host-v1`:
  `\\.\pipe\wigley-ai-gui-ann-<8 hex>-session-host-v1`; `/Users/u/.agents/wigley-ai-gui/app-session-host-v1.sock`;
  the temp fallback `<tempDir>/wigley-ai-gui-u-<8 hex>-session-host-v1.sock`; the private fallback
  `/tmp/wigley-ai-gui-<user>/<8 hex>-session-host-v1.sock` (skipped on Windows, as the moved case is).
- `src/shared/local-channel/local-channel.test.ts` (real sockets in a `mkdtemp` folder under `os.tmpdir()`, cleaned in
  `afterEach`, as `relay-server.test.ts` does):
  - `listenOnChannel_StaleSocketFile_ListensAndAcceptsAConnection` — `listening` true; `connected` called once.
  - `connectToChannel_NoServer_Rejects` — rejects; the error `code` is `ENOENT` or `ECONNREFUSED`.
  - `close_OpenSocket_DestroysItAndResolves` — the client socket gets `close`.
  - `listenOnChannel_LiveListener_FailsWithoutTakingTheChannel` — a first server listens; a second
    `listenOnChannel` on the same path → `failed` once with `code` `'EADDRINUSE'`, `listening` false; a new client
    connect still reaches the first server's `connected`.
- `src/shared/local-channel/line-framing.test.ts`:
  - `readLines_ChunkCases_DeliversWholeLines` — table: one chunk with two lines; a line split across two chunks; a
    `é` split between its two bytes; a trailing partial line at end → dropped; `a\nb` then end with
    `flushPartialAtEnd: true` → `a`, `b`; `a\n` then end with `flushPartialAtEnd: true` → `a` only.
  - `readFirstLine_BytesAfterTheNewline_StayOnTheStream` — after `first\nrest`, `received('first')`; a later
    `data` listener reads `rest`.
  - `jsonLine_Object_IsOneLineWithNewline` — `jsonLine({ a: 1 })` is `'{"a":1}\n'`.
- The existing `relay-server.test.ts` cases pass unchanged but for the import and the `''` suffix. A call that passes
  `tempDir` as the fifth argument today (`relay-server.test.ts` line 71, the moved `endpoint.test.ts` cases) passes
  `''` fifth and `tempDir` sixth: both are strings, so the compiler does not catch a missed one.

## Done when

`npm run typecheck`, `npm run lint` and `npm test` pass. `grep -rn "channelPath" src/plugins/sessions/main/relay/endpoint.ts`
finds nothing.

Commit: one commit for the group.

## Proof

