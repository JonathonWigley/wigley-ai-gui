# 07 — Host pending queue and run records

Status: done
Type: Task
Wave: 2 · Depends on: 02
Plan: [plan.md](plan.md)

Files:     modify `src/contracts/session-host.ts` · modify `src/contracts/session-host-protocol.ts` ·
           create `src/session-host/pending-queue.ts` · modify `src/session-host/process-table.ts` ·
           modify `src/session-host/host-server.ts` · modify `src/session-host/session-host.ts` ·
           test `src/session-host/pending-queue.test.ts` (create) · test `src/session-host/host-server.test.ts` ·
           test `src/session-host/process-table.test.ts` · test `src/contracts/session-host-protocol.test.ts`

Consumes:  `HostedSpawn` with `inheritEnv`, `unsetEnv` and `stdin` ← 02. Tree members: `replaceFile`
           (`src/session-host/replace-file.ts`), `DiagnosticLog`, `ProcessSubscriber`, `manualTime` and `fakeChild`
           (`src/session-host/session-host-test-doubles.ts`), `hostRecordProtocol` (`session-host-protocol.ts`, the
           model for `runsFileProtocol`).

Produces:
- In `src/contracts/session-host.ts`, `PendingSpawn` and `HostedRun` exactly as plan.md § Shared names and shapes
  gives them, with their comments.
- In `src/contracts/session-host-protocol.ts`, exactly as plan.md gives them: `SESSION_HOST_PROTOCOL = 4`,
  `SetPendingMessage`, `ListRunsMessage`, `ListRunsReply`, `ForgetRunsMessage`, `RunStartedEvent`,
  `export function pendingFile(protocol: number): string` (returns `pending-v<protocol>.json`) and
  `export function runsFile(protocol: number): string` (returns `runs-v<protocol>.json`) and
  `export function runsFileProtocol(fileName: string): number | null` (the protocol of a `runs-v<n>.json` name, else
  null; modelled on `hostRecordProtocol`, so the name form is written once). `ClientMessage` gains the
  three client messages; `HostMessage` gains `ListRunsReply` and `RunStartedEvent`. The new messages sit under the
  `Versioned` line, not the frozen ones.
- In `src/session-host/pending-queue.ts`:
  ```ts
  export interface PendingQueueDeps {
    folder: string; // the host folder
    clock: Clock;
    timers: Timers;
    diagnostics: DiagnosticLog;
    // The process table's `spawn`.
    spawn(request: HostedSpawn, subscriber: ProcessSubscriber): void;
    // The process table's `isBusy`.
    isBusy(id: string): boolean;
    // Called once for each run the queue starts or skips, after its record is saved.
    runStarted(run: HostedRun): void;
  }
  export interface PendingQueue {
    // Reads the pending table and runs record of `SESSION_HOST_PROTOCOL`, then calls `importOlder`. Arms no timer.
    load(): void;
    // Adds the records of every older protocol's runs file in the folder that this record lacks, saves, and deletes
    // the older file (Decisions, Import).
    importOlder(): void;
    // Arms the timer and starts each entry already due. Before `start`, nothing spawns.
    start(): void;
    setPending(entries: readonly PendingSpawn[]): void;
    runs(): HostedRun[]; // oldest first
    forgetRuns(ids: readonly string[]): void;
    // Fills the exit of the run with this id when its exit is null.
    processClosed(id: string, exit: HostedExit): void;
    // At a drain: drops every pending entry, deletes the pending file, takes no new entry, and writes the runs file no
    // more, so it stays as last written for the next host to import. `isEmpty` reads true after it.
    drop(): void;
    isEmpty(): boolean; // no pending entry and no run record, or dropped
  }
  export function createPendingQueue(deps: PendingQueueDeps): PendingQueue;
  // The longest the queue's timer waits before it reads the clock again (Decisions, The timer).
  export const PENDING_TICK_MS = 30_000;
  ```
- In `src/session-host/process-table.ts`: `ProcessTable.isBusy(id: string): boolean` — true when the table holds the
  process, it is not ending, and its idle rule reads it busy. `ProcessTableDeps.processClosed` becomes
  `processClosed(id: string, exit: HostedExit): void`, called with the same exit the subscriber got.

Decisions:
- **Load and start order (host-server).** `startSessionHost` creates the queue and calls `load()` once it owns the
  channel, before `endLeftovers`. It calls `start()` in `serveHeldMessages`, after `endLeftovers` resolved, so no
  queued spawn runs beside a leftover (session-host design § The host). In `serveHeldMessages` the held messages are
  served first and `start()` runs after the last of them. Reason: a held `setPending` from the app is newer than the
  loaded pending file, so a task the user removed or edited while the host was down must not fire from the old
  file. A host started with no client (at login) so reads both files and fires what is due.
- **Well-formed entries.** One private check, `isWellFormedEntry`, serves `setPending` and `load`: `at` is a finite
  number, `spawn` is an object and not null, and `spawn.id` is a string. Reason: `typeof null` is `'object'`, and a
  `spawn: null` that reached the process table would throw outside its `try` and end the host with every session.
- **Load rules.** A missing file is an empty list. A file that is not JSON, or not an array, gives an empty list and
  one diagnostics line naming the file. A loaded pending entry that fails `isWellFormedEntry` is dropped with one
  diagnostics line naming its index. A loaded run whose `exit` is null and that is not `skipped` gets
  `exit: { code: null, signal: null, error: 'the session host that started it exited' }`, since this host does not
  hold its process; the record is saved again.
- **Import of older run records** (lead's ruling: no fired run is lost across a protocol change). `importOlder`
  lists the host folder and takes each name whose `runsFileProtocol` is below `SESSION_HOST_PROTOCOL`. For each, it reads the records by
  the load rules above, adds each one whose `id` its own record lacks (the null-exit rule applies to them too), saves
  its own runs file, then deletes the older file. A file it cannot read is left in place with one diagnostics line.
  It runs at `load` and again before each `listRuns` reply. Reason: the client drains older hosts only after the new
  host answered (`adopt` in `session-host-client.ts`), so an older host can still write a record after the new host
  loaded; the next `listRuns` picks it up. After its drain an older host writes the file no more (below).
- **Frozen runs file.** `runsFile`'s name form and the `HostedRun` JSON shape are frozen, as the children record is:
  write a comment saying so beside `runsFile` and `HostedRun`, and put `runsFile` and `runsFileProtocol` with the frozen names in
  `session-host-protocol.ts`, not under `Versioned`. The pending file is not frozen: a drain drops it.
- **Persistence.** Every change to the pending table writes `pendingFile(SESSION_HOST_PROTOCOL)` in the host folder
  through `replaceFile`, as `PendingSpawn[]` JSON. Every change to the runs writes `runsFile(SESSION_HOST_PROTOCOL)` as
  `HostedRun[]` JSON, until `drop`. A write that throws gives a diagnostics line and the in-memory state goes on.
- **`setPending`.** Replaces the whole table. An entry that fails `isWellFormedEntry` is dropped, with a diagnostics
  line naming its index. An entry whose `spawn.id` the runs
  record holds is dropped with no line: the app sent it before it heard that run start. Of two entries with one
  `spawn.id`, the first is kept. After the replace, the timer is armed again and entries already due start at once,
  when `start` has run. After `drop`, `setPending` changes nothing and writes a diagnostics line.
- **The timer.** `pending-queue.ts` exports `PENDING_TICK_MS = 30_000`. One timer for the earliest `at`, set for
  `min(at − clock.now(), PENDING_TICK_MS)`, clamped at 0. When it fires, every entry with `at <= clock.now()` starts,
  in `at` order, then the timer is armed again. A timer that fires before the earliest `at` starts nothing and arms
  again. Reason: Node's timers run on a monotonic clock that does not advance while a Mac sleeps, so one long timer
  fires late by the time slept. With the tick, each fire reads the wall clock again, and an entry whose `at` passed
  during sleep starts within one tick after wake.
- **A fire that throws.** Each fire of one entry runs in a `try`. A throw (from `deps.spawn` or the save) records a
  run with `exit: { code: null, signal: null, error: <the error's message> }` when the entry has no run yet, calls
  `runStarted`, and the next due entry still fires. Reason: the timer callback has no other guard, and an uncaught
  throw in the host kills every child (`session-host.ts`).
- **Fire one entry.** Remove it from the table and save the table. If `skipWhileBusy` is not null and
  `deps.isBusy(skipWhileBusy)`, add `{ id: spawn.id, record, startedAt: now, skipped: true, exit: null }`, save, and
  call `runStarted`. Else add `{ id: spawn.id, record, startedAt: now, skipped: false, exit: null }`, save, then call
  `deps.spawn(entry.spawn, subscriber)`, then call `runStarted` with the run as it stands (a refused spawn already has
  its exit). The run record is written before the spawn, so a refusal that calls `closed` at once finds it.
- **The queue's subscriber** has `line` and `spawned` that do nothing, and `closed` that calls `processClosed`. An app
  that attaches later replaces it in the table (one subscriber per process), so the queue also hears every close
  through `ProcessTableDeps.processClosed(id, exit)`, which `host-server.ts` routes to both the exit rule and
  `queue.processClosed`. `processClosed` fills a null exit once; a second call changes nothing.
- **`forgetRuns`.** Removes the runs with those ids and saves. An unknown id is ignored.
- **Exit rule (host-server).** `checkExitRule` shuts down only when the table holds no process, `queue.isEmpty()`,
  and the host drains or has no client. `host-server.ts` calls `checkExitRule` after `forgetRuns` and after each
  `setPending`. Settled design: the host stays alive while pending is non-empty and while unclaimed run records wait.
  A draining host's `isEmpty()` reads true, since its runs now belong to the next host.
- **Drain.** The `drain` message calls `queue.drop()` before the table drains. Settled design: a protocol change drops
  the old host's queue, and the app sends its queue again on every connect. The old host's run records stay in its
  frozen runs file, which the new host imports (`importOlder`), so no run it fired is lost; its still-running
  processes list as not current, as today, so their rows rest. A `setPending` after the drain changes nothing and
  writes a diagnostics line.
- **Messages (host-server).** `CLIENT_MESSAGE_TYPES` gains `setPending`, `listRuns`, `forgetRuns`.
  `SERVED_WHILE_ENDING_LEFTOVERS` gains `listRuns` and `forgetRuns`: they answer from the loaded record, and the
  client's reply limit (1 s) is shorter than the end of leftovers (about 6 s). `setPending` waits with the other held
  messages. `listRuns` calls `queue.importOlder()`, then replies `{ type: 'listRuns', requestId, runs: queue.runs() }` to the sender. All three mark the
  connection as a client (they are not in `NON_CLIENT_MESSAGE_TYPES`).
- **`runStarted` push.** `host-server.ts` sends `{ type: 'runStarted', run }` to every socket in its client set. A probe
  connection (only `hello`, `list`, `drain`) is not in that set and gets nothing.
- **`session-host.ts`** needs no new dependency: the queue reads its files from `folder` with `node:fs`, as
  `host-server.ts` does. Its only change is any wiring `startSessionHost` needs from it.
- The host still imports only `src/contracts`, `src/shared` and `node:` (plan.md § Boundary rules). The host knows no
  harness: the queue reads nothing inside `spawn` or `record`.
- This task edits no doc. `docs/features/session-host/design.md` is re-read in task 20.
- Test names follow the files' existing `subject_Condition_Result` form.

GIVEN a queue started at time 1000 with an entry at 5000
WHEN the clock reaches 4999, then 5000
THEN nothing spawns at 4999; at 5000 the table spawns the entry, the runs record holds it with `skipped: false`, the
pending file holds `[]`, and `runStarted` fired once

GIVEN an entry whose `skipWhileBusy` names a process the table reads busy
WHEN its `at` comes
THEN nothing spawns, a run with `skipped: true` and `exit: null` is recorded and pushed

GIVEN a host folder whose pending file holds an entry already due and no client connects
WHEN the host starts
THEN the entry spawns once the leftovers ended, and the host does not exit at the first-client wait while the run
record waits

GIVEN a host folder whose pending file holds an entry already due, and a client whose `setPending([])` is held while
the leftovers end
WHEN `endLeftovers` resolves
THEN the held `setPending` is served first, and nothing spawns

GIVEN an entry due at 5000 and a timer that fires at 5000 only after the wall clock reads 9000 (the machine slept)
WHEN the next tick fires
THEN the entry spawns at that tick, not a full delay later

GIVEN two connected clients
WHEN a pending entry starts
THEN both get `runStarted`, and a `hello`-only probe gets nothing

GIVEN a host holding pending entries and run records
WHEN a client sends `drain`
THEN the pending file is gone, the runs file stays as it was, and the host exits once its processes ended

GIVEN a host folder holding an older protocol's runs file with two records, one of whose ids the current runs file
holds
WHEN the host loads
THEN its runs record holds the other one too, its own runs file is saved, and the older file is gone

Tests:
- `pending-queue.test.ts` (create), over a temp host folder, `manualTime` and recorded `spawn`, `isBusy` and
  `runStarted` fakes. `describe('pending queue')`:
  - `start_DueAndLaterEntries_SpawnEachAtItsTime` — the first GIVEN/WHEN/THEN; a second entry at 9000; an entry at
    or before now starts at `start`.
  - `start_BeforeStart_SpawnsNothing` — `setPending` with a due entry before `start` spawns nothing.
  - `fire_SkipWhileBusy_Cases` — a table of rows: `skipWhileBusy` null (spawns); names a busy process (skips);
    names an idle process (spawns); names an unknown id (spawns).
  - `fire_SpawnRefused_RunHoldsTheError` — the fake `spawn` calls `closed` at once with an error; the pushed run
    holds that exit.
  - `fire_SpawnThrows_RecordsTheErrorAndFiresTheNext` — the fake `spawn` throws for the first of two due entries:
    the first run holds the message in `exit.error`, the second spawns. Break: a throw that escapes the timer.
  - `setPending_EntryCases_KeepsOnlyGoodEntries` — rows: bad `at`; no `spawn`; `spawn: null`; `spawn.id` not a
    string; an id the runs record holds; two entries with one id (the first stays). Asserts the saved table.
  - `setPending_Replace_DropsEntriesLeftOut` — a second call without an entry cancels it.
  - `timer_PastTheTick_ArmsAgainUntilAt` — an entry at `PENDING_TICK_MS * 3 + 1000` from now spawns only at its
    `at`, with nothing spawned at each earlier tick.
  - `timer_WallClockPassedAtDuringSleep_StartsAtTheNextTick` — the last sleep GIVEN/WHEN/THEN. `manualTime` moves
    its clock and its timers together, so the queue gets a clock that reads `time.clock.now() + slept`; the test sets
    `slept` past `at`, then advances `manualTime` to the first tick. Break: a delay computed once from `at − now`.
  - `load_FileCases` — rows: no files; files not JSON (empty, one diagnostics line each); a pending entry with no
    `spawn`, and one with `spawn: null` (dropped, one diagnostics line each); a run with null exit gets the
    host-exited error and is saved; a skipped run keeps `exit: null`; a pending entry loads and spawns after
    `start`.
  - `processClosed_FillsANullExitOnce` — two calls; the second exit is ignored; the runs file holds the first.
  - `forgetRuns_DropsOnlyThoseIds` — and an unknown id changes nothing.
  - `drop_DeletesThePendingFileKeepsTheRunsFileAndRefusesSetPending` — after `drop`, a `processClosed` changes no
    file.
  - `load_OlderRunsFile_ImportsItsRecordsAndDeletesIt` — the last GIVEN/WHEN/THEN; a row with an older file that is
    not JSON stays in place with one diagnostics line.
  - `isEmpty_Cases` — rows: empty; pending only; runs only; runs after `drop` (true).
- `process-table.test.ts`, new `isBusy_Cases` — rows: unknown id; idle; busy after a stdin `user` line; ending.
  The existing `close_EndsPendingSignals_AndDeletesTheLog` asserts `processClosed` got the id and exit.
- `host-server.test.ts`, `describe('host queue')`:
  - `setPending_DueEntry_SpawnsAndPushesRunStartedToEveryClient` — two clients and one probe (the fourth GIVEN).
  - `listRuns_RepliesTheRunsOldestFirst` and `forgetRuns_ThenListRuns_LeavesTheRest`.
  - `listRuns_OlderRunsFileWrittenAfterLoad_IsImportedFirst` — an older protocol's runs file placed after the host
    loaded: the reply holds its records, and the older file is gone.
  - `start_PendingFileWithNoClient_SpawnsAfterLeftoversAndStaysAlive` — the third GIVEN; with a held
    `endLeftovers`, the spawn waits for it; `listRuns` answers while it is held.
  - `start_EndingLeftovers_HoldsASpawnAndWhatFollowsIt` — add a `setPending` row to what it holds.
  - `start_HeldSetPending_ServedBeforeTheLoadedQueueStarts` — the GIVEN/WHEN/THEN with a held `setPending([])`.
    Break: `start()` called ahead of the held messages, so a removed task fires once.
- `session-host-protocol.test.ts`: one `it.each` for `runsFileProtocol` beside `hostRecordProtocol`'s — rows
  `runs-v3.json` → 3, `runsFile(4)` → 4, `pending-v3.json` → null, `runs-v.json` → null, `runs-v3.json.tmp` → null.
- `host-server.test.ts`, `exitRule_Cases_ExitsOnlyWithNoProcessAndNoClient` — add cases: pending entries and no
  client (stays); run records and no client (stays); the last record forgotten and the client leaves (exits).
- `host-server.test.ts`, `drain_IdleAndBusy_EndsEachAtTurnEndThenExits` — a second case with pending entries and runs:
  the pending file gone, the runs file kept, then the exit.
- `host-server.test.ts`, `hello_RepliesTheProtocol` asserts `SESSION_HOST_PROTOCOL` by name; no literal 4.

Done when: `npm run lint` and `npm run typecheck` pass; `npm test` passes for the four test files above and for
`src/main/session-host/session-host-client.test.ts` (it reads `SESSION_HOST_PROTOCOL`). A real host with no client that fires
from the pending file it read at start (restarted by hand while the app is quit), and a real run started by the queue,
are checked in task 21 (Final verification). Firing after a real login through launchd is the user's check (task 21
§ The user's checks).

Commit:    one commit for the group: "Session host keeps a persisted pending queue and run records (protocol 4)".

## Proof

Commit 6e4b7e6ad · proof: diff read: Produces present; wave 2 typecheck and lint pass after ba5ff01d8 · concerns: host-link compile gap from RunStartedEvent, patched in ba5ff01d8 until 13
