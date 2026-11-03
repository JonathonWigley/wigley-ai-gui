# 09 — Chat re-attaches and survives quit

Status: not started
Type: Task
Wave: 4 · Depends on: 08
Plan: [plan.md](plan.md)

Read first: `docs/features/session-host/design.md` (§ Re-attach, § Older hosts), `docs/features/agent-chat/design.md`
§ Saved sessions and the pending messages passage, `docs/keymap.md` § Adding a bind, `AGENTS.md` § Architecture (the
**A key** bullet and the self-test paragraph in § Running and testing).

Before you start, run `git status` and `ls -d docs/features/auto-compact/plan-* docs/features/session-clock/plan-*`.
A peer plan can have landed edits in `chat-sessions.ts` and `open-sessions.ts`. Read § Peer plans below first.

Files:
- modify `src/plugins/chat/main/chat-sessions.ts`
- modify `src/plugins/chat/main/open-sessions.ts`
- modify `src/plugins/chat/main/start.ts`
- modify `src/plugins/chat/main/selftest-script.ts`
- modify `src/plugins/chat/contract.ts` (the `stopAll` invoke)
- modify `src/plugins/chat/manifest.ts`
- modify `src/plugins/chat/page/chat-commands.ts`
- modify `src/plugins/keymap.ts`
- modify `src/plugins/sessions/contract.ts` (`SessionsMainExports.holdConnects`)
- modify `src/plugins/sessions/main/start.ts`
- modify `src/plugins/sessions/main/relay/relay-server.ts`
- create `src/plugins/sessions/main/relay/connect-hold.ts`
- test `src/plugins/chat/main/chat-sessions.test.ts`
- test `src/plugins/chat/main/open-sessions.test.ts`
- test `src/plugins/chat/main/start.test.ts`
- test `src/plugins/chat/page/chat-commands.test.ts`
- test `src/plugins/sessions/main/relay/relay-server.test.ts`
- test `src/plugins/sessions/main/relay/connect-hold.test.ts` (create)

Consumes:
- `AgentStart.processId: string` ← 01
- `AgentHarness.attach(request: AgentStart, events: AgentProcessEvents): Promise<AgentProcess | null>` ← 01, built in
  the Claude adapter and the fake harness by 08
- `AgentHarness.history(sessionId, projectDir, profileDir, before: number | null)` ← 01, 08
- `HostedProcessInfo { id, startedAt, running, current }` and `SessionHost` in `src/contracts/session-host.ts` ← 01
- `MainServices.sessionHost: SessionHost` ← 01, set in `src/main/main.ts` by 08
- `ChatAgentEvent.replayed: boolean` ← 01
- the fake session host in `src/shared/fake-session-host.ts` ← 01: tests set what `list()` returns and read the
  `setKeepIdleMinutes` calls
- the fake harness's `attach` ← 08: a test makes it fire events before its promise resolves, resolve null, or reject
- `Timers` in `src/contracts/ambient.ts` (already in the tree)

Produces:
- In `src/plugins/chat/main/open-sessions.ts`, on `interface SavedSession`:
  ```ts
  // The id of the row's last process start, which the session host knows it by; null when the row never started one.
  processId: string | null;
  // The row's queued messages not yet sent, oldest first, images included.
  queued: UserMessage[];
  // The `AgentStart.controls` the row's last process start passed; {} when the row never started one.
  launchControls: Record<string, string>;
  ```
- In `src/plugins/chat/main/chat-sessions.ts`:
  - `ChatSessionsDeps.sessionHost: Pick<SessionHost, 'list'>`
  - `ChatSessions.restore(saved: SavedSessions, hosted: readonly HostedProcessInfo[]): void`
  - `ChatSessions.stopAll(): void`
  - `ChatSessions.detachAll(): void` in place of `killAll()`, which is removed
- In `src/plugins/chat/contract.ts`, on `ChatChannel.invoke`: `stopAll(): void;`
- In `src/plugins/chat/manifest.ts`: the command `stopAll` and the setting `keepIdleMinutes`
- In `src/plugins/keymap.ts`: `{ keys: '<Leader>:', scope: 'any', command: 'chat.stopAll' }`
- In `src/plugins/sessions/contract.ts`, on `SessionsMainExports`: `holdConnects(until: Promise<unknown>): void;`
- In `src/plugins/sessions/main/relay/connect-hold.ts`:
  ```ts
  export const CONNECT_HOLD_MS = 5_000;
  export interface ConnectHold { hold(until: Promise<unknown>): void; ready(): Promise<void>; }
  export function createConnectHold(timers: Timers): ConnectHold;
  ```
- In `src/plugins/sessions/main/relay/relay-server.ts`: `RelayServerDeps.ready(): Promise<void>`

## Decisions

### Process id and the saved record

1. Each process start chooses its id as `` `${hostId}-${processStart}-${deps.clock.now()}` ``: the row's host session
   id, the row's start count after the increment (`session.processStarts`), and the epoch ms. Example:
   `uuid-1-1-1000`. The host's log folder then names the conversation. The id is unique: one row never starts two
   processes under one host id with one start count, and the time differs across relaunches. It calls no
   `randomUuid`, so the uuid sequence the existing tests assert does not move.
2. `HeldSession` gains `processId: string | null`. `openRow` sets it from its `opening` (a restored record's
   `processId`, else null). `startProcess` sets it before it calls `harness.start`, and passes it as
   `AgentStart.processId`. It is never cleared: after an exit the record still names the ended process, and the
   restore finds it not running.
3. `savedSessionOf` writes `processId`, `launchControls` and `queued`. `startProcess` keeps the `controls` it passes
   to `harness.start` on the `HeldSession` as `launchControls`, so an attach seeds the same controls the process was
   launched with: no stdout line reports effort, so `{}` would read the launched effort as null after a re-attach. `queued` holds each row of `state.queued` with
   `sentEntryId === null`, as `{ text, images }`, oldest first. A sent row is not saved: the agent already holds it,
   and the replay shows its user entry.
4. Images are saved. A queued message holds its images as base64 in memory (`ChatImage { mediaType, data }`, each at
   most `MAX_IMAGE_BASE64`, 5 MiB). Dropping them would lose part of a message, which the design forbids. The file
   grows only while a message with images waits in a queue, and that is short and rare.
5. Every change to a queue saves. `sendQueued` calls `save()` after it sends `queued`. The save stops at
   `detachAll`, so the last save before a quit holds the queue as it was.
6. `open-sessions.ts`: `StoredSession` makes `processId`, `launchControls` and `queued` optional, as it does
   `titles`. A missing `processId` reads as null; missing `launchControls` reads as `{}`; missing `queued` reads as
   `[]`. The check accepts `launchControls` an object whose values are all strings. The check accepts `processId` null or a string, and
   `queued` an array whose items each have a string `text` and an `images` array whose items each have a string
   `mediaType` and a string `data`. Any other value makes the file unreadable, as today.

### Restore

7. `start.ts` runs `Promise.all([saved.load(), services.sessionHost.list()])`, then calls
   `chat.restore(snapshot, hosted)`. A `list()` that rejects logs `session host not listed: <error>` and restores
   with `[]`, so every row rests (today's path). A `load()` that rejects keeps today's path: it logs, and restores
   `{ sessions: [], selectedHostSessionId: null }`.
8. `restore` stays synchronous. For each record it opens the row as today, then gives each saved queued message a row
   through `appendQueued` (new ids `queued-1`, `queued-2`, …), and sends `queued` once when it added any. Then it
   picks one path by the entry of `hosted` whose `id` equals `record.processId`:

   | Hosted entry | Profile | Path | Notices |
   |---|---|---|---|
   | `running`, `current` | in settings | attach (9) | none |
   | `running`, `current` | missing | rest; no attach (no profile folder to attach with) | missing profile |
   | `running`, not `current` | any | rest, older host (13) | older host; missing profile when missing |
   | not `running`, or none | any | rest (today) | quit during turn when `record.busy`; missing profile when missing |

   `restoreSavedUsage` runs for every row with `record.sent` and a profile, except an attached row: the replay emits
   its usage.
9. Attach. A function beside `startProcess` (name it `attachProcess`) does this:
   - It increments `processStarts`, clears `pendingPicks`, sets `processId` from the record, sets `historyBefore`
     (10) to the hosted entry's `startedAt`, sets `state.running = true` and sends `sessionRunning`.
   - It calls `harness.attach` with `{ sessionId: hostId, resume: record.sent, projectDir, profileDir, controls: record.launchControls,
     instructions: <the current registrations>, processId }` and the row's `processEvents`, in replay mode (11).
   - It stores the promise as `HeldSession.attaching: Promise<void> | null` until it settles.
   - On a process, when the row is still live for this start: `session.process` is the process; `running` adds it;
     replay mode ends; it logs `session <rowId> re-attached to process <processId>`. Then, when `harnessActivity`
     is `idle`, it calls `writeNextQueued` once. Else the next live `idle` sends the oldest, as today.
   - On null or a rejection: it logs `session <rowId> not re-attached: process <processId> is not running` or
     `session <rowId> not re-attached: <error>`. The row rests as on an `ended` with no exit notice:
     `state.running = false`, `process = null`, `showRestingIdle`, `sessionRested` with `error: null`. It adds the
     quit-during-turn notice when `record.busy`.
   - An `ended` that fires during the replay takes today's `ended` path. A process that resolves after it is not
     held: the row is no longer live for that start.
10. History. `HeldSession` gains `historyBefore: number | null`, null for every row that did not attach.
    `prependHistory` passes it to `harness.history` as `before`. `resume` passes null. `clear` sets it to null. The
    row then shows the transcript up to its process's start, then the replayed entries, and no entry shows twice.
11. Replay mode. `processEvents` takes a holder `{ isReplaying: boolean }`. It is true from the `attach` call until the
    promise settles, and false for every `start`. While it is true:
    - `entry`, `controls` and `commands` act as live.
    - `activity` sets `harnessActivity` and the shown activity and sends `activity`. It does not call
      `writeNextQueued`, announces no turn finished, and does not mark the row.
    - `agentEvent` emits with `replayed: true` and tracks background work. It does not read the branch.
    - `planUsage` emits nothing: its rows are old.
    - `messageDropped` does nothing.
    - `ended` acts as live.
    Every event outside replay mode emits `agentEvent` with `replayed: false`. `emitSavedUsage` emits
    `replayed: false`.
12. A send or `sendAllNow` to a row whose `attaching` is set awaits it first, then goes on as today. A message sent
    while the attach runs is never written to a process that is not yet held.
13. Older host. `HeldSession` gains `olderHostProcessId: string | null`. The row rests with the info notice
    `This session is finishing its turn in the previous app version. Send a message once it ends.`
    - While `olderHostProcessId` is set, `loadHistory` reads nothing and the history stays pending, so the read
      happens once the old process has written its last transcript lines.
    - Chat learns that the process ended on each send attempt. There is no poll. `writeAtIdle` on such a row calls
      `deps.sessionHost.list()` before it starts a process:
      - when the list still shows that id `running`, the send rejects with
        `This session is still finishing in the previous app version. Send again once it ends.` The page then toasts
        `Message not sent: This session is still finishing in the previous app version. Send again once it ends.`
        and puts the message back in the box (today's refusal path).
      - when the list does not show it running, chat sets `olderHostProcessId` to null and goes on as today: it
        reads the pending history, then starts the process with `--resume`.
      - when `list()` rejects, the send rejects with that error and logs `session host not listed: <error>`.
    - At restore chat logs `session <rowId> waits on process <processId> in the previous app version`.
14. The quit-during-turn notice (`QUIT_DURING_TURN_TEXT`, text unchanged) shows only when `record.busy` and no process
    stays: the hosted entry is missing or not running (8), or the attach found none (9).

### Quit and stop all

15. Rename `killAll` to `detachAll`, and `isKilled` to `isDetached`. `detachAll` kills no process. It sets
    `isDetached`. Then chat saves nothing, starts nothing and restores nothing, as `isKilled` did. `isLive` returns
    false once `isDetached` is set, so every later event of every process is ignored, `sessionEnded` included. This
    holds when the host client's connection closes at quit and its processes report closed. `closed` after
    `detachAll` ends no process. Update every caller and comment: `start.ts` `dispose` (it calls
    `chat.detachAll()`), the `ChatSessions` doc comments of `resume`, `send`, `clear` and `killAll`, and the tests
    (Tests below). The log copy `chat is stopping` stays.
16. `stopAll()` calls `process.kill()` on each process in `running`, a closed row's still ending included. Before that
    it sets `HeldSession.isStopRequested` on each held row whose process it kills. It logs
    `stopped <n> session process(es)`. A row whose attach is still running is not stopped, and chat logs
    `session <rowId> still attaching; not stopped`. Processes chat never attached (older host, missing profile) are
    not stopped.
17. `ended` on a row with `isStopRequested` adds the info notice
    `Session stopped. Your next message resumes this session.` in place of the exit notice. The rest of `ended` is
    unchanged: queued and written messages go back to the box, and the row rests. `startProcess` clears the flag.
18. `chat.stopAll` is a page command, because a key fires only a page command (`AGENTS.md` § A key):
    - manifest: `stopAll: { label: "stop every session's process", group: 'sessions', runsIn: 'page' }`.
    - keymap: `{ keys: '<Leader>:', scope: 'any', command: 'chat.stopAll' }`, after the `<Leader>;` bind. No `groups`
      entry: `docs/keymap.md` lists `:` as `none: close all`.
    - page handler in `chatCommandHandlers` (`chat-commands.ts`): it logs `stopping every session`, then calls
      `channel.invoke('stopAll')`. A rejection logs `sessions not stopped: <error>` and toasts
      `Sessions not stopped: <error>` with tone `error`.
    - main: `api.channel.handle('stopAll', () => chat.stopAll())`.
    - self-test: a new last group in `GROUPS`, `{ name: 'stop all', why: 'Space : stops every session process; the
      rows stay, resting.', steps: [{ keys: ['Escape', ' ', ':'], expect: '[chat] stopping every session' }] }`.

### Keep idle setting

19. Manifest `settings` gains `keepIdleMinutes: 60`. `settingInfo.keepIdleMinutes`:
    label `Keep idle sessions (minutes)`; description `How long a session whose turn has ended keeps its Claude
    process while the app is closed. Past it the process ends, and the next message resumes the session. The default,
    60, is the prompt cache's life.`
20. `start.ts` calls `services.sessionHost.setKeepIdleMinutes(Math.max(0, settings.keepIdleMinutes))` once at start
    with `api.settings()`, and in an `api.onSettingsChanged` listener on each change. `dispose` disposes the listener.

### Permission prompts after a relaunch

21. The relay says hello as soon as the relaunched app's channel accepts, and `relay-server.ts` calls `connect` at
    the hello. When chat has not yet opened that host id's row, `connect` opens an unowned row, and chat's restore
    then skips the record (`already open; not restored`). A wait inside chat's tool session cannot fix this: the call
    already belongs to the unowned row. So the hold sits at connect:
    - `createConnectHold(timers)`: `hold(until)` adds a promise. `ready()` resolves once every held promise has
      settled (resolved or rejected), or `CONNECT_HOLD_MS` (5 000) after the first `hold`, whichever is first. With no
      hold, `ready()` resolves at once. When the bound ends the wait, it logs
      `relay connects held past 5000 ms; connecting` (source `sessions`). 5 000 ms stays under the relay's 10 s wait
      for the hello reply (wigley-ai-marketplace `plugins/wigley/scripts/forms/README.md` § The relay, Hello).
    - `relay-server.ts` `startSession` awaits `deps.ready()` after it parses the hello and before it calls
      `deps.connect`. A socket that closed during the wait gets no connect.
    - `sessions/main/start.ts` builds one hold with `api.services.timers`, passes `ready` to `startRelayServer`, and
      exports `holdConnects: (until) => hold.hold(until)`. The drive action's `connect` and `exports.connect` are
      not held.
    - Chat's `start` calls `sessions.holdConnects(restored)` synchronously, where `restored` is the load, list and
      `restore` chain of decision 7. Chat starts in the same tick as sessions, so the hold is in place before any
      socket event runs. The hold ends when the rows are open, not when the attaches end.
22. A `permission_prompt` call on a row whose `attaching` is set awaits it, then runs today's checks. A row that rests
    after the wait answers cancelled, as today. The wait has no timer of its own: the attach settles when the host
    client answers (task 07).
    `permission-tool.ts` does not change.

## Peer plans

- **Row clock** (`docs/features/session-clock/plan-row-clock/02-chat-main-clock.md`) adds `activeMs` to
  `SavedSession`, an `activeMs` to `openRow`'s `opening`, and a `save()` in `killAll` before `isKilled` is set. When
  it lands first, `SavedSession` holds `activeMs`, `processId` and `queued` side by side, each optional in
  `StoredSession`. The save it put in `killAll` moves into `detachAll`, before `isDetached` is set. Replayed `activity`
  goes through the same path as live activity (decision 11), so the clock starts and stops as it would live. The
  replay takes almost no time, so the clock does not count the time the app was closed.
- **Auto-compact** (`docs/features/auto-compact/plan-auto-compact/05-chat-send-gate-and-hold.md`) adds
  `QueuedMessage.holdReason` and a send gate before the first write at idle. A saved queued message stays a
  `UserMessage` (`text`, `images`). `holdReason` is not saved, and a restored row gets `holdReason: null`. Restored
  rows are sent through `writeNextQueued`, so its rules apply to them. On a resting restored row that holds restored
  rows, the gate decides first, then decision 23 applies.
- When a decision here conflicts with landed code, report it as a concern. Do not guess (plan.md § Preconditions).

## Resting rows with saved queued messages

23. A row that rests after restore shows its saved queued messages as pending rows. Enter pulls one back as today.
    A send at idle in a row that holds unsent queued rows queues the new message behind them, starts the process when
    the row rests, and writes the oldest with `writeNextQueued`. So the restored messages run first, in the order the
    user sent them. The design names only the re-attached case; this rule keeps the order for the resting case.

GIVEN a running row WHEN chat saves THEN the record's `processId` is the start's id (`uuid-1-1-1000` for the first
start of host `uuid-1` at clock 1000) AND `queued` holds only the unsent rows, with their images.
GIVEN a record whose `processId` the host lists running and current WHEN chat restores THEN `harness.attach` gets that
`processId`, the replayed events reach the page, every `agentEvent` emitted before the attach resolves has
`replayed: true`, and no turn-finished alert fires.
GIVEN a re-attached row with two saved queued messages WHEN the replay ends with the turn running THEN both show as
pending rows AND the oldest is written at the next live `idle` AND the second at the `idle` after it.
GIVEN a record whose process the host lists running in an older host WHEN the user sends THEN the send rejects with the
pinned text and no process starts; WHEN the list later shows it ended THEN the next send reads the history and starts
the process with `resume: true`.
GIVEN the app quits WHEN chat's part is disposed THEN no process is killed and nothing is saved after it.
GIVEN two running rows WHEN the user presses `<Leader>:` THEN both processes are killed, both rows rest, and each shows
`Session stopped. Your next message resumes this session.`
GIVEN a relay that says hello before chat's restore has opened the rows WHEN the restore opens them within 5 000 ms THEN
the relay joins the owned row.

## Tests

`chat-sessions.test.ts` (the `record` helper gains `processId: null, queued: []`; `setUp` gains a fake session host,
from 01, as `sessionHost`):

- `startProcess_ProcessId_HostIdStartCountAndTime` — start a row (host `uuid-1`, clock 1000): the start request's
  `processId` is `uuid-1-1-1000`. The process exits and the user sends: the second request's `processId` is
  `uuid-1-2-1000`. The last saved record's `processId` is `uuid-1-2-1000`.
- `save_QueuedChange_SavesUnsentRowsWithImages` — while a turn runs, queue `a` (one image
  `{ mediaType: 'image/png', data: 'AAAA' }`) and `b`, then `sendNow` on `b`. The last saved record's `queued` is
  `[{ text: 'a', images: [{ mediaType: 'image/png', data: 'AAAA' }] }]`. The save count rises with each queue change.
- `restore_HostedProcess_PicksThePath` (`it.each`), each row with `record('host-a', { processId: 'p1', busy: true })`
  unless it says otherwise:

  | given | hosted | attach calls | entries (kind, tone, text) | row `running` |
  |---|---|---|---|---|
  | running, current | `[{ id: 'p1', startedAt: 5000, running: true, current: true }]` | 1, `processId: 'p1'` | none | true |
  | running, older | `[{ id: 'p1', startedAt: 5000, running: true, current: false }]` | 0 | info, the older host notice | false |
  | ended | `[{ id: 'p1', startedAt: 5000, running: false, current: true }]` | 0 | info, `QUIT_DURING_TURN_TEXT` | false |
  | not listed | `[]` | 0 | info, `QUIT_DURING_TURN_TEXT` | false |
  | running, current, profile `gone` | as the first row | 0 | error, names `gone` | false |

- `restore_RecordFlags_AddNotices` — its rows pass `hosted: []` and keep their assertions.
- `attach_ReplayedEvents_FlaggedNoAlertNoPlanUsage` — window unfocused. The fake's attach fires, before it resolves,
  an entry, `activity('working')`, `activity('idle')`, an `agentEvent` `turnEnded` and a `planUsage`. Then a live
  `activity('working')`, a live `agentEvent` and a live `activity('idle')`. Asserts: the entry was sent; the
  replayed `agentEvent` emits have `replayed: true`; the live one has `replayed: false`; no `planUsage` was emitted;
  `announced` has one alert, from the live idle.
- `attach_SavedQueued_WrittenOnceTheTurnEnds` (`it.each`): the replay ends `working` → no write at resolve, `a` at the
  next live `idle`, `b` at the `idle` after it; the replay ends `idle` → `a` is written at resolve.
- `attach_NullOrRejects_RestsWithQuitNotice` (`it.each`: resolves null; rejects `Error('host gone')`) — the row rests,
  `sessionRested` carries `error: null`, the entries hold `QUIT_DURING_TURN_TEXT`, and the log holds
  `[chat] session row-1 not re-attached: process p1 is not running` or `… not re-attached: host gone`.
- `loadHistory_PendingRow_PrependsOnce` — add a row: an attached row with `startedAt: 5000` reads history with
  `before` 5000; a resting row reads with `before` null.
- `send_WhileAttaching_WaitsForTheAttach` — a send before the attach resolves writes nothing; after it resolves, the
  message is written to the attached process.
- `send_OlderHostProcess_RefusedUntilItEnds` — the list shows `p1` running and older: the send rejects with
  `This session is still finishing in the previous app version. Send again once it ends.`, and the harness started no
  process. The list then shows `p1` not running: the send reads the history and starts the process with
  `resume: true`.
- `loadHistory_OlderHostRow_ReadsNothing` — the history is not read while `olderHostProcessId` is set.
- `send_RestingRowWithSavedQueued_WritesTheSavedFirst` — a resting restored row with saved `a`: a send of `c` starts
  the process, writes `a`, and queues `c` behind it.
- `stopAll_KillsEveryRunningProcess_RowsRestWithStoppedNotice` — two running rows: each fake process records one
  `kill`. After each `ended`, each row rests with the info notice `Session stopped. Your next message resumes this
  session.` The log holds `[chat] stopped 2 session process(es)`.
- Rename the `killAll` tests and rows: `killAll_KillsAHeldSessionsProcess`, `killAll_KillsAClosedSessionStillEnding`
  and `killAll_SkipsAnExitedProcess` become one test, `detachAll_KillsNoProcess`: no fake process records a kill.
  `killAll_ThenExits_SavesNothing` becomes `detachAll_ThenExits_SavesNothingAndSendsNothing`. The `it.each` rows
  `'a restore after killAll'` and `'killAll'` (about lines 2251, 2369, 2776, 3321) become `detachAll` rows with the
  same assertions.
- `permission_RowAttaching_WaitsThenAsks` — a `permission_prompt` call while the attach runs adds no entry. Once the
  attach resolves with a process, the call adds its waiting permission entry.

`open-sessions.test.ts`: add read rows — a stored session with no `processId` and no `queued` reads
`processId: null, queued: []`; one with a queued message holding an image reads it back unchanged; one with `queued`
holding `{ text: 1 }` rejects as unreadable.

`start.test.ts`:
- `keepIdleMinutes_StartAndChange_PassedToTheHost` — the fake session host records `[60]` at start, then `[60, 5]`
  after a settings change to 5.
- `restore_HoldsRelayConnectsUntilTheRowsOpen` — the fake sessions dependency records one `holdConnects` promise. It
  settles after `restore` ran.
- `restore_SessionHostListFails_LogsAndRestsEveryRow` — `list()` rejects with `Error('no host')`: the log holds
  `[chat] session host not listed: no host`, and the saved row opens resting.
- `dispose_SignInRunning_CancelsIt` — it also asserts that no fake process records a kill.
- `stopAll_Channel_StopsEveryProcess` — invoking `stopAll` on the channel kills the running process.

`chat-commands.test.ts`:
- `stopAll_InvokesMain` — the handler invokes `[['stopAll']]` and logs `stopping every session`.
- `stopAll_Rejects_ToastsError` — like `openPreview_Rejects_ToastsError`: the toast is
  `Sessions not stopped: host gone` with tone `error`.

`connect-hold.test.ts`: `ready_ResolvesWhenTheHoldsSettleOrTheBoundPasses` (`it.each` on fake timers): no hold →
resolves at 0 ms; one hold that resolves at 100 ms → at 100 ms; one hold that rejects at 100 ms → at 100 ms; one hold
that never settles → at 5 000 ms, and the log holds `[sessions] relay connects held past 5000 ms; connecting`.

`relay-server.test.ts`: `hello_WhileHeld_RepliesOnceReady` — with `ready` pending, a hello gets no reply and `connect`
is not called. After `ready` resolves, `connect` runs once and the reply is `{ ok: true }`.

Done when: `npm run typecheck` and `npm run lint` pass; the test gate runs the tests above and the whole files they
sit in; the self-test's `stop all` group is listed. The live checks are in task 12 (checks 1 to 5).
Commit:    one commit for the group: "chat: re-attach hosted sessions, keep them through quit, add stop all and the
           keep-idle setting".

## Proof

<written by wigley:make: commit sha, proof result, concerns; empty until the group lands>
