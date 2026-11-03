# 01 — Session host contracts

Status: not started
Type: Batch
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:
- create `src/contracts/session-host.ts`
- create `src/contracts/session-host-protocol.ts`
- create `src/shared/fake-session-host.ts` · test `src/shared/fake-session-host.test.ts`
- modify `src/contracts/agent.ts`
- modify `src/contracts/plugin.ts`
- modify `src/plugins/chat/contract.ts`
- modify (compile stubs only) `src/shared/fake-agent-harness.ts`, `src/main/claude-code/claude-code-harness.ts`,
  `src/main/main.ts`, `src/plugins/chat/main/chat-sessions.ts`, `src/plugins/chat/main/preview/chat-preview.ts`
- modify (fixtures only) `src/shared/fake-agent-harness.test.ts`, `src/main/claude-code/claude-code-harness.test.ts`,
  `src/plugins/chat/main/chat-sessions.test.ts`, and each other test file `npm run typecheck` names after the
  contract change (a typed `ChatAgentEvent` or `AgentStart` literal)

Consumes: `Clock` in `src/contracts/ambient.ts` (in the tree).

## Produces

`src/contracts/session-host.ts`: exactly the block in plan.md § File Structure (`PipeDirection`, `PipeLine`,
`IdleRule`, `HostedSpawn`, `HostedExit`, `HostedProcessEvents`, `HostedProcess` with `detach(): void`,
`HostedProcessInfo`, `SessionHost`). Copy it with its comments. Do not change a name.

`src/contracts/session-host-protocol.ts`:

```ts
export const SESSION_HOST_PROTOCOL = 1;

// Frozen: these keep their shape in every protocol version.
export interface HelloMessage { type: 'hello'; requestId: number; }
export interface HelloReply { type: 'hello'; requestId: number; protocol: number; }
export interface ListMessage { type: 'list'; requestId: number; }
export interface ListedProcess {
  id: string; startedAt: number; running: boolean;
  code: number | null; signal: string | null;
  log: string;               // the pipe log's absolute path
}
export interface ListReply { type: 'list'; requestId: number; processes: ListedProcess[]; }
export interface DrainMessage { type: 'drain'; }
export interface PipeLogRecord { seq: number; dir: PipeDirection; at: number; text: string; }
// The file `host-v<protocol>.json` in the host folder, written by the host once it listens.
export interface SessionHostRecord { protocol: number; channel: string; pid: number; }

// Versioned: these may change with SESSION_HOST_PROTOCOL.
export interface SpawnMessage { type: 'spawn'; request: HostedSpawn; }
export interface WriteMessage { type: 'write'; id: string; text: string; }
export interface EndInputMessage { type: 'endInput'; id: string; }
export interface KillMessage { type: 'kill'; id: string; signal: 'SIGTERM' | 'SIGKILL'; }
export interface SubscribeMessage { type: 'subscribe'; requestId: number; id: string; }
export interface SubscribeReply { type: 'subscribe'; requestId: number; id: string; running: boolean; log: string | null; }
export interface UnsubscribeMessage { type: 'unsubscribe'; id: string; }
export interface SetKeepIdleMessage { type: 'setKeepIdle'; minutes: number; }
export interface StopAllMessage { type: 'stopAll'; requestId: number; }
export interface StopAllReply { type: 'stopAll'; requestId: number; }
export interface LineEvent { type: 'line'; id: string; line: PipeLine; }
export interface ClosedEvent { type: 'closed'; id: string; exit: HostedExit; }

export type ClientMessage = HelloMessage | ListMessage | DrainMessage | SpawnMessage | WriteMessage
  | EndInputMessage | KillMessage | SubscribeMessage | UnsubscribeMessage | SetKeepIdleMessage | StopAllMessage;
export type HostMessage = HelloReply | ListReply | SubscribeReply | StopAllReply | LineEvent | ClosedEvent;
```

Each type gets a doc comment that says what it means. The doc comments of `HelloMessage`, `HelloReply`,
`ListMessage`, `ListedProcess`, `ListReply`, `DrainMessage`, `PipeLogRecord` and `SessionHostRecord` say "Frozen:
never change this shape". Task 06 owns what the host does with each message; the comments say only what the message
carries.

`src/contracts/agent.ts`:
- `AgentStart` gains `processId: string` (the hosted process id chat chooses for this start). Add it to the
  doc comment above `AgentStart`.
- `AgentProcess` gains `detach(): void;` with the doc comment from plan.md § File Structure: it stops this process
  object's events and timers and leaves the hosted process running; chat calls it on quit and on a chat plugin stop,
  in place of `kill`.
- `AgentHarness` gains
  `attach(request: AgentStart, events: AgentProcessEvents): Promise<AgentProcess | null>;` with the doc comment from
  plan.md § File Structure.
- `AgentHarness.history` becomes
  `history(sessionId: string, projectDir: string, profileDir: string | null, before: number | null): Promise<ChatEntry[]>;`
  Its comment adds: "`before`: only entries the transcript recorded before that epoch ms; null reads them all."

`src/contracts/plugin.ts`: `MainServices` gains `sessionHost: SessionHost;`. The comment above `MainServices` gains
one sentence: "`sessionHost` owns every agent process, so a process outlives the app
(`docs/features/session-host/design.md`)."

`src/plugins/chat/contract.ts`: `ChatAgentEvent` gains `replayed: boolean;`. Its comment adds: "`replayed` is true
for an event a re-attach replayed from a pipe log; a listener that appends or alerts skips it."

`src/shared/fake-session-host.ts`:

```ts
export interface FakeHostedProcessRecord {
  request: HostedSpawn | null;      // null for a process added with addRunning
  id: string;
  startedAt: number;
  current: boolean;
  events: HostedProcessEvents | null; // the latest spawn or attach events; null until attached
  log: PipeLine[];                    // every line, `in` included, in seq order
  writes: string[];
  inputEnded: boolean;
  kills: ('SIGTERM' | 'SIGKILL')[];
  detaches: number;                   // detach calls on any HostedProcess of this record
  closed: HostedExit | null;
}
export interface FakeSessionHost extends SessionHost {
  readonly processes: readonly FakeHostedProcessRecord[];
  readonly keepIdleMinutes: readonly number[];
  readonly stopAllCalls: number;
  addRunning(process: { id: string; startedAt: number; current: boolean; log: readonly PipeLine[] }): FakeHostedProcessRecord;
  output(id: string, dir: 'out' | 'err', text: string): PipeLine;
  close(id: string, exit: HostedExit): void;
  failNextSpawn(error: string): void;
  // What `list()` resolves from now on; null goes back to listing the records.
  setList(infos: readonly HostedProcessInfo[] | null): void;
}
export function createFakeSessionHost(clock: Clock): FakeSessionHost;
```

## Decisions

- **The tree compiles and every existing test passes after 01** (decided for this plan). 01 adds the members and
  changes each existing site that the compiler or a test names. Later tasks replace the stubs:
  - `createClaudeCodeHarness` and `createFakeAgentHarness` gain
    `attach: () => Promise.reject(new Error('attach is not implemented until task 08'))`. Each `AgentProcess`
    they return gains `detach() { throw new Error('detach is not implemented until task 08'); }`. Task 08 replaces
    all four. A test literal that builds a whole `AgentProcess` gains the same stub.
    Their `history` stays with 3 parameters (TypeScript accepts it); task 08 adds `before`.
  - `chat-sessions.ts` `startProcess` passes `processId: \`${session.hostId}:${session.processStarts}\``. This value
    uses no `randomUuid` call, so no test's uuid sequence moves. Task 09 owns the real rule and may replace it.
  - `chat-sessions.ts` `readHistory` passes `null` as `before`.
  - Every `ChatAgentEvent` emitter in the tree sets `replayed: false`: `chat-sessions.ts` `processEvents` (its
    `agentEvent` handler) and `emitSavedUsage`, and `chat-preview.ts`. `grep -rn "emit('agentEvent'" src` finds no
    other. Task 09 sets `true` for replayed events.
  - `main.ts` passes `sessionHost: unwiredSessionHost` in the services it hands `startMainParts`. `unwiredSessionHost`
    is a module const in `main.ts`: `spawn` throws `Error('no session host is wired yet')`; `attach` resolves null;
    `list` resolves `[]`; `setKeepIdleMinutes` does nothing; `stopAll` resolves. Task 08 deletes it.
  - Test fixtures: each typed `AgentStart` const gains `processId: 'p-1'`. Each `toEqual` on a chat start request
    (`chat-sessions.test.ts`, the assertions that list whole requests) gains the interim `processId` value. Each
    `harness.history(…)` call in a test gains `, null`. Each typed `ChatAgentEvent` literal or expectation gains
    `replayed: false`.
- **The fake host is synchronous where the test drives it.** `output` and `close` call the record's events at once.
  `spawn` and `attach` call nothing during the call.
- Fake behaviour, pinned:
  - `spawn(request, events)` adds a record with `id = request.id`, `startedAt = clock.now()`, `current = true`, and
    returns a `HostedProcess`. After `failNextSpawn(error)`, the next `spawn` still returns a process and records it,
    then calls `events.closed({ code: null, signal: null, error })` in a later microtask (`queueMicrotask`).
  - `HostedProcess.write(text)` appends `text` to `writes` and an `in` line to `log`. `endInput` sets `inputEnded`.
    `kill(signal)` appends to `kills`. None of them closes the process. Each does nothing after `closed` is set.
    `detach()` adds 1 to `detaches` and sets `record.events = null` when this process object's events are still the
    record's; from then on this object's events get nothing. The process stays open.
  - `output(id, dir, text)` appends a line with the next seq (1 for the first line) and `at = clock.now()`, calls
    `events.line` with it, and returns it. It throws for an unknown or closed id.
  - `close(id, exit)` sets `closed` and calls `events.closed(exit)` once. A second call does nothing.
  - `attach(id, events)` resolves `{ process, log: [...record.log] }` and sets `record.events = events` for a record
    that is `current` and not closed, after a detach or not. A second attach replaces the live events: the old ones
    get nothing more. It resolves null for any other id.
  - `output` and `close` deliver to `record.events`; with `events` null they still log and close.
  - `list()` resolves the infos `setList` gave, when set. Otherwise one `HostedProcessInfo` per record that is not
    closed, in record order: `{ id, startedAt, running: true, current }`.
  - `setKeepIdleMinutes(minutes)` appends to `keepIdleMinutes`.
  - `stopAll()` adds 1 to `stopAllCalls`. For each current record that is not closed it appends `'SIGTERM'` to
    `kills` and calls `close(id, { code: null, signal: 'SIGTERM', error: null })`. Then it resolves.
- `session-host-protocol.ts` imports `PipeDirection`, `PipeLine`, `HostedSpawn` and `HostedExit` from
  `./session-host`. `src/contracts` imports nothing outside itself.

## Behaviour

GIVEN a fake host WHEN a test spawns `a`, the process writes `hi`, and the test outputs `out` `ok` THEN `log` holds
`in` seq 1 `hi` and `out` seq 2 `ok`, and the events got only the `out` line.
GIVEN a record added with `addRunning({ current: false, … })` WHEN `attach` runs for its id THEN it resolves null.
GIVEN `failNextSpawn('boom')` WHEN `spawn` runs THEN `closed` is not called inside `spawn`, and then fires once with
`{ code: null, signal: null, error: 'boom' }`.

## Tests

`src/shared/fake-session-host.test.ts` (style of `src/shared/fake-agent-harness.test.ts`, clock `{ now: () => 1000 }`):
- `spawn_WriteThenOutput_LogsBothDirectionsAndEchoesOnlyOut` — log equals
  `[{ seq: 1, dir: 'in', at: 1000, text: 'hi' }, { seq: 2, dir: 'out', at: 1000, text: 'ok' }]`; events got one line,
  seq 2.
- `attach_Cases_ResolvesByRecordState` — table: running current → `{ log }` with the added lines; running not
  current → null; closed → null; unknown id → null.
- `list_OpenRecords_ListsEachWithCurrentFlag` — two running (one current false) and one closed → two infos, closed
  left out.
- `failNextSpawn_ClosesInALaterMicrotask` — no `closed` inside `spawn`; after `await Promise.resolve()`, one
  `closed` with error `boom`.
- `stopAll_ClosesEveryRunningCurrentProcessWithSigterm` — `kills` `['SIGTERM']`, `closed`
  `{ code: null, signal: 'SIGTERM', error: null }`, `stopAllCalls` 1; a record with `current: false` stays open.
- `close_Twice_FiresClosedOnce`.
- `detach_ThenOutput_DeliversNothingAndCountsTheDetach` — `detaches` 1; the old events got no line; the log holds
  it; `list()` still lists the process.
- `attach_Twice_OnlyTheLatestEventsGetLines` — the first events get nothing after the second attach.
- `setList_Infos_ListResolvesThem` — then `setList(null)` lists the records again.

## Done when

`npm run typecheck`, `npm run lint` and `npm test` pass. `grep -n "attach is not implemented until task 08"` finds
`src/shared/fake-agent-harness.ts` and `src/main/claude-code/claude-code-harness.ts`. `grep -n "unwiredSessionHost"`
finds `src/main/main.ts`.

Commit: one commit for the group.

## Proof

