# 05 — Job queue and runner

Status: done
Type: Task
Rung: deep · crosses chat's launch, close and restore lifecycle, a persisted queue across restarts, and one serial chain over async events
Wave: 2 · Depends on: 03, 04
Plan: [plan.md](plan.md)

Paths are relative to `wigley-ai-gui/`.

Files:
- create `src/plugins/work/main/job-queue.ts` · test `src/plugins/work/main/job-queue.test.ts`
- create `src/plugins/work/main/job-runner.ts` · test `src/plugins/work/main/job-runner.test.ts`

Consumes:
- `LaunchRequest.permissions?: 'auto'` ← 03
- `WorkJob`, `WorkJobKind`, `WorkJobStatus` in `src/plugins/work/contract.ts` ← 04
- `WorkStore` (its `update`), `WorkFile` in `src/plugins/work/main/store.ts` ← 04
- `workManifest` (its `id`, `'work'`) in `src/plugins/work/manifest.ts` ← 04
- From the tree:
  - `ChatMainExports` (`launch`, `close`, `restored`, `defaultProfile`), `ChatMainEvents`, `ChatSessionInfo`, `chatSessionSlot` (`src/plugins/chat/contract.ts`)
  - `SessionsMainExports.setTitle`, `SessionRow`, `followRows`, `AgentSession` (`src/plugins/sessions/contract.ts`)
  - `KeyedSlotReader` (`src/contracts/state.ts`), `PluginEvents`, `QualifiedEvents` (`src/contracts/plugin.ts`), `Clock`, `Timers` (`src/contracts/ambient.ts`), `Files`, `readIfPresent`, `PluginLog`, `errorText`, `isJsonObject`

Produces:

`src/plugins/work/main/job-queue.ts` (pure, no imports beyond the contract and `src/shared/json.ts`)
```ts
export interface QueuedJob { job: WorkJob; queuedAt: string }
export interface RunningJob {
  job: WorkJob; queuedAt: string; startedAt: string;
  hostSessionId: string | null;   // null while its launch has not resolved
  rowId: string | null;
  result: JobResult | null;       // the worker's last report_work_job, null before one
}
export interface JobResult { ok: boolean; note: string | null }
export interface JobQueue { queued: QueuedJob[]; running: RunningJob | null }   // queued: in run order
export const EMPTY_JOB_QUEUE: JobQueue
export type JobQueueEvent =
  | { kind: 'enqueued'; job: WorkJob; at: string }
  | { kind: 'launching'; at: string }
  | { kind: 'launched'; hostSessionId: string; rowId: string }
  | { kind: 'launchFailed' }
  | { kind: 'reported'; result: JobResult }
  | { kind: 'closed'; hostSessionId: string }
  | { kind: 'started' }
  | { kind: 'restoreMissed'; hostSessionId: string }
  | { kind: 'rowRestored'; hostSessionId: string; rowId: string }
export function nextJobQueue(queue: JobQueue, event: JobQueueEvent): JobQueue
export function parseJobQueue(text: string): JobQueue     // throws `queue.json is not a job queue`
```

`src/plugins/work/main/job-runner.ts`
```ts
export const JOB_QUEUE_FILE = 'queue.json'
export const SETTLE_MS = 5_000
export const RESTORE_WAIT_MS = 30_000
export const JOB_TIMEOUT_MS = 20 * 60_000
export function isJobDone(info: ChatSessionInfo | undefined, hasStarted: boolean): boolean
export interface JobOutcome { ok: boolean; note: string | null; startedAt: string | null; rowId: string | null }
export interface JobRunnerDeps {
  chat: Pick<ChatMainExports, 'launch' | 'close' | 'restored' | 'defaultProfile'>;
  sessions: Pick<SessionsMainExports, 'setTitle'>;
  rows: KeyedSlotReader<SessionRow>;            // sessions.rows
  sessionInfo: KeyedSlotReader<ChatSessionInfo>; // chat.session
  events: Pick<PluginEvents<Record<never, never>, QualifiedEvents<'chat', ChatMainEvents>>, 'on'>;
  data: Files;
  store: Pick<WorkStore, 'update'>;
  clock: Clock;
  timers: Timers;
  log: PluginLog;
  homeDir: string;
  profile(): string;                          // the work.profile setting, read at each launch
  instructions(): readonly string[];          // the worker's standing text (06's WORKER_INSTRUCTIONS), read at each launch
  message(job: WorkJob): string | null;       // the job's first message (06's jobMessage); null: its item or card is gone
  ended(job: WorkJob, outcome: JobOutcome): void;   // after the store records the end; 09 wires 08's per-job effects
}
export interface JobRunner {
  start(): void;
  enqueue(job: WorkJob): Promise<void>;
  pending(): WorkJob[];                       // the running job, then the queued ones in run order
  jobOf(session: AgentSession): WorkJob | null;
  report(session: AgentSession, result: JobResult): boolean;
  dispose(): Promise<void>;
}
export function createJobRunner(deps: JobRunnerDeps): JobRunner
```

Decisions:
- **The reducer** follows `src/plugins/auto-retro/main/retro-queue.ts`. It returns a new object every time and never mutates its input.
  - **`enqueued`** follows these rules, checked in order:
    1. A `sweep` when a sweep is already queued leaves the queue unchanged (design.md § The worker). A running sweep does not block one queued behind it.
    2. A `send` or `nudge` whose `itemId` has a queued send or nudge replaces that queued job in place, so the newest text wins. One whose `itemId` is the running job's is dropped, so a double press never posts twice.
    3. A `move` whose `key` has a queued move replaces it in place, so the newest column wins. One whose key is the running move's queues behind it.
    4. Any other press job goes in before the first queued sweep, else last: presses run before the next sweep, in the order the user pressed them.
  - `launching` moves the head to `running` with `startedAt: at`, the ids null and `result` null. It does this only when none runs and the queue holds one.
  - `launched` sets the running job's ids, and throws `work job launched with none running` when none runs.
  - `launchFailed` sets `running` to null. A `restoreMissed` or `closed` naming the running host sets `running` to null. One naming any other host, or arriving with none running, leaves the queue unchanged, so a stale timer or event never ends a later job.
  - `reported` sets `running.result`, so the last report wins. With none running it changes nothing.
  - `started` is the restart rule. A running job with a null `hostSessionId`, a press that never launched, goes back to the very head of the queue, ahead of every queued press and sweep, since it was pressed before them. The one exception is rule 1: an unlaunched running sweep is dropped when a sweep is already queued. A running job with a host is kept, for its row's return.
  - `rowRestored` sets `running.rowId` when its host matches.
- **`parseJobQueue`** checks each field's kind and each job's shape by its `kind`, as `parseQueue` does. Anything else throws.
- **The runner** follows `src/plugins/auto-retro/main/start.ts`:
  - Every event, launch result, report and enqueue applies in one serial chain. A step that throws is logged `work job step failed: <errorText>` and the chain goes on, as auto-retro's `serial` does.
  - **Before `start()`** there is no chain. `createJobRunner` subscribes nothing and reads nothing. An `enqueue` then is held, in call order, and its promise stays pending. `pending()` returns the held jobs. `dispose()` resolves at once, resolving every held enqueue having applied nothing. In the self-test 09 never calls `start()`, so a press there launches nothing and its unawaited enqueue resolves at dispose.
  - **`start()`** begins the chain, and its first step, in this order:
    1. loads `queue.json`
    2. awaits `chat.restored()`, so restored rows are in `sessions.rows` before any claim or launch (09 also awaits it before `start()`; the second wait resolves at once)
    3. applies `started`
    4. applies `enqueued` for each held job, in call order, each saved, resolving each held enqueue's promise once its own is saved
    5. writes the store's `job.running` (Status into the store), whether or not anything changed
    6. subscribes to chat's events and the two slots, then does the restart claim and launch (Restart)

    So 09, awaiting the start sweep's `enqueue`, reads `pending()` after the restored queue and the restart rule apply. A second `start()` does nothing.
  - **`enqueue` after `start()`** resolves once its `enqueued` event is applied and `queue.json` saved, not when the job launches.
  - **`pending()`** returns the running job, when one runs, then the queued jobs in run order, read from the queue as it stands. 09 uses it at start to clear `sending` and `movingTo` marks no pending job matches (plan D5).
  - `queue.json` is written whole after every change, its writes in turn, as `createQueueFile` does. A `queue.json` that cannot be read or parsed logs `queue.json not read: <errorText>`, starts empty, and is never written during that run. Every press it held is gone, and 09's sweep of marks against `pending()` clears what those presses left.
  - The runner keeps its own queue file because the store (04) holds no queue type, and 04 lands before this task.
- **Launch.**
  - The call is `chat.launch({ projectDir: deps.homeDir, profile, message: { text, images: [] }, instructions: deps.instructions(), unattended: true, permissions: 'auto', owner: workManifest.id })`.
  - `profile` is `deps.profile()` when it is not empty, else `chat.defaultProfile(null)`. When both are empty or null, the job fails with the note `No profile to run on: set work.profile, or a default harness with a profile.`
  - A null `deps.message(job)` fails the job with `Its item or card is gone.`
  - A launch rejection fails it with `Launch failed: <errorText>`.
  - When `chat.launch` resolves, the runner records the row id in `launchedRowId` at once, outside the chain, before queueing the `launched` step. `jobOf` reads it (below), so a tool call the worker makes before that step runs is answered. A launch rejection or the job's end sets it back to null.
  - In the step, the runner reads the row's `hostSessionId` from `rows`. A row gone or a null id fails the job with `Its session was gone at launch.`. Otherwise it applies `launched` and sets the row's title through `sessions.setTitle(rowId, 'user', title)`. A `setTitle` that throws logs `work row <rowId> not titled: <errorText>`, and the job runs on untitled.
  - Once `launched` applies, the runner arms the job's timeout (Done and close).
- **Done and close** follow auto-retro's `isRetroDone` and settle wait:
  - `isJobDone` is `isRetroDone`'s rule, copied. A plugin imports no other plugin's main code, and `src/shared` cannot import chat's contract type.
  - A row counts as started once `chat.turnStarted` names it, or its `chat.session` activity leaves idle.
  - Once the row reads done, a `SETTLE_MS` timer re-checks it and calls `chat.close(rowId, 'finished')`. A not-done reading in between clears the timer.
  - `chat.sessionClosed` for the running host ends the job.
  - **The timeout.** A running job past `JOB_TIMEOUT_MS` from `startedAt` is closed the same way, `chat.close(rowId, 'finished')`. The runner sets its in-memory `timedOutHost` to the job's host first, so the outcome reads as a timeout. Unattended denies every prompt at once, so only a looping worker reaches this, and it would otherwise block every press behind it.
    - It is armed for `max(0, JOB_TIMEOUT_MS - (clock.now() - Date.parse(startedAt)))`, at `launched` and at a restart that keeps a launched job. A job whose time ran out during the restart closes at once.
  - **A close that rejects** ends the job as if closed: the runner logs `work row <rowId> not closed: <errorText>` and applies `closed` for the running host, with the outcome below, using the note `Its session could not be closed: <errorText>` where no report or timeout gives one. A job left running with no end event coming would block every press behind it, the harm the timeout exists to prevent. A stray-row close (Restart) that rejects only logs.
  - **Per-job timers.** The settle, timeout and restore-wait timers each belong to one job's host. Each fire is a chain step that first checks `queue.running?.hostSessionId` still equals that host, and does nothing otherwise. Every one of them is cleared at that job's end, whatever ended it.
- **The outcome** of a job that ends by a close, in this order:
  - When `timedOutHost` is the job's host, `ok` is false and the note is `The job ran past 20 minutes and was stopped.`, whatever the worker reported. A worker that reported ok and then looped did not finish.
  - Else, when `running.result` is set, the outcome is that result.
  - Otherwise `ok` is false. The note is `The worker ended without reporting a result.` for reason `finished`, else `Its session closed before it reported.` (or the close-failed note above).
- **Restart**:
  - `started` applies in `start()`'s first step (above).
  - A kept running job claims its row when `rows` holds one with its host. The runner applies `rowRestored` and counts the row started, as `claimRestored` does, then arms its timeout and checks it for done.
  - With no such row, a `RESTORE_WAIT_MS` timer fires a step that re-checks, as auto-retro's `watchRestore` does: when the job still runs on that host and `rows` still holds no row with it, it applies `restoreMissed` with that host and fails the job with `Its session did not come back after the restart.`. A row that arrives during the wait is claimed by the `rows` follow and clears the timer.
  - After the claim, every other row whose `owner` is `'work'` closes with `'finished'` and logs `closed stray work row <rowId>`, so a lost `queue.json` leaves no hidden row behind.
  - Then the head launches.
- **Status into the store.** After every change, and once at start whatever changed (so a `work.json` showing a job the queue no longer holds is corrected), one `store.update` writes `job.running`:
  - null when none runs
  - `{ kind, state: 'queued', rowId: null, at: startedAt, note: null }` while its launch is pending
  - `{ kind, state: 'running', rowId, at: startedAt, note: null }` once launched

  At each end, the same update sets `job.last` to `{ kind, state: ok ? 'done' : 'failed', rowId, at: <end time>, note }`. A sweep that ends ok also sets `lastSweepAt` to its `startedAt`, so the next sweep reads Slack from when this one began. After that update, `deps.ended(job, outcome)` runs. A job that fails before launch ends the same way, with `rowId` null.
- **`jobOf(session)`** answers the running job when `session.info.rowId` equals its `rowId` or `launchedRowId`, or `session.info.sessionId` equals its `hostSessionId`, the matched value non-null. Otherwise it answers null. `report` applies `reported` for that same session and returns true. For any other session it returns false and changes nothing. A `reported` queued before the `launched` step runs after it, since both are chain steps in that order.
- **`dispose`** after `start()` awaits the chain, clears every timer it set and awaits the queue file's writes. It closes no row, so a restart resumes the running job. Before `start()` it resolves at once (above).

Pinned values:
- `SETTLE_MS` is 5000 (auto-retro's `DEFAULT_SETTLE_SECONDS` × 1000), `RESTORE_WAIT_MS` is 30000 (auto-retro's), `JOB_TIMEOUT_MS` is 1200000, and the file is `queue.json`.
- Row titles: sweep `Work sweep`, send `Work send`, nudge `Work nudge`, move `Work move <key>`.
- Every note and log line is quoted in Decisions, and `launched` throws `work job launched with none running`. The log lines: `queue.json not read: <error>`, `queue.json not written: <error>`, `work job step failed: <error>`, `work row <rowId> not titled: <error>`, `work row <rowId> not closed: <error>`, `closed stray work row <rowId>`.

GIVEN a sweep queued WHEN another sweep is enqueued THEN the queue still holds one sweep
GIVEN a queued sweep WHEN a send is enqueued THEN the send runs before the sweep
GIVEN a running send for item X WHEN the user presses Send on X again THEN nothing is queued
GIVEN a saved queue whose running job never launched WHEN the app starts THEN that job launches first
GIVEN a saved running job whose row does not come back WHEN 30 seconds pass THEN `job.last` is failed with `Its session did not come back after the restart.` and the next job launches
GIVEN a launched job whose worker reported ok WHEN its row turns idle and stays idle 5 seconds THEN chat closes the row `finished`, `job.last` is done, and a sweep's end sets `lastSweepAt` to its start
GIVEN a running job WHEN a session other than its own asks `jobOf` THEN it answers null
GIVEN a worker that reported ok WHEN its job passes 20 minutes and is closed THEN `job.last` is failed with the timeout note
GIVEN a restore-wait timer of a job that already ended WHEN it fires during a later job THEN the later job runs on
GIVEN `chat.close` rejects WHEN the runner closes a done row THEN the job ends and the next one launches
GIVEN enqueues made before `start()` WHEN `start()` runs THEN they apply after the saved queue and the restart rule, and each enqueue resolves once saved
GIVEN a launch that resolved but whose `launched` step has not run WHEN that row's session asks `jobOf` THEN it answers the running job

Tests:
- `job-queue.test.ts` › `nextJobQueue` table, each row a starting queue, an event and the queue after it:

  | case | start | event | after |
  |---|---|---|---|
  | sweep deduped | queued `[sweep]` | enqueued sweep | `[sweep]` |
  | sweep behind running sweep | running sweep, queued `[]` | enqueued sweep | queued `[sweep]` |
  | press before sweep | `[sweep]` | enqueued send A | `[send A, sweep]` |
  | presses in order | `[send A, sweep]` | enqueued move K | `[send A, move K, sweep]` |
  | send replaces queued | `[send A 'x']` | enqueued send A 'y' | `[send A 'y']` |
  | nudge replaces queued send | `[send A 'x']` | enqueued nudge A 'y' | `[nudge A 'y']` |
  | send of running item dropped | running send A | enqueued send A | unchanged |
  | move replaces queued | `[move K Todo]` | enqueued move K Done | `[move K Done]` |
  | move behind running move | running move K | enqueued move K Done | queued `[move K Done]` |
  | launching takes head | `[send A, sweep]` | launching | running send A, queued `[sweep]` |
  | launching with one running | running sweep, `[send A]` | launching | unchanged |
  | launched sets ids | running, no host | launched h1 r1 | host h1, row r1 |
  | reported keeps last | running, result ok | reported not ok | result not ok |
  | closed other host | running h1 | closed h2 | unchanged |
  | closed running host | running h1 | closed h1 | running null |
  | started requeues unlaunched | running send A, no host, `[sweep]` | started | `[send A, sweep]` |
  | started requeues ahead of presses | running send A, no host, `[send B, sweep]` | started | `[send A, send B, sweep]` |
  | launching with empty queue | none running, `[]` | launching | unchanged |
  | reported with none running | none running | reported ok | unchanged |
  | closed with none running | none running | closed h1 | unchanged |
  | restoreMissed other host | running h1 | restoreMissed h2 | unchanged |
  | rowRestored other host | running h1 r1 | rowRestored h2 r9 | unchanged |
  | started drops cut sweep when one queued | running sweep, no host, `[sweep]` | started | `[sweep]` |
  | started keeps launched | running h1 | started | unchanged |
  | restoreMissed | running h1 | restoreMissed h1 | running null |
  | rowRestored | running h1 r1 | rowRestored h1 r9 | row r9 |

  Plus `launched_noneRunning_throws` and `nextJobQueue_neverMutatesInput`.
- `job-queue.test.ts` › `parseJobQueue` table: a round trip of a queue holding each job kind and a running job with a result parses equal. `not json`, `{}`, a job of kind `wave` and a running job missing `startedAt` each throw `queue.json is not a job queue`.
- `job-runner.test.ts` › `isJobDone` table: `info` undefined → false; started false → false; `running` false → true; idle, `background` 0, no compaction → true; idle with `background` 1 → false; idle with a compaction → false; working → false.
- `job-runner.test.ts`, with fakes for chat, sessions, both slots, events, timers, clock and `Files`, after auto-retro's `start.test.ts`:
  - `launch_passesUnattendedAutoOwner` — the request carries `unattended: true`, `permissions: 'auto'`, `owner: 'work'`, `projectDir` home, the instructions, and the message text.
  - `launch_profile_settingThenDefault` table — setting `p1` gives `p1`. An empty setting with default `d` gives `d`. An empty setting with a null default ends failed with the no-profile note, and `chat.launch` is never called.
  - `launch_messageNull_failsGone`, `launch_rejects_failsWithError`, `launch_rowGone_fails` — each ends failed with its note, then the next job launches.
  - `done_settlesThenCloses` — a close lands after 5000 ms of idle, and none lands when activity returns before then.
  - `outcome_table` — the reported ok closes done. The reported not ok closes failed with its note. No report with reason `finished` gives the no-report note. Reason `user` gives the closed-before note.
  - `launched_setTitleThrows_jobRuns` — a throwing `setTitle` logs `work row <rowId> not titled: …`, and the job still closes done.
  - `timeout_closesAndFails` table — no report: the row closes at 1200000 ms and ends failed with the timeout note; reported ok, then timed out: ends failed with the timeout note.
  - `timeout_afterRestart_armsRemaining` — a saved running job with `startedAt` 19 minutes before the clock, whose row is restored, closes 60000 ms after the start; one 21 minutes old closes at once.
  - `close_rejects_endsJob` — `chat.close` rejects `x` for a done row: the log holds `work row <rowId> not closed: x`, `job.last` is failed with `Its session could not be closed: x` (ok true when the worker reported ok), and the next job launches.
  - `timers_staleFire_ignored` — a saved running job A whose row has not returned ends by a `chat.sessionClosed` for its host while its restore-wait timer is armed; queued job B launches; advancing the clock 30000 ms changes nothing, B still runs, and `job.last` stays A's.
  - `restart_lateRow_claimed` — a saved running host's row joins `rows` 10000 ms after the start: it is claimed, the restore-wait timer is cleared, and no `restoreMissed` applies.
  - `beforeStart` table — an `enqueue` before `start()` stays pending and `pending()` lists its job; `dispose()` before `start()` resolves at once and resolves that enqueue, with `chat.launch` never called and `queue.json` never written; after `start()` a held enqueue resolves once `queue.json` holds it, behind the saved queue's jobs and after `started`.
  - `enqueue_resolvesWhenSaved` — after `start()`, an enqueue resolves once `queue.json` is written with its job, before `chat.launch` resolves.
  - `pending_runningThenQueued` — with a running send and queued move and sweep, `pending()` is `[send, move, sweep]`.
  - `start_writesJobRunningEvenUnchanged` — a `work.json` with `job.running` set and an unreadable `queue.json`: after start the store's `job.running` is null.
  - `jobOf_beforeLaunchedStep_answersJob` — while an earlier step holds the chain, `chat.launch` resolves row r1; `jobOf` for a session with `rowId` r1 answers the job before the `launched` step runs, and a `report` it makes then lands in the result.
  - `status_writesRunningThenLast` — the store sees `queued`, then `running` with the row id, then null and `last` done. A sweep's end sets `lastSweepAt` to its start.
  - `ended_calledAfterStore` — `deps.ended` runs after the store update with the same outcome.
  - `ended_failedBeforeLaunch_rowIdNull` — a no-profile failure calls `deps.ended` with `rowId` null and `startedAt` set, and `job.last.rowId` is null.
  - `restart_claimsRestoredRow` — a saved running host whose row is in `rows` is claimed and closes once done.
  - `restart_strayClose_skipsClaimed` — rows owned by `work`: the claimed one is not closed, another is closed `finished`, and a row owned by another plugin is left alone.
  - `restart_restoreMissed_fails` — 30000 ms with no row ends failed with the restart note.
  - `restart_closesStrayWorkRows` — a row with owner `work` and another host is closed `finished`.
  - `queueFile_unreadable_neverWritten` — a bad `queue.json` logs `queue.json not read: …` and is never written.
  - `jobOf_onlyRunningSession` table — a matching row id gives the job, a matching host gives the job, and any other session or none running gives null. `report` from another session returns false and leaves the result unset.

Done when: `npm run typecheck` and `npm run lint` pass, the test gate runs the tests above, and runtime checks defer to task 14 (Final verification).
Commit: one commit for the group.

## Proof

Commit 38d94e33b · proof: diff read: nextJobQueue, parseJobQueue, JOB_QUEUE_FILE, SETTLE_MS, RESTORE_WAIT_MS, JOB_TIMEOUT_MS, isJobDone, JobOutcome, JobRunnerDeps, JobRunner, createJobRunner; wave 2 typecheck clean; lint fails only on the composition check for work-inbox/work-board, which 12 closes · concerns: tests use a local manualTime scheduler; some listed tests split or tabled
