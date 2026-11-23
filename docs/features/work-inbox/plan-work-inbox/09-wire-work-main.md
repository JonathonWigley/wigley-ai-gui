# 09 — Wire the work plugin, fixture and self-test

Status: in progress
Type: Task
Rung: deep · the main part's lifecycle joins chat's restore, the job runner, timers, the store's change chain and the self-test and drive modes
Wave: 3 · Depends on: 02, 04, 05, 06, 07, 08
Plan: [plan.md](plan.md)

Paths are relative to `wigley-ai-gui/`.

Files:
- modify `src/plugins/work/main/start.ts` · test `src/plugins/work/main/start.test.ts`
- create `src/plugins/work/main/sweep-timer.ts` · test `src/plugins/work/main/sweep-timer.test.ts`
- create `src/plugins/work/main/selftest-fixture.ts`
- create `src/plugins/work/main/selftest-script.ts`

This task fills 04's main part. It wires the store (04), the runner (05), the worker tools and text (06), detection
and the signal watch (07), and the actions and spin-up (08) to the work channel. It adds the sweep timer, the
detection write-back, the Dock badge, the self-test fixture and script, and a drive action that seeds the same fixture
for task 14. The fixture and script follow backlog's (`src/plugins/backlog/main/selftest-script.ts`,
`selftest-fixture.ts`, and `startFixture` plus the `services.selfTest?.run` hand-over in `backlog/main/start.ts`). The
sweep timer follows `src/plugins/usage/main/plan-poller.ts`.

Consumes:
- `MainServices.pullRequests` (`src/contracts/plugin.ts`) ← 02, handed to 07's watch
- 04's skeleton `workMainPart` (`src/plugins/work/main/start.ts`), which this task fills ← 04. It already creates the
  store, publishes `workStateSlot`, loads the store, and republishes `buildWorkState(store.file(), columns, problem)`
  after the load, on each `onChange` and on `onSettingsChanged`.
- `workStateSlot`, `WorkJob`, `WorkChannel`, `WorkSendArg`, `WorkMoveArg`, `WorkStartArg`, `WorkColumnSetting`,
  `readColumns`, `readProjects` in `src/plugins/work/contract.ts`, and the manifest's settings (`profile`, `intervalMinutes`, `columns`, `signals`,
  `repoFolders`, `projects` and the job-text settings) in `src/plugins/work/manifest.ts` ← 04
- `createWorkStore`, `WorkStore` (`file`, `update`, `onChange`, `settled`), `WorkFile`, `EMPTY_WORK_FILE` in
  `src/plugins/work/main/store.ts` ← 04
- `createJobRunner`, `JobRunnerDeps`, `JobRunner` (`start`, `enqueue`, `jobOf`, `report`, `pending`, `dispose`),
  `JobOutcome` in `src/plugins/work/main/job-runner.ts` ← 05. 05 pins that an `enqueue` made before `start()` is
  held, applied after `queue.json` loads, `chat.restored()` settles and the restart rule (`started`) applies, and
  that its promise resolves once the job is applied and saved; so `pending()` read after that promise reflects the
  restored queue.
- `WORK_TOOLS`, `startWorkTools`, `WorkToolsDeps` in `src/plugins/work/main/work-tools.ts`, and `WORKER_INSTRUCTIONS`,
  `jobMessage`, `JobTextSettings` in `src/plugins/work/main/job-text.ts` ← 06
- `detectSuggestions`, `SeenSignal` in `src/plugins/work/main/detection.ts`, and `createSignalWatch`, `SignalWatch`
  (`latest()` null until the first gather or seed; `seed` holds the watch) in `src/plugins/work/main/signals.ts` ← 07
- `dismiss`, `restore`, `snooze`, `send`, `addToBoard`, `moveCard`, `acceptSuggestion`, `notYet`, `deleteTask`,
  `jobEnded`, `clearStaleMarks`, `nextSnoozeEnd`, `isRefusal`, `ActionResult`, `Refusal` in
  `src/plugins/work/main/actions.ts`;
  `startFromWork`, `linkSession`, `SpinUpResult` in `src/plugins/work/main/spin-up.ts`; and `WorkStartResult`,
  `WorkLinkArg` and the channel's `linkSession` in `src/plugins/work/contract.ts` ← 08
- From the tree:
  - `ChatMainExports.restored`, `resume`, `launch`, `close`, `projects`, `defaultProfile`, `ChatMainEvents.sessionClosed`,
    `ResumeRequest`, `chatSessionSlot` (`src/plugins/chat/contract.ts`)
  - `SessionsMainExports.contributeTools`, `setTitle`, `sessionsRowsSlot`, `editableTitle` (`src/plugins/sessions/contract.ts`)
  - `unityPoolSnapshotSlot` (`src/plugins/unity-pool/contract.ts`)
  - `MainApi.channel.handle`, `MainApi.drive`, `MainPart.ready`, `MainServices.runMode`, `selfTest`, `randomUuid`,
    `alerts`, `git`, `clock`, `timers`, `homeDir`, `paths` (`src/contracts/plugin.ts`)
  - `Alerts.setOpenCount` (`src/contracts/alerts.ts`), `SelfTestScript`, `SelfTestGroup`, `SelfTestStep` (its
    `writeFile`), `PageBind`
  - `Files.watch` (`src/contracts/files.ts`) on `api.data`, as app-update's self-test drives its main part through
    files its steps write into `plugin-data/app-update` (`src/plugins/app-update/main/selftest-script.ts`)

Produces:

`src/plugins/work/main/sweep-timer.ts`
```ts
export interface SweepTimerDeps {
  timers: Timers;
  clock: Clock;
  intervalMinutes(): number;     // work.intervalMinutes, read at each arming
  sweep(): void;                 // queues a sweep
}
export interface SweepTimer {
  sweepEnded(): void;            // records the end and arms for the interval
  reschedule(): void;            // after an intervalMinutes change
  dispose(): void;
}
export function createSweepTimer(deps: SweepTimerDeps): SweepTimer
export const MIN_SWEEP_MINUTES = 1
```

`src/plugins/work/main/selftest-fixture.ts`
```ts
export const FIXTURE_ITEM_IDS: Readonly<Record<'needsYou' | 'promised' | 'waiting' | 'myThread' | 'around'
  | 'worthKnowing' | 'dismissed', string>>
export const FIXTURE_TASK_ID = 'fixture-task'
export function fixtureFile(now: number): WorkFile
export function fixtureSignals(now: number): SeenSignal[]
```

`src/plugins/work/main/selftest-script.ts`
```ts
export interface WorkSelfTestDeps { seed(): Promise<string[]> }   // resolves to the problems found
export function workSelfTestScript(deps: WorkSelfTestDeps): SelfTestScript
export function reseedStep(group: string): SelfTestStep           // a group's first step: back to the fixture
export const WORK_SELFTEST_KEYS: readonly string[]                // [' ', 'z', 'w'], the binds' prefix
export const RESEED_FILE = 'selftest-reseed.txt'                  // in work's plugin data
```

`start.ts` keeps 04's part signature. Every command runs in the page (04), so main handles the channel and returns no
command handlers.

Decisions:
- **Settings reads.** Every read of `work.columns` in this part goes through `readColumns(api.settings().columns)` and
  every read of `work.projects` through `readProjects(...)` (04), at the moment of use. That covers the actions'
  `columns`, 06's `columns()` and `jobMessage`'s settings (`{ ...api.settings(), columns: readColumns(…) }`), 07's
  `columns()`, and spin-up's `projects()`. "`work.columns`" below means that read.
- **Start order (`start.ts`)**, after 04's store, slot and load:
  1. Create the runner with `createJobRunner` (05). Its deps:
     - `chat`, `sessions`, the `sessions.rows` and `chat.session` readers, `api.events`, `api.data`, the store,
       `clock`, `timers`, `log` and `homeDir`
     - `profile: () => api.settings().profile`
     - `instructions: () => [WORKER_INSTRUCTIONS]`
     - `message: (job) => jobMessage(job, { ...api.settings(), columns: work.columns }, store.file())`. The
       settings object holds every `JobTextSettings` field.
     - `ended: (job, outcome) => …` (Job ends, below)
  2. Contribute the tools: `sessions.contributeTools(WORK_TOOLS, startWorkTools({ jobOf: runner.jobOf, report:
     runner.report, store, columns: () => work.columns, clock }))` (Settings reads). Bind the two runner methods to the
     runner.
  3. Create the signal watch (07) with `services.git`, `services.pullRequests`, `chat`, the `chat.session`,
     `sessions.rows` and `unity-pool.snapshot` readers, `repoFolders: () => api.settings().repoFolders`,
     `cards: () => store.file().cards`, `signals: () => api.settings().signals`, `columns` (Settings reads),
     `homeDir`, `paths`, `clock`, `timers`, `log`, and `onSeen: redetect`.
  4. Create the sweep timer, with `sweep` enqueueing a sweep (Commands).
  5. Handle every `WorkChannel` method through `api.channel.handle` (Commands).
  6. Load `job-rows.json` (openJobRow › The records).
  7. Register the drive action when `api.drive` is not null, and hand the self-test script when `services.selfTest`
     is not null. In `selfTest` only, start the reseed watch (Seeding).
  8. Set the badge once from the loaded file (The Dock badge).
  9. The part's `ready()` returns `void`, as `MainPart.ready` declares, and starts one floating chain:
     `void chat.restored().then(begin).catch((e) => log(`start not finished: ${errorText(e)}`))`. `restored()` never
     rejects (its contract), so the catch is for `begin`'s own failures. `begin` runs, in order:
     1. `watch.refresh()`, the start gather: detection runs over the saved file before any sweep, from git, `gh` and
        the restored sessions, none of which needs Slack.
     2. When `runMode` is not `selfTest`: `runner.start()`, then `await runner.enqueue({ kind: 'sweep' })`, the start
        sweep (design § The worker, "When"), logged `sweep queued`. Once that enqueue resolves, the restored queue is
        in `runner.pending()` (Consumes), and `begin` runs `store.update((f) => clearStaleMarks(f, runner.pending()))`
        (08), so a `sending` or `movingTo` saved with a job that a lost or unreadable `queue.json` dropped clears with
        its note. An enqueue rejection logs `job not queued: <errorText>` and runs no clear.
  10. In `selfTest`, `runner.start()` is never called, and no clear runs. Presses and sweeps queue, and no worker
     launches ("Demo and self-test use sample data and launch no worker"). A drive run is not `selfTest`, so it
     launches on the fake harness as live does.

  `dispose`, in this order: disposes the watch, then clears the snooze timer and the sweep timer, then disposes the
  reseed watch and the tools, then awaits `runner.dispose()`, then awaits `job-rows.json`'s writes, then 04's
  `store.settled()`. The timers stop before the awaits, so none fires into a part that is going away; a `redetect`
  reached after dispose began does nothing.
- **`work.state` is 04's build.** 04 republishes `buildWorkState` on every store change and settings change. The
  slot's `job` is the store's `job`, which 05 writes. The slot's `suggestions` are the store's `suggestions`, which
  this task writes from detection. This task publishes nothing itself.
- **Detection write-back (`redetect`).**
  - While `watch.latest()` is null (no gather or seed has finished yet), it does nothing, so the suggestions saved in
    `work.json` stand until the start gather reports. Without this, the first store change (05 writes job status as
    soon as the start sweep launches) would replace them with `[]`.
  - Otherwise it computes `detectSuggestions({ cards, seen: watch.latest(), signals: api.settings().signals,
    columns: work.columns, notYet })` over `store.file()`.
  - When the result equals `store.file().suggestions` (compared as JSON), it does nothing. Otherwise it runs
    `store.update`, whose change runs detection again over the file it is given and sets `suggestions`.
  - The equality check comes first because every update fires `onChange`, which runs `redetect` again. A second run
    finds them equal and stops.
  - It runs on each store `onChange`, on `onSettingsChanged`, and on each `onSeen`.
- **The Dock badge.** Once after `store.load()`, and on every store change, `services.alerts.setOpenCount('work', n,
  noun)`, where `n` counts the items with `section === 'needs_you'` and `state === 'open'`. The count starts at 0, and
  each change of `n` logs `needs you: <n>`, so a saved file with one open Needs you item logs `needs you: 1` at load
  and an empty one logs nothing. A sending item is still `open` (08), so the badge drops when its job succeeds.
  Stopping the plugin zeroes it (the alerts service does that).
- **Snooze ends.** After every store change, one one-shot timer is armed at `nextSnoozeEnd(store.file())`, replacing
  the last one. When it fires, it runs `store.update((f) => jobEnded(f, { kind: 'sweep' }, { ok: true, note: null },
  clock.now()))`, which is `expireSnoozes` (08).
- **Commands.** Each `WorkChannel` method's main handler follows one shape:
  1. Run the action from 08 inside `store.update`, over the file the update is given. A `Refusal` makes the change
     throw, so the file and listeners stay as they were (04).
  2. On a refusal, log `refused <method>: <refused>` and reject with an `Error` whose message is the refusal text.
     04's page handler returns that rejection, and the view toasts it (10, 11).
  3. Otherwise log the result's `log` line. When `ActionResult.job` is not null, enqueue it with `runner.enqueue`.
  4. The handler never awaits `runner.enqueue`: in `selfTest` the runner's chain never begins. It catches a rejection,
     logs `job not queued: <errorText>`, and runs `store.update((f) => jobEnded(f, job, { ok: false, note:
     'Not queued: <errorText>' }, clock.now()))` (08), so the press's `sending` or `movingTo` clears with that note
     rather than standing with no job behind it.

  Specific methods:
  - **`sweep`** enqueues `{ kind: 'sweep' }` and logs `sweep queued`. 05's queue drops a second queued sweep. The
    runner gives no sign of the drop, so this part logs nothing for it.
  - **`send`** passes its `WorkSendArg`. **`dismiss`**, **`restore`** and **`snooze`** pass the item id, and `snooze`
    passes `clock.now()`.
  - **`addToBoard`** passes the new id `local-<services.randomUuid()>` and `work.columns`.
  - **`moveCard`** passes its `WorkMoveArg`, `work.columns` and `clock.now()`. **`acceptSuggestion`** passes the card
    id, `work.columns` and `clock.now()`. **`notYet`** and **`deleteTask`** pass the card id.
  - **`startSession`** runs `startFromWork` over `store.file()`, with `projects: () => readProjects(api.settings().projects)`. A
    refusal rejects as above. A `launched` result stores `linkSession(f, { cardIds, sessionId: rowId })` and
    resolves to `{ kind: 'launched', toast }`. A `prompt` result resolves as it is.
  - **`linkSession`** (a channel method with no command, 08) stores `linkSession(f, arg)`.
- **Job ends** (05's `ended(job, outcome)`, which runs after 05 has written `job.last` and `lastSweepAt`):
  1. `store.update((f) => jobEnded(f, job, outcome, clock.now()))` (08), with `job.last.rowId` nulled in the same
     change when no record names it (openJobRow). This clears a send's `sending`, clears the item on success, and sets
     a failed send's note. It clears a move's `movingTo` and sets its note. A sweep's end expires snoozes.
  2. For a sweep, done or failed: `sweepTimer.sweepEnded()` and `watch.refresh()`.
- **`openJobRow`** opens the transcript of the last finished job, while a job runs too:
  - **The target** is `store.file().job.last`. Its `rowId` names a record in `job-rows.json`. The handler resumes
    that saved session with no owner through `chat.resume({ projectDir, profile, hostSessionId, title })`. That opens
    a visible, selected row where the user reads the transcript.
  - **A running job's own row cannot open.** Chat holds it with owner `work`, `chat.resume` rejects a held row with
    another owner, and an owned row has no side-bar place; the one tree path that shows an owned row, chat's page
    export `mountChat`, needs a pane, which plan.md puts out of scope. So while a job runs, the handler still opens
    `job.last`'s row when it has a record.
  - **`job.last.rowId` is non-null only while a record can reopen it.** 04's `statusLine` gives `hasRow` as
    `last !== null && last.rowId !== null`, and the views' Show transcript button follows it, so 09 keeps that true:
    - At each job end, in the same `store.update` as `jobEnded` (Job ends, step 1), when `job.last.rowId` names no
      kept record, it is set to null. A job with a row closes through `chat.sessionClosed`, whose record this part
      keeps before 05 moves the job to `last`, so this nulls only a row whose close event never came.
    - After the load of `job-rows.json` at start, one `store.update` sets `job.last.rowId` to null when no kept
      record names it (a lost or unreadable `job-rows.json`).
    - `job.last` is always the newest record, so the 20-record cap never drops it.
  - **Refusals.** With a job running and a null `job.last.rowId` (or no `last`): `The job is still running`. With
    none running: `No transcript for that job`. A `chat.resume` that rejects refuses with its `errorText`.
  - **The records.** This part listens on `chat.sessionClosed`. For each event whose `sessionId` is the `rowId` of
    `store.file().job.running` or `job.last`, read when the event arrives, it keeps `{ rowId: sessionId,
    hostSessionId, projectDir, profile, title: editableTitle(titles) }` from the event. An event for any other row,
    such as a job that ended before a newer one started, is dropped. The newest 20 records stay in plugin data,
    `job-rows.json` (`JOB_ROWS_FILE`), newest first, so a link survives a restart. A new record for a `rowId` already
    kept replaces it and moves to the front.
  - **The file** is handled as 05 handles `queue.json`: read once at start, a missing file reads as no records, and
    one that cannot be read or parsed (an array of records whose five fields are strings) logs
    `job-rows.json not read: <errorText>`, starts empty and is never written during that run. Writes are whole and in
    turn, one chain; a failed write logs `job-rows.json not written: <errorText>`, and memory keeps the records.
    `dispose` awaits the chain.
- **Sweep timer (`sweep-timer.ts`):**
  - `sweepEnded` clears any armed timer and arms one for `intervalMinutes`. A non-zero value below
    `MIN_SWEEP_MINUTES` counts as `MIN_SWEEP_MINUTES`, and 0 arms nothing. When the timer fires, it calls `sweep()`.
  - Nothing is armed until the first sweep ends: the start sweep, or a `W`.
  - `reschedule` runs on a `work.intervalMinutes` change. `start.ts`'s `onSettingsChanged` keeps the last value read
    and calls `reschedule` only when the new value differs, so a change to any other setting leaves the timer alone:
    - With interval 0, it clears the timer.
    - With no sweep ended yet, it does nothing.
    - When the last end plus the new interval has passed, it sweeps at once.
    - Otherwise it arms for the time left, as plan-poller's `reschedule` does.
  - `dispose` clears the timer.
  - The interval runs from each sweep's end, not its start, so a slow sweep never stacks the next one behind it.
- **Fixture (`selftest-fixture.ts`)** is sample data, with no disk outside plugin data:
  - **Items:** seven. Six are `open`, one per section. The seventh is a dismissed `needs_you` item, for All and
    Restore. Their `at` values are pinned (Pinned values), so the views' newest-first order is known.
  - **Cards:** six Jira cards, one per default column plus one with an unmapped status, and one local task. Each Jira
    card has `column: ''`, `reachableStatuses: null`, and no link. `movedAt` is null except on `WRK-5` (Pinned
    values). Two cards carry a priority and one a long title, so task 14's card-head fit check has something to
    measure.
  - **Signals:** three `SeenSignal`s:
    - `WRK-2` gets a branch signal: a `suggested` move from Todo to In Progress.
    - `WRK-3` gets an open PR: a `suggested` move from In Progress to In QA.
    - `WRK-5` gets a merged PR before it moved to Done: a `done` entry (07 gives `done` only for a card that moved
      into the column after the signal).
  - The rest of the file is `EMPTY_WORK_FILE`'s.
- **Seeding** (`seed`):
  1. `await store.update(() => fixtureFile(clock.now()))`, which replaces the whole file.
  2. `watch.seed(fixtureSignals(clock.now()))`, whose `onSeen` runs `redetect`. It also holds the watch (07), so no
     later gather replaces the fixture's signals.
  3. `await store.settled()`, then log `fixture seeded: <items> items, <cards> cards, <suggestions> suggestions` from
     `store.file()`.
  4. Resolve to the problems found: each count that differs from 7, 7 and 3, and a badge count other than 1.

  The self-test script's `open` runs it on each run, and the reseed watch before each group (below). The drive action
  `work.seed` (args `{}`, description `Replaces the work store with the self-test fixture and seeds its signals.`)
  runs it for task 14. Both exist only outside a live run, so neither reaches the user's real data. Each run's home is
  a temp home.
- **The runner in a seeded run.** The runner starts in every run mode but `selfTest`, seeded or not: a drive run
  seeded through `work.seed` keeps its runner, so task 14's `W` launches a sweep on the fake harness. A `selfTest`
  run never starts it.
- **A seed in a drive run holds against the start sweep.** A drive run starts the runner, so its start gather and
  start sweep may run before or after `work.seed`. The seed holds either way:
  - The start gather, and every sweep end's `refresh()`, gather nothing once the watch is held, and a gather in
    flight at the seed reports nothing (07 § Seeding).
  - The runner's writes touch only `job` and `lastSweepAt`; a status write after the seed sets `job.running` again
    over the fixture's null, which is the truth. A sweep's end runs `expireSnoozes`, which only expires snoozes past
    their end. The fake harness's worker calls none of work's tools, so a sweep records no items or tickets.
  - The start-time `clearStaleMarks` may run after the seed; the fixture holds no `sending` or `movingTo`, so it has
    nothing to clear. A press made before it runs has its job in `pending()`, so its mark stays.
  So task 14 seeds once `drive -- start` has returned, and needs no wait for the start sweep.
- **Reseeding before each group.** The script's groups run in one page load, and each group's presses change the
  data the next one starts from. So each group begins with `reseedStep(<group name>)`, which 13's view groups call
  too:
  - It returns `{ writeFile: { path: 'plugin-data/work/selftest-reseed.txt', text: <group name> }, keys: [],
    expect: '[work] fixture seeded: 7 items, 7 cards, 3 suggestions', why: 'Each group starts from the fixture.' }`.
  - In `selfTest` only, main watches `api.data`'s root, not recursive, and each change to `RESEED_FILE` runs `seed()`
    (with no log of its own beyond the seed's line). A step's `writeFile` is the self-test's outside change on disk,
    as app-update's steps write into its plugin data.
  - The badge line follows the reseed when the count changes, so a group's next step can expect `needs you: <n>`
    against a known start of 1.
- **The self-test script covers the data plugin.** It drives work's commands through its own `pageBinds` in scope
  `any`, under `WORK_SELFTEST_KEYS`, `Space z w`. `<Leader>z` is the built-in `debug` group
  (`src/plugins/keymap.ts`), which holds `zl…`, `zg` and `zs`, and plugins' self-test-only binds sit under it by the
  plugin's letter: app-update's press keys are `Space z a u`. `<Leader>zw` is bound nowhere. Leader sequences sit
  outside the placement check. It checks main's `[work]` log lines. The binds carry each command's argument in the
  shape 04's manifest declares: an item id, a card id, a `{ itemId, text }` record, or a `{ cardId, column }`
  record. Task 13 adds the view groups (`inbox keys`, `board keys`) to this script once 12 has registered the views;
  they start with `reseedStep` as these do.

Pinned values:
- `MIN_SWEEP_MINUTES = 1`
- Alerts: source `'work'`, noun `{ singular: 'Slack item that needs you', plural: 'Slack items that need you' }`
- `JOB_ROWS_FILE = 'job-rows.json'`, a constant in `start.ts`; it keeps 20 records, newest first.
- Log lines, under `[work]`:
  - `sweep queued`
  - `needs you: <n>`
  - `refused <method>: <refusal>`
  - `job not queued: <errorText>`
  - `start not finished: <errorText>`
  - `job-rows.json not read: <errorText>`, `job-rows.json not written: <errorText>`
  - `fixture seeded: <i> items, <c> cards, <s> suggestions`
  - 08's action lines
- Refusals: `The job is still running`, `No transcript for that job`, and 08's.
- The not-queued note: `Not queued: <errorText>`, passed to 08's `jobEnded`.
- Fixture items, as `id` · `section` · `state` · `ticketKeys`. Each has a title, summary, author, channel and url in
  plain sample words, `firstSeen` at `now`, and the other nullable fields null. Their `at` values run newest first in
  the order listed: the first is 10 minutes before `now`, and each next one 10 minutes before the one above it, so
  `fixture-dismissed` is the oldest at 70 minutes. The `needs_you` and `waiting` items carry a draft:
  - `fixture-needs-you` · `needs_you` · `open` · `['WRK-1']` · draft `Yes, I'll take a look today.`
  - `fixture-promised` · `promised` · `open` · `[]`
  - `fixture-waiting` · `waiting` · `open` · `[]` · draft `Any news on this?`
  - `fixture-my-thread` · `my_threads` · `open` · `[]`
  - `fixture-around` · `around` · `open` · `['WRK-3']` · why `Mentions WRK-3`
  - `fixture-worth-knowing` · `worth_knowing` · `open` · `[]` · why `Release freeze starts Friday`
  - `fixture-dismissed` · `needs_you` · `dismissed` · `[]`
- Fixture cards, in the file in this order, as `key` · `jiraStatus` · `priority`, with a short sample title unless one
  is given:
  - `WRK-1` · `Backlog` · null
  - `WRK-2` · `To Do` · `Medium`
  - `WRK-3` · `In Progress` · `High`
  - `WRK-4` · `In Review` · null · title `Tidy the board's column headers so long ticket titles wrap cleanly beside the key and priority`
  - `WRK-5` · `Done` · null · `movedAt` 30 minutes before `now`
  - `WRK-6` · `Blocked` (Other) · null
  - local `fixture-task`: column `Todo`, `sourceItemId` `fixture-promised`
- Fixture signals, each `at` one hour before `now`:
  - `branch` `wrk-2-board`, `keys: ['WRK-2']`, reason `Branch wrk-2-board in fixture-repo`
  - `pr_opened` #12 `WRK-3 tidy`, head `wrk-3-tidy`, `keys: ['WRK-3']`, `prState: 'open'`
  - `pr_merged` #9 `WRK-5 ship`, head `wrk-5-ship`, `keys: ['WRK-5']`
- Self-test binds, scope `any`, each keys `' ', 'z', 'w', <key>` (`WORK_SELFTEST_KEYS` then the key):

  | key | command | target |
  |---|---|---|
  | `d` | `work.dismiss` | `fixture-needs-you` |
  | `r` | `work.restore` | `fixture-needs-you` |
  | `z` | `work.snooze` | `fixture-waiting` |
  | `s` | `work.send` | `{ itemId: 'fixture-needs-you', text: "Yes, I'll take a look today." }` |
  | `a` | `work.addToBoard` | `fixture-my-thread` |
  | `A` | `work.addToBoard` | `fixture-around` |
  | `m` | `work.moveCard` | `{ cardId: 'fixture-task', column: 'In Progress' }` |
  | `n` | `work.notYet` | `WRK-2` |
  | `y` | `work.acceptSuggestion` | `WRK-3` |
  | `x` | `work.deleteTask` | `fixture-task` |
  | `X` | `work.deleteTask` | `WRK-1` |
  | `w` | `work.sweep` | — |

- Self-test groups. The script's `open` shown line is `[work] fixture seeded: 7 items, 7 cards, 3 suggestions`, and
  its result is `seed()`'s problems. `open` re-seeds on every run, so a second page load's run starts from the same
  data. Each group's first step is `reseedStep(<its name>)`.
  - **`inbox`**. Why: each Inbox press changes the item in main and logs it, the badge follows Needs you, and a
    sending item stays open and takes no other press.

    | keys | expect | also expect |
    |---|---|---|
    | (`reseedStep('inbox')`) | `[work] fixture seeded: 7 items, 7 cards, 3 suggestions` | |
    | `Space z w d` | `[work] dismissed fixture-needs-you` | `[work] needs you: 0` |
    | `Space z w r` | `[work] restored fixture-needs-you` | `[work] needs you: 1` |
    | `Space z w z` | `[work] snoozed fixture-waiting for 1 day` | |
    | `Space z w s` | `[work] send queued fixture-needs-you` | |
    | `Space z w d` | `[work] refused dismiss: fixture-needs-you is sending` | |

  - **`board`**. Why: a local task moves at once, Not yet hides a suggestion, Accept queues a Jira move, and a Jira
    card refuses delete.

    | keys | expect |
    |---|---|
    | (`reseedStep('board')`) | `[work] fixture seeded: 7 items, 7 cards, 3 suggestions` |
    | `Space z w a` | `[work] added fixture-my-thread to the board` |
    | `Space z w A` | `[work] refused addToBoard: Already on the board as WRK-3` |
    | `Space z w m` | `[work] moved fixture-task to In Progress` |
    | `Space z w n` | `[work] not yet WRK-2` |
    | `Space z w y` | `[work] moving WRK-3 to In QA` |
    | `Space z w x` | `[work] deleted fixture-task` |
    | `Space z w X` | `[work] refused deleteTask: Only a local task can be deleted` |

  - **`sweep`**. Why: in the self-test a sweep queues and no worker launches.

    | keys | expect |
    |---|---|
    | (`reseedStep('sweep')`) | `[work] fixture seeded: 7 items, 7 cards, 3 suggestions` |
    | `Space z w w` | `[work] sweep queued` |

GIVEN `intervalMinutes` 10 WHEN a sweep ends at t THEN the next sweep queues at t + 10 min, and WHEN the setting changes to 0 THEN no timer is armed
GIVEN the app starts live WHEN chat's restore settles THEN one gather runs, `runner.start()` runs and exactly one sweep is enqueued
GIVEN a saved `work.json` with suggestions WHEN the store changes before the first gather finishes THEN the saved suggestions stay
GIVEN a saved `sending` whose job is not in the restored queue WHEN the start sweep's enqueue resolves THEN `sending` is null and the note is `Send failed: Its job was lost in a restart.`
GIVEN a press whose `runner.enqueue` rejects with `x` WHEN the handler catches it THEN the press's mark clears with `Not queued: x`
GIVEN the self-test WHEN `Space z w w` is pressed THEN the sweep queues and no session launches
GIVEN a send job fails WHEN 05 calls `ended` THEN the item is open with `Send failed: <note>`, and the badge counts it
GIVEN the seeded fixture WHEN `work.notYet` runs on `WRK-2` THEN its suggestion leaves the slot and stays out after the next `redetect`
GIVEN a drive run seeded through `work.seed` WHEN the start sweep ends THEN the slot still holds 3 suggestions

Tests:
- `sweep-timer.test.ts`, over fake timers and clock, as `plan-poller.test.ts` does:

  | case | expect |
  |---|---|
  | `sweepEnded` | armed for the interval |
  | interval 0 | never armed |
  | interval 0.2 | armed for 1 min |
  | fire | `sweep` called once, and nothing re-arms until the next `sweepEnded` |
  | `reschedule` to a longer interval | armed for the time left |
  | `reschedule` past due | sweeps now |
  | `reschedule` to 0 | cleared |
  | `reschedule` before any sweep ended | nothing |
  | `dispose` | a later fire does nothing |

- `start.test.ts`, with the part started over fake chat, sessions, runner deps and services through `fakeDependency`:
  - `start — a gather, then one sweep, after chat.restored; no sweep in selfTest`
  - `start — runner.start only outside selfTest, and in a seeded drive run`
  - `start — stale marks cleared once the start sweep's enqueue resolves; a pending job keeps its mark`
  - `redetect — keeps the saved suggestions while latest() is null`
  - `redetect — writes suggestions only when they differ, and stops`
  - `redetect — does nothing after dispose began`
  - `badge — set from the loaded file, counts open needs_you items, and logs each change from 0`
  - `commands — each refusal is logged and rejects with its text` (a table over every channel method)
  - `commands — a press job is enqueued, unawaited`
  - `commands — a rejected enqueue logs and clears the press's mark with Not queued`
  - `startSession — launched links the cards and resolves the toast; prompt resolves as it is`
  - `jobEnded — sweep end arms the timer, refreshes signals and expires snoozes`
  - `jobEnded — failed send and failed move restore the item and card`
  - `snoozeTimer — armed for the next end, replaced on each change, expires the item`
  - `settings — an intervalMinutes change reschedules the sweep timer; another setting does not`
  - `openJobRow — table`: none running with a `last` record resumes with no owner; running with a `last` record
    resumes that record; running with none refuses `The job is still running`; none running and no record refuses
    `No transcript for that job`
  - `openJobRow — a close for a row neither running nor last keeps no record`
  - `openJobRow — last.rowId nulled at a job end with no record, and at start when job-rows.json lacks it`
  - `openJobRow — records kept at 20, newest first, a repeat row replacing its record`
  - `openJobRow — an unreadable job-rows.json logs, starts empty and is never written`
  - `dispose — stops the watch and timers before awaiting the runner, then the record writes and the store`
  - `fixture — seed gives 7 items, 7 cards, 3 suggestions and badge 1`
  - `fixture — a seeded drive run keeps its 3 suggestions past the start sweep's end`
  - `reseed — a write of the reseed file in selfTest seeds again; outside selfTest nothing watches it`

Done when: `npm run typecheck` and `npm run lint` pass, the tests above pass, and `npm run selftest -- --plugin work`
passes in the test gate. Runtime checks of the views over this data defer to task 14 (Final verification), seeded
through `work.seed`.
Commit: one commit for the group.

## Proof

