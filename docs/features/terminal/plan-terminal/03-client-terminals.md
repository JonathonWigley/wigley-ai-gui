# 03 — Client terminals

Status: in progress
Type: Task
Rung: deep · async across the link: replies, pushes racing an attach, reconnects and a host death
Wave: 2 · Depends on: 02
Plan: [plan.md](plan.md)

Files:     modify `src/main/session-host/session-host-client.ts` · modify `src/main/session-host/host-link.ts` ·
           test `src/main/session-host/session-host-client.test.ts`
Consumes:  `TerminalHost`, `TerminalSpawn`, `TerminalEvents`, `TerminalProcess`, `TerminalAttach`, `TerminalInfo`,
           `TerminalExit` in `src/contracts/terminals.ts` ← 02 ·
           `TermSpawnMessage`, `TermWriteMessage`, `TermResizeMessage`, `TermKillMessage`, `TermAttachMessage`,
           `TermAttachReply`, `TermDetachMessage`, `TermListMessage`, `TermListReply`, `TermDataEvent`,
           `TermClosedEvent` in `src/contracts/session-host-protocol.ts` ← 02
Produces:
- `src/main/session-host/session-host-client.ts`:
  ```ts
  // The session host client: the hosted processes, and the shells as `terminals`.
  export interface SessionHostClient extends SessionHost {
    readonly terminals: TerminalHost;
  }
  export function createSessionHostClient(deps: SessionHostClientDeps): SessionHostClient;
  ```
  `createSessionHostClient` (now :155-157) returns `SessionHost` today; after, it returns `SessionHostClient`. Task 06
  passes `sessionHost.terminals` into `MainServices.terminals` in `main.ts` (the client is built at main.ts:1696-1705).
  `createWindow`'s `sessionHost: SessionHost` parameter (main.ts:1116) stays as it is.
- `src/main/session-host/host-link.ts`: `HostLinkDeps` (now :37-43) gains
  ```ts
  terminalPushed(message: TermDataEvent | TermClosedEvent): void;
  // Runs in the same line read as the `termAttach` reply, before the reply settles its request.
  terminalAttachReceived(reply: TermAttachReply): void;
  ```

Decisions:
- **Link.** `createHostLink`'s `received` (now :58-79) hands a `termData` or `termClosed` line to
  `deps.terminalPushed`, before the reply lookup. A `termAttach` reply goes to `deps.terminalAttachReceived` first,
  then settles through `requestId`. `termList` replies settle through `requestId` as every other reply does.
  `openHost` in the client (now :238-245) passes the client's `terminalPushed` and `terminalAttachReceived`; the
  other-hosts links get them too and never receive a terminal message.
- **Why a sync hook.** `readLines` (`src/shared/local-channel/line-framing.ts`) calls `received` for each line of a
  socket chunk in one synchronous loop. The settled reply resumes `attach` only in a later microtask. So the host's
  reply and the next `termData` or `termClosed` in the same chunk both reach the client before `attach` resumes.
  `terminalAttachReceived` marks the reply's place in the stream: a push before it is old, and a push after it is
  new.
- **State.** The client keeps a `Map<string, TerminalEntry>` beside `processes`. An entry holds the id, `ended`, and
  `subscriber: TerminalSubscriber | null`, the one live subscriber. A `TerminalSubscriber` is made per `spawn` and per
  `attach`, as the process client's `Subscriber` is (now :56-67). It holds `events`, `detached`,
  `attachRequestId: number | null` (the attach request that made it; null from `spawn`), `replied: boolean`, and
  `buffer: (TermDataEvent | TermClosedEvent)[] | null`. Every `TerminalProcess` of the id shares the entry, as
  `ProcessEntry` is shared.
- **Delivery.** Every delivery, live or from a flush, checks `entry.subscriber === subscriber` first and does nothing
  when it is false, as the process client's `deliver` does (now :93-120). So a buffer flushes only into the events
  that opened it.
- **spawn(request, events).** When the map holds a live entry for `request.id` (subscriber not null), it calls
  `events.closed` in a microtask with `{ code: null, signal: null, error: 'a terminal with id <id> already exists' }`
  and returns an ended process, as the process `spawn` does (now :553-572). Otherwise it sets a new subscriber on the entry and,
  through `whenConnected`, sends `{ type: 'termSpawn', request }`; when no host started it delivers `closed` with
  `error: 'the session host did not start: <reason>'` and drops the entry. A spawn's subscriber has `replied` true and
  `buffer` null, so its pushes flow live at once.
- **TerminalProcess.** `write(data)` sends `termWrite`, `resize(cols, rows)` sends `termResize`, `kill()` sends
  `termKill`, through `sendWhenConnected`, so each one queues behind the `termSpawn` in call order. `detach()` sends
  `termDetach` and clears the entry's subscriber when it is this process's. Every call sends nothing once the entry
  has ended (a `termClosed`, or the host died) or this process has detached, as the process client's
  `sendWhileActive` does (now :437-442). A call queued before the host died can still reach the next host; that host
  holds no such id and ignores it (task 02).
- **attach(id, events).** It makes a new subscriber with `replied` false and `buffer` null, and sets it as the
  entry's subscriber. A subscriber it replaces gets no more events; its open buffer, if any, is never flushed, since
  the new reply's replay holds that output. Then, through `whenConnected`, it sends `termAttach` with
  `link.request(…, HOST_REPLY_LIMIT_MS)`. The `build` callback stores the request id in `attachRequestId`.
  - Before the reply: a pushed `termData` or `termClosed` for the id is dropped while the subscriber has `replied`
    false. It comes from an earlier subscription of this connection, and the host's replay holds that output.
  - `terminalAttachReceived(reply)`: when the entry for `reply.id` has a subscriber whose `attachRequestId` is
    `reply.requestId`, and `reply.terminal` is not null, it sets `replied` true and opens `buffer` as `[]`. Every
    other reply is ignored here: it belongs to a subscriber that was replaced.
  - After the reply, before the flush: pushes for the id go into `buffer`, in order.
  - A reply with `terminal: null` drops the entry when it still holds this subscriber, and resolves null.
  - A reply with a terminal schedules `timers.set(flush, 0)` and resolves `{ process, replay }`. So live data starts
    in a later macrotask than the one that resolves, and a caller that writes `replay` in its `await` continuation
    writes it before any live chunk, as the process `attach` promises (contracts/session-host.ts:123-124). The flush
    sets `buffer` null and delivers what it held, in order; then pushes flow live. A buffered `termClosed` ends the
    entry in its place in that order.
  - No reply (the limit ran out, or the link closed) sends `termDetach` when the entry still holds these events,
    clears them, and rejects `the session host did not answer the attach of terminal <id>`.
  - No host started: rejects `the session host did not start: <reason>`.
- **list().** Through `whenConnected`, requests `termList` with `HOST_REPLY_LIMIT_MS` on the current host only (an
  older host's shells end at its drain, so `otherHosts` is not asked). Resolves `reply.terminals`. No reply rejects
  `the session host did not answer its terminal list`; no host rejects `the session host did not start: <reason>`.
- **Pushes.** `terminalPushed` finds the entry by `message.id`. With no entry or no subscriber it drops the message,
  with no throw: a `termClosed` after `detach` is one. With `replied` false it drops it. With `buffer` open it buffers
  it. Otherwise `termData` calls `events.data(message.data)`; `termClosed` ends the entry, removes it from the map,
  and calls `events.closed(message.exit)` once.
- **Host death.** `hostDied` (now :188-214) also ends every terminal entry and clears the map. Each entry with events
  whose subscriber has `replied` true gets `closed` with `{ code: null, signal: null, error: 'the session host exited' }`;
  behind a still-open buffer, the closed goes into the buffer, so it stays behind the buffered chunks. An entry whose
  subscriber has `replied` false is left to its request: the link's close settles it null, and `attach` rejects
  `the session host did not answer the attach of terminal <id>`. Its events get no `closed`.

Pinned values: errors `a terminal with id <id> already exists`, `the session host did not start: <reason>`,
`the session host did not answer the attach of terminal <id>`, `the session host did not answer its terminal list`,
`the session host exited` (the existing `hostDied` text) · reply limit `HOST_REPLY_LIMIT_MS` (host-link.ts:20).

GIVEN a spawned terminal WHEN write, resize, kill and detach run before the host answers THEN the host gets
`termSpawn`, `termWrite`, `termResize`, `termKill`, `termDetach` in that order, and nothing after the detach
GIVEN two terminals WHEN the host pushes `termData` and `termClosed` THEN each reaches only its own id's events
GIVEN an attach WHEN the reply carries a replay THEN the promise resolves with it, and a chunk pushed right after the
reply arrives only after a 0 ms timer
GIVEN an attach WHEN the host writes the reply and a `termData` in one socket chunk THEN the chunk is kept, not
dropped
GIVEN an attach whose reply has come and whose flush is ahead WHEN a second attach or a detach runs THEN the first
events get nothing from the buffer
GIVEN a live terminal WHEN the host's connection drops THEN its events get `closed` with `the session host exited`
GIVEN an attach with its flush ahead WHEN the host's connection drops THEN `closed` comes after the buffered chunks
GIVEN an attach with no reply yet WHEN the host's connection drops THEN `attach` rejects and the events get no
`closed`
GIVEN no host WHEN `list` or `attach` runs THEN it rejects `the session host did not start: <reason>`
GIVEN a terminal that got `termClosed` WHEN its process writes THEN the host gets nothing
GIVEN a detached terminal WHEN the host pushes its `termClosed` THEN nothing throws and no events run

Tests (all in `src/main/session-host/session-host-client.test.ts`, `describe('createSessionHostClient')`):
- The scripted host (`startScriptedHost`, now :143-214) gains `terminals?: TerminalInfo[]` (what `termList` answers),
  `termListAnswered?: boolean`, and `termAttached?(message: TermAttachMessage, host: ScriptedHost): void`.
  `ScriptedHost` (now :140-145) gains `pushTogether(messages: HostMessage[]): void`, which writes every message's
  line in one `socket.write`, so the client reads them in one chunk. Add a `recordedTerminalEvents()` helper beside
  `recordedEvents` (now :259-276) that records `data` chunks and `closed` exits, and `calls`, one string per call in
  order (`data:<chunk>`, `closed:<error>`).
- `it('terminal_Messages_ReachTheHostInCallOrderUntilDetached')` — spawn `a`, then `write('ls')`, `resize(90, 20)`,
  `kill()`, `detach()`, `write('x')` → the host's `term*` messages are exactly `termSpawn`, `termWrite` `ls`,
  `termResize` 90×20, `termKill`, `termDetach`.
- `it('terminal_Pushes_RouteByIdToTheLiveEvents')` — spawn `a` and `b`; push `termData` a `x`, `termData` b `y`,
  `termClosed` a `{ code: 0, signal: null, error: null }`, then `termData` a `z` → a data `['x']`, a closed once;
  b data `['y']`, b closed `[]`. Then the process of `a` runs `write('late')` → the host got no `termWrite` for `a`.
  Then `detach()` on `b`, and the host pushes `termClosed` b → b closed stays `[]`, and nothing throws.
- `it.each` `'terminalAttach_Cases: $name'` — rows:
  - `replay` — the host replies `{ replay: 'abc', running: true }`, then pushes `termData` `d` → resolves
    `replay` `'abc'`; data `[]` until `timers.fire(0)`, then `['d']`.
  - `same chunk` — the host's `termAttached` runs `pushTogether` with the reply `{ replay: 'abc', running: true }` and
    then `termData` `d` → resolves `replay` `'abc'`; data `[]` until `timers.fire(0)`, then `['d']`. Dropping every
    push until `attach` resumes fails this row.
  - `unknown` — the host replies `terminal: null` → resolves null.
  - `no reply` — no answer, `timers.fire(REPLY_LIMIT_MS)` → rejects matching
    `/did not answer the attach of terminal a/`; the host got a `termDetach` for `a`.
- `it('terminalAttach_PushesBeforeTheReply_AreDropped')` — the host's `termAttached` runs `pushTogether` with
  `termData` `old` for `a`, then the reply with replay `old` → data stays `[]` after `timers.fire(0)`.
- `it.each` `'terminalAttach_BeforeTheFlush_FirstEventsGetNothing: $name'` — the host answers each `termAttach` with
  `pushTogether` of the reply `{ replay: 'r', running: true }` and `termData` `d`. Attach `a` with events 1 and await
  it; no `timers.fire(0)` yet. Rows:
  - `second attach` — attach `a` with events 2 and await it; `timers.fire(0)` → events 1 data `[]`; events 2 data
    `['d']`.
  - `detach` — the first attach's process runs `detach()`; `timers.fire(0)` → events 1 data `[]`; the host got one
    `termDetach` for `a`.
- `it('terminalSpawn_LiveEntryUnderThatId_ClosesTheNewEvents')` — a second spawn of `a` → its events closed once
  with `a terminal with id a already exists`; the host got one `termSpawn`.
- `it.each` `'terminalList_Cases: $name'` — `answered`: `terminals` `[{ id: 'a', startedAt: 7, running: true }]` →
  resolves that list; `silent`: `termListAnswered: false`, `timers.fire(REPLY_LIMIT_MS)` → rejects matching
  `/did not answer its terminal list/`.
- a terminal added to `hostExits_OpenProcesses_CloseWithAnError` (now :1037) — a spawned terminal's `errors` become
  `[EXITED]` when the host stops.
- a terminal added to `hostExits_BeforeTheAttachFlush_ClosedFollowsTheBufferedLines` (now :1060) — the host answers
  the `termAttach` of `t` with `pushTogether` of the reply `{ replay: '', running: true }` and `termData` `d`; the
  host stops before `timers.fire(0)` → the terminal's `closed` stays `[]`; after `timers.fire(0)`, `calls` is
  `['data:d', 'closed:the session host exited']`.
- a terminal added to `hostExits_PendingCalls_ListAndAttachRejectAndStopAllResolves` (now :1086) — the host never
  answers a `termAttach` of `t`; the host stops → the attach rejects matching
  `/did not answer the attach of terminal t/`; the terminal's `closed` stays `[]`.
- a terminal added to `create_HostNeverAnswers_ClosesQueuedSpawnsWithTheReason` (now :588) — a terminal spawned
  before the start limit gets `closed` whose error starts with `the session host did not start:`; `terminals.list()`
  and `terminals.attach('t', …)` each reject matching `/did not start/`.

Done when: `npm run typecheck` passes; the tests above exist; the test gate runs them.
Commit: one commit — "Session host client: a TerminalHost over the same link, spawning, attaching with replay and
listing shells, routing their pushed output by id, and closing them when the host dies".

## Proof
