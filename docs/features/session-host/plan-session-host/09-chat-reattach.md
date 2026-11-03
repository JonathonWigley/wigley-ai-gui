# 09 — Chat re-attaches and survives quit

Status: done
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
- the fake harness's `attach` ← 08: a test makes it fire events before its promise resolves, resolve null, or reject,
  through `scriptAttach(processId, script: FakeAttachScript)`; a `process` script's `turns` seeds the fake process's
  turn counter; `attachCalls` lists each request
- `Timers` in `src/contracts/ambient.ts`, `Log` in `src/contracts/log.ts`, `MainServices.timers` (already in the tree)
- `AgentProcess.detach()` ← 01, built by 08: after it, `end()` resolves at once and `kill()` does nothing
- the fake harness's `lastUsageCalls` (already in the tree)

Produces:
- In `src/plugins/chat/main/open-sessions.ts`, on `interface SavedSession`:
  ```ts
  // The id of the row's last process start, which the session host knows it by; null when the row never started one.
  processId: string | null;
  // The row's queued messages not yet sent, oldest first, images included.
  queued: UserMessage[];
  // The `AgentStart.controls` the row's last process start passed; {} when the row never started one.
  launchControls: Record<string, string>;
  // The `AgentStart.resume` the row's last process start passed; false when the row never started one.
  launchResume: boolean;
  ```
- In `src/plugins/chat/main/chat-sessions.ts`:
  - `ChatSessionsDeps.sessionHost: Pick<SessionHost, 'list'>`
  - `ChatSessions.restore(saved: SavedSessions, hosted: readonly HostedProcessInfo[] | null): void` (null: the host
    list is unknown, decision 7)
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
  export function createConnectHold(timers: Timers, log: Log): ConnectHold;
  ```
- In `src/plugins/sessions/main/relay/relay-server.ts`: `RelayServerDeps.ready(): Promise<void>`

## Decisions

### Process id and the saved record

1. Each process start chooses its id as `` `${hostId}-${processStart}-${deps.clock.now()}` ``: the row's host session
   id, the row's start count after the increment (`session.processStarts`), and the epoch ms. Example:
   `uuid-1-1-1000`. The host's log folder then names the conversation. The id is unique: one row never starts two
   processes under one host id with one start count, and the time differs across relaunches. It calls no
   `randomUuid`, so the uuid sequence the existing tests assert does not move.
2. `HeldSession` gains `processId: string | null`, `launchControls: Record<string, string>` and
   `launchResume: boolean`. `openRow` sets all three from its `opening` (a restored record's `processId`,
   `launchControls` and `launchResume`, else null, `{}` and false). `startProcess` sets it before it calls `harness.start`, and passes it as
   `AgentStart.processId`. It is never cleared: after an exit the record still names the ended process, and the
   restore finds it not running.
3. `savedSessionOf` writes `processId`, `launchControls`, `launchResume` and `queued`. `startProcess` keeps the
   `controls` it passes to `harness.start` on the `HeldSession` as `launchControls`, so an attach seeds the same
   controls the process was launched with: no stdout line reports effort, so `{}` would read the launched effort as
   null after a re-attach. `startProcess` also keeps its `resume` argument as `launchResume`. Reason: 05's fold seeds
   the usage state from `request.resume` (08 § The usage seed), and `session.sent` is true after the first send of a
   process that was launched with `resume: false`. `queued` holds each row of `state.queued` with
   `sentEntryId === null`, as `{ text, images }`, oldest first. A sent row is not saved: the agent already holds it,
   and the replay shows its user entry.
4. Images are saved. A queued message holds its images as base64 in memory (`ChatImage { mediaType, data }`, each at
   most `MAX_IMAGE_BASE64`, 5 MiB). Dropping them would lose part of a message, which the design forbids. The file
   grows only while a message with images waits in a queue, and that is short and rare.
5. Every change to a queue saves. `sendQueued` calls `save()` after it sends `queued`. The save stops at
   `detachAll`, so the last save before a quit holds the queue as it was.
6. `open-sessions.ts`: `StoredSession` makes `processId`, `launchControls`, `launchResume` and `queued` optional, as
   it does `titles`. A missing `processId` reads as null; missing `launchControls` reads as `{}`; missing
   `launchResume` reads as false (a record without it also has no `processId`, so it never attaches); missing
   `queued` reads as `[]`. The check accepts `launchControls` an object whose values are all strings, and
   `launchResume` a boolean. The check accepts `processId` null or a string, and
   `queued` an array whose items each have a string `text` and an `images` array whose items each have a string
   `mediaType` and a string `data`. Any other value makes the file unreadable, as today.

### Restore

7. `start.ts` runs `Promise.all([saved.load(), <the bounded list>])`, then calls `chat.restore(snapshot, hosted)`.
   - The bounded list races `services.sessionHost.list()` against `SESSION_HOST_LIST_WAIT_MS = 3_000` (a module
     const in `start.ts`), on `services.timers`. When the list settles first, it clears the timer.
   - Reason for the bound: 07's `list()` waits on the connection, which takes up to 10 000 ms when the host must
     start, and then lists each older host. The relay hold ends at 5 000 ms (21). 3 000 ms keeps the load, list and
     restore chain under the hold, so a relay hello never opens an unowned row while chat waits on the host.
   - A `list()` that rejects logs `session host not listed: <error>`. The bound logs
     `session host not listed: timed out after 3000 ms`. In both cases `hosted` is null: chat does not know which
     processes run. Decision 8 gives each row with a `processId` the unheld guard (24), so no send starts a second
     process for a session whose process may still run.
   - A `load()` that rejects keeps today's path: it logs, and restores `{ sessions: [], selectedHostSessionId: null }`
     with the `hosted` it got.
8. `restore` stays synchronous. For each record it opens the row as today, then gives each saved queued message a row
   through `appendQueued` (new ids `queued-1`, `queued-2`, …), and sends `queued` once when it added any. Then it
   picks one path by the entry of `hosted` whose `id` equals `record.processId`:

   | Hosted entry | Profile | Path | Notices |
   |---|---|---|---|
   | `running`, `current` | in settings | attach (9) | none |
   | `running`, `current` | missing | rest; no attach (no profile folder to attach with); unheld guard (24) | missing profile |
   | `running`, not `current` | any | rest, older host (13); unheld guard (24) | older host; missing profile when missing |
   | not `running`, or none | any | rest (today) | quit during turn when `record.busy`; missing profile when missing |
   | unknown (`hosted` null), `record.processId` not null | any | rest; unheld guard (24) | quit during turn when `record.busy`; missing profile when missing |

   A record with `processId` null takes the "none" row, whatever `hosted` is. The unheld guard sets
   `unheldProcessId = record.processId`.

   `restoreSavedUsage` runs for every row with `record.sent` and a profile, except a row that starts an attach: the
   replay emits its usage. An attach that resolves null or rejects runs it then (9).
9. Attach. A function beside `startProcess` (name it `attachProcess(session, harness, profile, hosted:
   HostedProcessInfo, busy: boolean)`) does this. Restore calls it with `busy = record.busy`; the unheld guard (24)
   calls it with `busy = false`.
   - It increments `processStarts`, clears `pendingPicks`, clears the background ids, sets `processId` to
     `hosted.id`, sets `historyBefore` (10) to `hosted.startedAt`, sets `state.running = true` and sends
     `sessionRunning`.
   - It calls `harness.attach` with `{ sessionId: hostId, resume: session.launchResume, projectDir, profileDir,
     controls: session.launchControls, instructions: <the current registrations>, processId: hosted.id }` and the
     row's `processEvents`, in replay mode (11). `resume` and `controls` are the values the process was launched with
     (3), not the row's current ones.
   - It stores the promise as `HeldSession.attaching: Promise<string | null> | null` until it settles, and returns
     it. The stored promise never rejects: it resolves after the branch below ran, to the rejection's error text, or
     null when the attach did not reject (24 reads the value).
   - On a process, when the row is still live for this start: `started.process` and `session.process` are the
     process; `running` adds it; replay mode ends; it logs `session <rowId> re-attached to process <processId>`.
     Then, when `harnessActivity` is `idle`, it calls `writeNextQueued` once. Else the next live `idle` sends the
     oldest, as today.
   - On null or a rejection, when the row is still live for this start: it logs
     `session <rowId> not re-attached: process <processId> is not running` or
     `session <rowId> not re-attached: <error>`. The row rests as on an `ended` with no exit notice:
     `state.running = false`, `process = null`, `historyBefore = null`, `showRestingIdle`, `sessionRested` with
     `error: null`. It adds the quit-during-turn notice when `busy`. It calls `restoreSavedUsage` when
     `session.sent`. A rejection also sets `unheldProcessId = hosted.id` (24): the host may still run the process
     (a definitions load or a log read failed), so no send may start a second one.
   - A late result: the row is no longer live for this start. Only three things make that happen, because `clear`
     and `stopAll` refuse an attaching row (12, 16) and a send waits on it:
     - An `ended` fired during the replay. It took today's `ended` path, and the hosted process has closed. The
       resolved process is not held, not added to `running`, and gets no call.
     - `detachAll` ran (15). The resolved process gets `detach()` and is not added to `running`. A null or a
       rejection does nothing.
     - The user closed the row (`closed`, 25). The attach sets `started.process` and `session.process` to the
       resolved process and adds it to `running`, but the row is not live, so its events are ignored and its `ended`
       only removes it from `running`. `closed` then ends it. A null or a rejection sends nothing and only logs.
10. History. `HeldSession` gains `historyBefore: number | null`, null for every row that did not attach.
    `prependHistory` passes it to `harness.history` as `before`. `resume` passes null. `clear` sets it to null. An
    attach that resolves null or rejects sets it to null (9): the row replayed nothing, so a cut would hide every
    transcript line recorded after the process started. The row then shows the transcript up to its process's start,
    then the replayed entries, and no entry shows twice.
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
12. Calls on a row whose `attaching` is set. While the attach runs, `state.running` is true and `process` is null,
    a state no `startProcess` makes. Each process-bound call does this:
    - `send` and `sendAllNow` await `attaching`, then go on from their start, as today. So a message sent while the
      attach runs is queued when the replay left the turn running, and is never written to a process not yet held.
    - `interrupt` logs `session <rowId> interrupt waits for the attach`, awaits `attaching`, then runs today's
      `interrupt` when the row is still held and holds a process. Else it does nothing. Reason: the user's Ctrl+C is
      not lost, and `returnUnsent` does not run while the replay can still change the turn.
    - `setControl` and `clear` throw `session <rowId> is still attaching` before they change anything (no
      `pendingPicks` entry, no new host id). The page toasts a `setControl` error today (`chat-commands.ts`, the
      control picker's `picked`). A `clear` error reaches the page as a `clear` refusal does today.
    - `sendNow` and `pullBack` are unchanged. A `sendNow` while the attach runs fails in `deliver` (no process), logs
      `queued message <id> not sent: session <rowId> has no running process`, and keeps the row.
    - `closed` is decision 25. `stopAll` is decision 16. `permission_prompt` is decision 22.
13. Another protocol's host (older or newer; `current: false` does not tell them apart, so one text covers both). The row rests with the unheld guard (24) and the info notice
    `This session is finishing its turn in another app version. Send a message once it ends.`
    - Chat learns that the process ended on each send attempt and each `loadHistory`. There is no poll. Decision 24
      gives the steps. When the list still shows that id `running` and not `current`, the send rejects with
      `This session is still finishing in another app version. Send again once it ends.` The page then toasts
      `Message not sent: This session is still finishing in another app version. Send again once it ends.`
      and puts the message back in the box (today's refusal path).
    - At restore chat logs `session <rowId> waits on process <processId> in another app version`.
14. The quit-during-turn notice (`QUIT_DURING_TURN_TEXT`, text unchanged) shows only when `record.busy` and no process
    stays: the hosted entry is missing or not running (8), or the attach found none (9).

### Quit and stop all

15. Rename `killAll` to `detachAll`, and `isKilled` to `isDetached`. `detachAll` sets `isDetached` first. Then:
    - It calls `detach()` on each held row's `session.process` that is not null. 08's `detach` stops the harness's
      grace and interrupt timers and unsubscribes the host events; the hosted process keeps running. The quit path
      calls `detach()` and never `end()` on a held row's process: an `end()` closes the process's stdin, and 08's
      `detach` then lets the process run only to the end of its turn.
    - It calls `kill()` on every other process in `running`: a closed row's or a cleared row's process that is still
      ending. The user asked for that process to end, so a quit does not leave it running without an owner. Today's
      `killAll` kills it too.
    - A row whose attach still runs gets nothing now. Its late result detaches (9).
    After `detachAll` chat saves nothing, starts nothing and restores nothing, as `isKilled` did. `isLive` returns
    false once `isDetached` is set. The `agentEvent` handler's `sessionEnded` branch (`endsTheSession`, which today
    passes without `isLive`) also requires `!isDetached`. So every later event of every process is ignored. This
    holds when the host client's connection closes at quit and its processes report closed. `closed` after
    `detachAll` ends no process (a detached process's `end()` resolves at once, 08). Update every caller and comment:
    `start.ts` `dispose` (it calls `chat.detachAll()`), the `ChatSessions` doc comments of `resume`, `send`, `clear`
    and `killAll`, and the tests (Tests below). The log copy `chat is stopping` stays.
16. `stopAll()` calls `process.kill()` on each process in `running`, a closed row's still ending included. Before that
    it sets `HeldSession.isStopRequested` on each held row whose process it kills. It logs
    `stopped <n> session process(es)`. A row whose `attaching` is set is not stopped, and chat logs
    `session <rowId> still attaching; not stopped`. A row whose `unheldProcessId` is set holds no process object, so
    its process is not stopped (`running` does not hold it).
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
    - `createConnectHold(timers, log)`: `hold(until)` adds a promise. `ready()` resolves once every held promise has
      settled (resolved or rejected), or `CONNECT_HOLD_MS` (5 000) after the first `hold`, whichever is first. With no
      hold, `ready()` resolves at once. After the wait ended (by the holds or by the bound), `ready()` resolves at
      once. A `hold` while no wait runs starts a new wait with its own bound (a chat plugin reload restores again).
      When every hold settles first, the hold clears its bound timer, so the bound's log never fires late. When the
      bound ends the wait, it logs `relay connects held past 5000 ms; connecting` (source `sessions`). 5 000 ms stays
      under the relay's 10 s wait for the hello reply (wigley-ai-marketplace `plugins/wigley/scripts/forms/README.md`
      § The relay, Hello), and over chat's 3 000 ms list bound (7).
    - `relay-server.ts`: `acceptConnection` reads the hello line and parses it as today. A hello it refuses is refused
      at once, with no wait. For a good hello it awaits `deps.ready()` and keeps the socket flowing during the wait:
      each later chunk goes into its buffer. Reason: a paused socket raises no `end` or `close` when the relay exits,
      so the wait could not see it. It listens for `end` and `close` before the await. When either fired during the
      wait, or `socket.destroyed` is true after it, it logs `a relay left while its connect was held` (source `relay`)
      and calls no `connect`. Else it pauses the socket, puts the buffered bytes after the hello back with `unshift`,
      and calls `startSession`, which connects, replies and serves as today.
    - `sessions/main/start.ts` builds one hold with `api.services.timers` and `api.services.log`, passes `ready` to `startRelayServer`, and
      exports `holdConnects: (until) => hold.hold(until)`. The drive action's `connect` and `exports.connect` are
      not held.
    - Chat's `start` calls `sessions.holdConnects(restored)` synchronously (its deps' `sessions` type widens from
      `Pick<SessionsMainExports, 'activate'>` to `Pick<SessionsMainExports, 'activate' | 'holdConnects'>`), where `restored` is the load, list and
      `restore` chain of decision 7. Chat starts in the same tick as sessions, so the hold is in place before any
      socket event runs. The hold ends when the rows are open, not when the attaches end.
22. A `permission_prompt` call on a row whose `attaching` is set awaits it, then runs today's checks. A row that rests
    after the wait answers cancelled, as today. The wait has no timer of its own: the attach settles when the host
    client answers (task 07).
    `permission-tool.ts` does not change.

## Peer plans

- **Row clock** (`docs/features/session-clock/plan-row-clock/02-chat-main-clock.md`) adds `activeMs` to
  `SavedSession`, an `activeMs` to `openRow`'s `opening`, and a `save()` in `killAll` before `isKilled` is set. When
  it lands first, `SavedSession` holds `activeMs`, `processId`, `launchControls`, `launchResume` and `queued` side by side, each optional in
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

## Unheld processes, closes and skipped records

24. The unheld guard. Two Claude processes must never write one session's transcript. `HeldSession` gains
    `unheldProcessId: string | null`: the id of a process the host may still run for the row while chat holds no
    process object for it. Decision 8 sets it (profile missing, older host, unknown list) and decision 9 sets it (an
    attach that rejects). `openRow` sets it to null.
    - The guard step runs while `unheldProcessId` is set, in `loadHistory` (after its missing-profile return, before
      the read) and in `writeAtIdle` (on the resting path, after `profileNamed` and `requireHarness`, before the
      history read and the start). So a row with a missing profile runs it only once its profile is back. A call
      while a guard step runs awaits that same step (`HeldSession.unheldSettling: Promise<void> | null`), then
      checks again.
    - Step 1: `deps.sessionHost.list()`. A rejection logs `session host not listed: <error>`. `loadHistory` then
      reads nothing and the history stays pending. The send rejects with that error.
    - Step 2: the list shows the id `running` and not `current`. `loadHistory` reads nothing and the history stays
      pending, so the read happens once the old process has written its last transcript lines. The send rejects
      with the older-host text (13).
    - Step 3: the list shows the id `running` and `current`. Chat sets `unheldProcessId` to null and calls
      `attachProcess(session, harness, profile, <the listed entry>, false)`, then awaits `attaching`.
      - `loadHistory` then reads the pending history (with `historyBefore` the entry's `startedAt` when the attach
        held the process, null when it did not).
      - The send goes on from the start of `send` (or `sendAllNow`). Attached: it queues the message when the
        replay left the turn running, else writes it. Rested after a null: it reads the history and starts the
        process with `--resume`, as today. Rested after a rejection: `unheldProcessId` is set again (9), and the send
        rejects with the attach's error. `attaching` resolves to that error text (`Promise<string | null>`, null when
        the attach did not reject); every other waiter ignores the value.
    - Step 4: the list does not show the id `running`. Chat sets `unheldProcessId` to null and goes on as today:
      `loadHistory` reads the history; the send reads it, then starts the process with `--resume`.
    - After the list, a send on a row chat no longer holds, or after `detachAll`, logs and does nothing, as
      `writeAtIdle` does today after its history read.
    - `clear` on a row with `unheldProcessId` set logs `session <rowId> cleared; process <id> left running on the
      session host`, sets it to null, and clears as today: the fresh process uses a new host id, so it shares no
      transcript with the old one.
25. `closed` on a row whose `attaching` is set drops the row and saves at once, as today. Then it awaits `attaching`
    and runs today's tail on `session.process`: with a process (9, the late result) it calls `end()`, then
    `logCloseExit` and `owned.end()`; with none it calls `owned.end()` at once. `closed` on a row whose
    `unheldProcessId` is set (before or after the wait) logs `session <rowId> closed; process <id> left running on
    the session host`, then runs today's path. Chat holds no process object for that process, so it cannot end it.
26. A record that `restore` skips (`already open; not restored`, or an `openRow` that throws) and whose `queued` is
    not empty is kept. Chat holds it in a list of skipped records, and `snapshot()` writes each one after the held
    rows, unchanged, so the next app start tries it again. `snapshot()` leaves out a skipped record whose host id a
    held row now holds (a later `resume` of that session). The skip logs one more line:
    `session <hostSessionId> not restored; its <n> queued message(s) stay saved`. Reason: the design loses no
    queued message, and the restore otherwise rewrote the file without them. A skipped record with no queued
    message is dropped, as today.

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
GIVEN a restored row whose process the host still runs but chat did not attach (profile missing, attach rejected, or
list unknown) WHEN the user sends THEN chat lists the host first, re-attaches when the process still runs in the
current host, and never starts a second process for that session.
GIVEN the app quits WHEN chat's part is disposed THEN every held process is detached, not killed, a closed row's
process still ending is killed, and nothing is saved after it.
GIVEN two running rows WHEN the user presses `<Leader>:` THEN both processes are killed, both rows rest, and each shows
`Session stopped. Your next message resumes this session.`
GIVEN a relay that says hello before chat's restore has opened the rows WHEN the restore opens them within 5 000 ms THEN
the relay joins the owned row.

## Tests

`chat-sessions.test.ts` (the `record` helper gains `processId: null, launchControls: {}, launchResume: false,
queued: []`; `setUp` gains a fake session host, from 01, as `sessionHost`). Every `scriptAttach` with
`outcome: 'process'` passes `turns` (08's `FakeAttachScript`) equal to the number of user entries its `replay`
emits, 0 when it emits none, so the ids the attached fake process gives after the attach do not repeat replayed
ids.

- `startProcess_ProcessId_HostIdStartCountAndTime` — start a row (host `uuid-1`, clock 1000): the start request's
  `processId` is `uuid-1-1-1000`. The process exits and the user sends: the second request's `processId` is
  `uuid-1-2-1000`. The last saved record's `processId` is `uuid-1-2-1000`. The first saved record after the first
  start has `launchResume: false`; the last one has `launchResume: true` (the second start resumed).
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
  | list unknown | `null` | 0 | info, `QUIT_DURING_TURN_TEXT` | false |
  | list unknown, `processId: null` | `null` | 0 | info, `QUIT_DURING_TURN_TEXT` | false |

  In the first row the record also has `sent: true`, `launchResume: false` and `launchControls: { effort: 'high' }`:
  the attach request has `resume: false` and `controls: { effort: 'high' }`.
- `restore_RecordFlags_AddNotices` — its rows pass `hosted: []` and keep their assertions.
- `restore_SkippedRecordWithQueued_StaysSaved` — a record `host-a` with `queued: [{ text: 'a', images: [] }]` whose
  host id is already open on a relay row (`sessionConnected` first): the last saved snapshot holds `host-a` with that
  `queued`, after the held rows; the log holds
  `[chat] session host-a not restored; its 1 queued message(s) stay saved`. The same record with `queued: []` is
  not in the snapshot.
- `attach_LateResult_DetachesOrEnds` (`it.each`; the fake's attach for `p1` scripted `process`; each act runs after
  `restore` and before the attach resolves):

  | act | the attached fake record's `calls` after the attach resolves | also |
  |---|---|---|
  | `detachAll()` | `[{ method: 'detach' }]` | no entry was sent after the act |
  | `closed(row)` | `[{ method: 'end' }]` | `owned.end` ran once, after the `end` |
  | the replay fires `ended({ code: 0, error: null })` | `[]` | the row rests with the exit notice, as today |

- `attach_CallsWhileAttaching_WaitOrRefuse` (`it.each`, each before the attach resolves with a process whose replay
  ends `working`):

  | call | result | after the attach resolves |
  |---|---|---|
  | `setControl(row, 'effort', 'high')` | throws `session row-1 is still attaching` | the process records no `setControl` |
  | `clear(row)` | throws `session row-1 is still attaching` | the host id is still `host-a`; `randomUuid` was not called |
  | `interrupt(row)` | returns; the log holds `[chat] session row-1 interrupt waits for the attach` | the process records `[{ method: 'interrupt' }]` |

- `unheldGuard_SendListsFirst` (`it.each`). Each row starts from a restored resting row with `unheldProcessId`
  `p1`, set by one of two arrangements: (a) `hosted` lists `p1` running and current while profile `gone` is
  missing, then the profiles setting gains `gone`; (b) the attach rejects `Error('defs failed')`. The user then sends
  `c`. The list at the send:

  | list at the send | the send | harness |
  |---|---|---|
  | `p1` running, current; attach scripted `process` ending `idle` | resolves | `attachCalls` has one more entry with `processId: 'p1'`; `starts` unchanged; `c` written to the attached process |
  | `p1` running, current; attach scripted `reject` `again` | rejects `again` | `starts` unchanged |
  | `p1` not running | resolves | one start with `resume: true`; `c` written |
  | `list()` rejects `Error('no host')` | rejects `no host`; the log holds `[chat] session host not listed: no host` | `starts` unchanged |

  The test passes its own `sessionHost: { list }` stub for the rejecting row.
- `unheldGuard_ClosedRow_LogsTheProcessLeftRunning` — close the row of (a): the log holds
  `[chat] session row-1 closed; process p1 left running on the session host`, and `owned.end` ran once.
- `attach_ReplayedEvents_FlaggedNoAlertNoPlanUsage` — window unfocused. The fake's attach fires, before it resolves,
  an entry, `activity('working')`, `activity('idle')`, an `agentEvent` `turnEnded` and a `planUsage`. Then a live
  `activity('working')`, a live `agentEvent` and a live `activity('idle')`. Asserts: the entry was sent; the
  replayed `agentEvent` emits have `replayed: true`; the live one has `replayed: false`; no `planUsage` was emitted;
  `announced` has one alert, from the live idle.
- `attach_SavedQueued_WrittenOnceTheTurnEnds` (`it.each`): the replay ends `working` → no write at resolve, `a` at the
  next live `idle`, `b` at the `idle` after it; the replay ends `idle` → `a` is written at resolve.
- `attach_NullOrRejects_RestsWithQuitNotice` (`it.each`: resolves null; rejects `Error('host gone')`) — the row rests,
  `sessionRested` carries `error: null`, the entries hold `QUIT_DURING_TURN_TEXT`, and the log holds
  `[chat] session row-1 not re-attached: process p1 is not running` or `… not re-attached: host gone`. The record
  has `sent: true`: the next `loadHistory` reads with `before` null, and `lastUsageCalls` is `['host-a']` (one saved
  usage read, made after the attach settled).
- `loadHistory_PendingRow_PrependsOnce` — add a row: an attached row with `startedAt: 5000` reads history with
  `before` 5000; a resting row reads with `before` null.
- `send_WhileAttaching_WaitsForTheAttach` — a send before the attach resolves writes nothing; after it resolves, the
  message is written to the attached process.
- `send_OlderHostProcess_RefusedUntilItEnds` — the list shows `p1` running and older: the send rejects with
  `This session is still finishing in another app version. Send again once it ends.`, and the harness started no
  process. The list then shows `p1` not running: the send reads the history and starts the process with
  `resume: true`. A third row: `list()` rejects `Error('no host')` at the send: the send rejects `no host`, the log
  holds `[chat] session host not listed: no host`, and no process starts.
- `loadHistory_OlderHostRow_ReadsNothing` — while the list shows `p1` running and older, `loadHistory` reads no
  history (`pastSessionCalls` empty). Once the list shows `p1` not running, the next `loadHistory` reads it with
  `before` null.
- `send_RestingRowWithSavedQueued_WritesTheSavedFirst` — a resting restored row with saved `a`: a send of `c` starts
  the process, writes `a`, and queues `c` behind it.
- `stopAll_KillsEveryRunningProcess_RowsRestWithStoppedNotice` — two running rows: each fake process records one
  `kill`. After each `ended`, each row rests with the info notice `Session stopped. Your next message resumes this
  session.` The log holds `[chat] stopped 2 session process(es)`.
- `stopAll_SkipsAnAttachingRow` — one running row and one restored row whose attach has not resolved: the running
  row's process records one `kill`; the log holds `[chat] session row-2 still attaching; not stopped` and
  `[chat] stopped 1 session process(es)`. Once the attach resolves, the attached process records no `kill`.
- Rename the `killAll` tests and rows: `killAll_KillsAHeldSessionsProcess`, `killAll_KillsAClosedSessionStillEnding`
  and `killAll_SkipsAnExitedProcess` become one test, `detachAll_DetachesHeldProcesses_KillsAClosedRowsStillEnding`:
  a held row's running process records `[{ method: 'detach' }]` and no `kill`; a closed row's process still ending
  (its `end` held) records `kill` and no `detach`; an exited row's process records neither. After it, the closed
  row's `sessionEnded` `agentEvent` emits nothing.
  `killAll_ThenExits_SavesNothing` becomes `detachAll_ThenExits_SavesNothingAndSendsNothing`; it also queues `a`
  before the `detachAll` and asserts that no save follows it. The `it.each` rows `'a restore after killAll'` and
  `'killAll'` (about lines 2251, 2369, 2776, 3321; the compiler names the other sites, about lines 1263 to 1301,
  2560 and 2809) become `detachAll` rows with the same assertions.
- `permission_RowAttaching_WaitsThenAsks` — a `permission_prompt` call while the attach runs adds no entry. Once the
  attach resolves with a process, the call adds its waiting permission entry.

`open-sessions.test.ts`: add read rows — a stored session with no `processId`, no `launchControls`, no
`launchResume` and no `queued` reads `processId: null, launchControls: {}, launchResume: false, queued: []`; one with
a queued message holding an image reads it back unchanged; one with `queued` holding `{ text: 1 }` rejects as
unreadable; one with `launchControls: { effort: 1 }` rejects as unreadable; one with `launchResume: 'yes'` rejects as
unreadable.

`start.test.ts`:
- `keepIdleMinutes_StartAndChange_PassedToTheHost` — the fake session host records `[60]` at start, then `[60, 5]`
  after a settings change to 5.
- `restore_HoldsRelayConnectsUntilTheRowsOpen` — the fake sessions dependency records one `holdConnects` promise. It
  settles after `restore` ran.
- `restore_SessionHostListFails_LogsAndRestsEveryRow` (`it.each`, a manual `Timers` fake in `services.timers`;
  `services.sessionHost` is the fake host with its `list` replaced by the row's):
  `list()` rejects with `Error('no host')` → the log holds `[chat] session host not listed: no host`; `list()` never
  settles and the test runs the 3 000 ms timer → the log holds
  `[chat] session host not listed: timed out after 3000 ms`. In both rows the saved row opens resting, and the fake
  harness got no `attach`. A third row: `list()` resolves first → the timer was cleared (the fake holds no timer).
- `dispose_SignInRunning_CancelsIt` — it also asserts that a running row's process got one `detach()` call and no
  `kill()` call (the test's harness double records both).
- `stopAll_Channel_StopsEveryProcess` — invoking `stopAll` on the channel kills the running process.

`chat-commands.test.ts`:
- `stopAll_InvokesMain` — the handler invokes `[['stopAll']]` and logs `stopping every session`.
- `stopAll_Rejects_ToastsError` — like `openPreview_Rejects_ToastsError`: the toast is
  `Sessions not stopped: host gone` with tone `error`.

`connect-hold.test.ts`: `ready_ResolvesWhenTheHoldsSettleOrTheBoundPasses` (`it.each`; `vi.useFakeTimers()`, and
a `Timers` built on `setTimeout` and `clearTimeout`): no hold → resolves at 0 ms; one hold that resolves at 100 ms →
at 100 ms; one hold that rejects at 100 ms → at 100 ms; one hold that never settles → at 5 000 ms, and the log holds
`[sessions] relay connects held past 5000 ms; connecting`. In the 100 ms rows, `vi.getTimerCount()` is 0 once
`ready` resolved, and after the clock runs to 6 000 ms the log holds no `held past` line. A second `ready()` call
after the wait ended resolves at once in every row.

`relay-server.test.ts` (each existing `startRelayServer` call gains `ready: () => Promise.resolve()`):
- `hello_WhileHeld_RepliesOnceReady` — with `ready` pending, a hello gets no reply and `connect` is not called.
  After `ready` resolves, `connect` runs once and the reply is `{ ok: true }`. Bytes the relay wrote after the hello
  during the wait reach `serve` in order.
- `hello_ClosedWhileHeld_NeverConnects` — with `ready` pending, the relay writes its hello, then calls `end()` on its
  socket. After `ready` resolves, `connect` was never called and the log holds
  `[relay] a relay left while its connect was held`.
- `hello_Refused_NotHeld` — with `ready` pending, a hello of protocol 99 gets its refusal at once.

Done when: `npm run typecheck` and `npm run lint` pass; the test gate runs the tests above and the whole files they
sit in; the self-test's `stop all` group is listed. The live checks are in task 12 (checks 1 to 5).
Commit:    one commit for the group: "chat: re-attach hosted sessions, keep them through quit, add stop all and the
           keep-idle setting".

## Proof

Commit 7880e5b4 · proof: diff read; all Produces present; tsc and lint clean; chat, sessions and keymap tests 1082 passed; stop all listed in selftest-script · concerns: the unheld guard's list() has no reply bound, so a host that stops answering leaves that row's send and loadHistory pending; a closed row whose attach resolves after detachAll is detached, not killed, so that process runs without an owner (plan states this); a send in the gap after a re-attach writes a at idle queues and writes b at once, order kept; the relay's left-while-held path relies on default allowHalfOpen false to close the socket; docs/features/followups.md line 433 names chat.killAll, for task 11
