# 09 — Wire the work plugin, fixture and self-test

Status: not started
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
- `workStateSlot`, `WorkJob`, `WorkChannel`, `WorkSendArg`, `WorkMoveArg`, `WorkStartArg`, `WorkColumnSetting` in
  `src/plugins/work/contract.ts`, and the manifest's settings (`profile`, `intervalMinutes`, `columns`, `signals`,
  `repoFolders`, `projects` and the job-text settings) in `src/plugins/work/manifest.ts` ← 04
- `createWorkStore`, `WorkStore` (`file`, `update`, `onChange`, `settled`), `WorkFile`, `EMPTY_WORK_FILE` in
  `src/plugins/work/main/store.ts` ← 04
- `createJobRunner`, `JobRunnerDeps`, `JobRunner` (`start`, `enqueue`, `jobOf`, `report`, `dispose`), `JobOutcome` in
  `src/plugins/work/main/job-runner.ts` ← 05
- `WORK_TOOLS`, `startWorkTools`, `WorkToolsDeps` in `src/plugins/work/main/work-tools.ts`, and `WORKER_INSTRUCTIONS`,
  `jobMessage`, `JobTextSettings` in `src/plugins/work/main/job-text.ts` ← 06
- `detectSuggestions`, `SeenSignal` in `src/plugins/work/main/detection.ts`, and `createSignalWatch`, `SignalWatch`
  in `src/plugins/work/main/signals.ts` ← 07
- `dismiss`, `restore`, `snooze`, `send`, `addToBoard`, `moveCard`, `acceptSuggestion`, `notYet`, `deleteTask`,
  `jobEnded`, `nextSnoozeEnd`, `isRefusal`, `ActionResult`, `Refusal` in `src/plugins/work/main/actions.ts`;
  `startFromWork`, `linkSession`, `SpinUpResult` in `src/plugins/work/main/spin-up.ts`; and `WorkStartResult`,
  `WorkLinkArg` and the channel's `linkSession` in `src/plugins/work/contract.ts` ← 08
- From the tree:
  - `ChatMainExports.restored`, `resume`, `launch`, `close`, `projects`, `defaultProfile`, `ChatMainEvents.sessionClosed`,
    `ResumeRequest`, `chatSessionSlot` (`src/plugins/chat/contract.ts`)
  - `SessionsMainExports.contributeTools`, `setTitle`, `sessionsRowsSlot`, `editableTitle` (`src/plugins/sessions/contract.ts`)
  - `unityPoolSnapshotSlot` (`src/plugins/unity-pool/contract.ts`)
  - `MainApi.channel.handle`, `MainApi.drive`, `MainPart.ready`, `MainServices.runMode`, `selfTest`, `randomUuid`,
    `alerts`, `git`, `clock`, `timers`, `homeDir`, `paths` (`src/contracts/plugin.ts`)
  - `Alerts.setOpenCount` (`src/contracts/alerts.ts`), `SelfTestScript`, `SelfTestGroup`, `PageBind`

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
```

`start.ts` keeps 04's part signature. Every command runs in the page (04), so main handles the channel and returns no
command handlers.

Decisions:
- **Start order (`start.ts`)**, after 04's store, slot and load:
  1. Create the runner with `createJobRunner` (05). Its deps:
     - `chat`, `sessions`, the `sessions.rows` and `chat.session` readers, `api.events`, `api.data`, the store,
       `clock`, `timers`, `log` and `homeDir`
     - `profile: () => api.settings().profile`
     - `instructions: () => [WORKER_INSTRUCTIONS]`
     - `message: (job) => jobMessage(job, api.settings(), store.file())`. The settings object holds every
       `JobTextSettings` field.
     - `ended: (job, outcome) => …` (Job ends, below)
  2. Contribute the tools: `sessions.contributeTools(WORK_TOOLS, startWorkTools({ jobOf: runner.jobOf, report:
     runner.report, store, columns: () => api.settings().columns, clock }))`. Bind the two runner methods to the
     runner.
  3. Create the signal watch (07) with `services.git`, `services.pullRequests`, `chat`, the `chat.session`,
     `sessions.rows` and `unity-pool.snapshot` readers, `repoFolders: () => api.settings().repoFolders`,
     `cards: () => store.file().cards`, `homeDir`, `paths`, `clock`, `timers`, `log`, and `onSeen: redetect`.
  4. Create the sweep timer, with `sweep` enqueueing a sweep (Commands).
  5. Handle every `WorkChannel` method through `api.channel.handle` (Commands).
  6. Register the drive action when `api.drive` is not null, and hand the self-test script when `services.selfTest`
     is not null.
  7. When `runMode` is not `selfTest`, the part's `ready()` awaits `chat.restored()`, then calls `runner.start()` and
     enqueues one sweep. That is the start sweep (design § The worker, "When").
  8. In `selfTest`, `runner.start()` is never called. Presses and sweeps queue, and no worker launches ("Demo and
     self-test use sample data and launch no worker"). A drive run is not `selfTest`, so it launches on the fake
     harness as live does.

  `dispose` disposes the watch, the timers and the tools, then awaits `runner.dispose()`, then 04's
  `store.settled()`.
- **`work.state` is 04's build.** 04 republishes `buildWorkState` on every store change and settings change. The
  slot's `job` is the store's `job`, which 05 writes. The slot's `suggestions` are the store's `suggestions`, which
  this task writes from detection. This task publishes nothing itself.
- **Detection write-back (`redetect`).**
  - It computes `detectSuggestions({ cards, seen: watch.latest(), signals: api.settings().signals,
    columns: api.settings().columns, notYet })` over `store.file()`.
  - When the result equals `store.file().suggestions` (compared as JSON), it does nothing. Otherwise it runs
    `store.update`, whose change runs detection again over the file it is given and sets `suggestions`.
  - The equality check comes first because every update fires `onChange`, which runs `redetect` again. A second run
    finds them equal and stops.
  - It runs on each store `onChange`, on `onSettingsChanged`, and on each `onSeen`.
- **The Dock badge.** On every store change, `services.alerts.setOpenCount('work', n, noun)`, where `n` counts the
  items with `section === 'needs_you'` and `state === 'open'`. Each change of `n` logs `needs you: <n>`. Stopping the
  plugin zeroes it (the alerts service does that).
- **Snooze ends.** After every store change, one one-shot timer is armed at `nextSnoozeEnd(store.file())`, replacing
  the last one. When it fires, it runs `store.update((f) => jobEnded(f, { kind: 'sweep' }, { ok: true, note: null },
  clock.now()))`, which is `expireSnoozes` (08).
- **Commands.** Each `WorkChannel` method's main handler follows one shape:
  1. Run the action from 08 inside `store.update`, over the file the update is given. A `Refusal` makes the change
     throw, so the file and listeners stay as they were (04).
  2. On a refusal, log `refused <method>: <refused>` and reject with an `Error` whose message is the refusal text.
     04's page handler returns that rejection, and the view toasts it (10, 11).
  3. Otherwise log the result's `log` line. When `ActionResult.job` is not null, enqueue it with `runner.enqueue`.
  4. The handler never awaits `runner.enqueue`: in `selfTest` the runner's chain never begins. It catches a rejection
     and logs `job not queued: <errorText>`.

  Specific methods:
  - **`sweep`** enqueues `{ kind: 'sweep' }` and logs `sweep queued`. 05's queue drops a second queued sweep. The
    runner gives no sign of the drop, so this part logs nothing for it.
  - **`send`** passes its `WorkSendArg`. **`dismiss`**, **`restore`** and **`snooze`** pass the item id, and `snooze`
    passes `clock.now()`.
  - **`addToBoard`** passes the new id `local-<services.randomUuid()>` and `work.columns`.
  - **`moveCard`** passes its `WorkMoveArg`, `work.columns` and `clock.now()`. **`acceptSuggestion`** passes the card
    id, `work.columns` and `clock.now()`. **`notYet`** and **`deleteTask`** pass the card id.
  - **`startSession`** runs `startFromWork` over `store.file()`, with `projects: () => api.settings().projects`. A
    refusal rejects as above. A `launched` result stores `linkSession(f, { cardIds, sessionId: rowId })` and
    resolves to `{ kind: 'launched', toast }`. A `prompt` result resolves as it is.
  - **`linkSession`** (a channel method with no command, 08) stores `linkSession(f, arg)`.
- **Job ends** (05's `ended(job, outcome)`, which runs after 05 has written `job.last` and `lastSweepAt`):
  1. `store.update((f) => jobEnded(f, job, outcome, clock.now()))` (08). This clears a send's `sending` and returns a
     failed send's item to open. It clears a move's `movingTo` and sets its note. A sweep's end expires snoozes.
  2. For a sweep, done or failed: `sweepTimer.sweepEnded()` and `watch.refresh()`.
- **`openJobRow`:**
  - **A job still running** (`store.file().job.running` not null) refuses with `The job is still running`. The row
    has an owner and no side-bar place.
  - **A finished job** is `store.file().job.last`. Its `rowId` names a record in `job-rows.json`. The handler resumes
    that saved session with no owner through `chat.resume({ projectDir, profile, hostSessionId, title })`. That opens
    a visible, selected row where the user reads the transcript.
  - **The records.** This part listens on `chat.sessionClosed`. For each event whose `sessionId` is the `rowId` of
    `store.file().job.running` or `job.last`, read when the event arrives, it keeps `{ rowId: sessionId, hostSessionId, projectDir, profile,
    title: editableTitle(titles) }` from the event. The newest 20 records stay in plugin data, `job-rows.json`, so a
    link survives a restart.
  - **No `last`, a null `rowId`, or no record** refuses with `No transcript for that job`.
- **Sweep timer (`sweep-timer.ts`):**
  - `sweepEnded` clears any armed timer and arms one for `intervalMinutes`. A non-zero value below
    `MIN_SWEEP_MINUTES` counts as `MIN_SWEEP_MINUTES`, and 0 arms nothing. When the timer fires, it calls `sweep()`.
  - Nothing is armed until the first sweep ends: the start sweep, or a `W`.
  - `reschedule` runs on a `work.intervalMinutes` change:
    - With interval 0, it clears the timer.
    - With no sweep ended yet, it does nothing.
    - When the last end plus the new interval has passed, it sweeps at once.
    - Otherwise it arms for the time left, as plan-poller's `reschedule` does.
  - `dispose` clears the timer.
  - The interval runs from each sweep's end, not its start, so a slow sweep never stacks the next one behind it.
- **Fixture (`selftest-fixture.ts`)** is sample data, with no disk outside plugin data:
  - **Items:** seven. Six are `open`, one per section. The seventh is a dismissed `needs_you` item, for All and
    Restore.
  - **Cards:** six Jira cards, one per default column plus one with an unmapped status, and one local task. Each Jira
    card has `column: ''`, `reachableStatuses: null`, `movedAt: null`, and no link.
  - **Signals:** three `SeenSignal`s:
    - `WRK-2` gets a branch signal: a `suggested` move from Todo to In Progress.
    - `WRK-3` gets an open PR: a `suggested` move from In Progress to In QA.
    - `WRK-5` gets a merged PR while in Done: a `done` entry.
  - The rest of the file is `EMPTY_WORK_FILE`'s.
- **Seeding** (`seed`):
  1. `await store.update(() => fixtureFile(clock.now()))`, which replaces the whole file.
  2. `watch.seed(fixtureSignals(clock.now()))`, whose `onSeen` runs `redetect`.
  3. `await store.settled()`, then log `fixture seeded: <items> items, <cards> cards, <suggestions> suggestions` from
     `store.file()`.
  4. Resolve to the problems found: each count that differs from 7, 7 and 3, and a badge count other than 1.

  The self-test script's `open` runs it on each run. The drive action `work.seed` (args `{}`, description
  `Replaces the work store with the self-test fixture and seeds its signals.`) runs it for task 14. Both exist only
  outside a live run, so neither reaches the user's real data. Each run's home is a temp home.
- **The self-test script covers the data plugin.** It drives work's commands through its own `pageBinds` in scope
  `any`, under `Space z k`. No built-in key uses that prefix, and leader sequences sit outside the placement check. It
  checks main's `[work]` log lines. The binds carry each command's argument in the shape 04's manifest declares: an
  item id, a card id, a `{ itemId, text }` record, or a `{ cardId, column }` record. Task 13 adds the view groups
  (`inbox keys`, `board keys`) to this script once 12 has registered the views.

Pinned values:
- `MIN_SWEEP_MINUTES = 1`
- Alerts: source `'work'`, noun `{ singular: 'Slack item that needs you', plural: 'Slack items that need you' }`
- `job-rows.json` keeps 20 records, newest first.
- Log lines, under `[work]`:
  - `sweep queued`
  - `needs you: <n>`
  - `refused <method>: <refusal>`
  - `job not queued: <errorText>`
  - `fixture seeded: <i> items, <c> cards, <s> suggestions`
  - 08's action lines
- Refusals: `The job is still running`, `No transcript for that job`, and 08's.
- Fixture items, as `id` · `section` · `state` · `ticketKeys`. Each has a title, summary, author, channel, `at` and
  url in plain sample words, `firstSeen` at `now`, and the other nullable fields null. The `needs_you` and `waiting`
  items carry a draft:
  - `fixture-needs-you` · `needs_you` · `open` · `['WRK-1']` · draft `Yes, I'll take a look today.`
  - `fixture-promised` · `promised` · `open` · `[]`
  - `fixture-waiting` · `waiting` · `open` · `[]` · draft `Any news on this?`
  - `fixture-my-thread` · `my_threads` · `open` · `[]`
  - `fixture-around` · `around` · `open` · `['WRK-3']` · why `Mentions WRK-3`
  - `fixture-worth-knowing` · `worth_knowing` · `open` · `[]` · why `Release freeze starts Friday`
  - `fixture-dismissed` · `needs_you` · `dismissed` · `[]`
- Fixture cards, as `key` · `jiraStatus`:
  - `WRK-1` · `Backlog`
  - `WRK-2` · `To Do`
  - `WRK-3` · `In Progress`
  - `WRK-4` · `In Review`
  - `WRK-5` · `Done`
  - `WRK-6` · `Blocked` (Other)
  - local `fixture-task`: column `Todo`, `sourceItemId` `fixture-promised`
- Fixture signals, each `at` one hour before `now`:
  - `branch` `wrk-2-board`, `keys: ['WRK-2']`, reason `Branch wrk-2-board in fixture-repo`
  - `pr_opened` #12 `WRK-3 tidy`, head `wrk-3-tidy`, `keys: ['WRK-3']`, `prState: 'open'`
  - `pr_merged` #9 `WRK-5 ship`, head `wrk-5-ship`, `keys: ['WRK-5']`
- Self-test binds, scope `any`, each keys `' ', 'z', 'k', <key>`:

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
  data.
  - **`inbox`**. Why: each Inbox press changes the item in main and logs it, and the badge follows Needs you.

    | keys | expect | also expect |
    |---|---|---|
    | `Space z k d` | `[work] dismissed fixture-needs-you` | `[work] needs you: 0` |
    | `Space z k r` | `[work] restored fixture-needs-you` | `[work] needs you: 1` |
    | `Space z k z` | `[work] snoozed fixture-waiting for 1 day` | |
    | `Space z k s` | `[work] send queued fixture-needs-you` | `[work] needs you: 0` |

  - **`board`**. Why: a local task moves at once, Not yet hides a suggestion, Accept queues a Jira move, and a Jira
    card refuses delete.

    | keys | expect |
    |---|---|
    | `Space z k a` | `[work] added fixture-my-thread to the board` |
    | `Space z k A` | `[work] refused addToBoard: Already on the board as WRK-3` |
    | `Space z k m` | `[work] moved fixture-task to In Progress` |
    | `Space z k n` | `[work] not yet WRK-2` |
    | `Space z k y` | `[work] moving WRK-3 to In QA` |
    | `Space z k x` | `[work] deleted fixture-task` |
    | `Space z k X` | `[work] refused deleteTask: Only a local task can be deleted` |

  - **`sweep`**. Why: in the self-test a sweep queues and no worker launches.

    | keys | expect |
    |---|---|
    | `Space z k w` | `[work] sweep queued` |

GIVEN `intervalMinutes` 10 WHEN a sweep ends at t THEN the next sweep queues at t + 10 min, and WHEN the setting changes to 0 THEN no timer is armed
GIVEN the app starts live WHEN chat's restore settles THEN `runner.start()` runs and exactly one sweep is enqueued
GIVEN the self-test WHEN `Space z k w` is pressed THEN the sweep queues and no session launches
GIVEN a send job fails WHEN 05 calls `ended` THEN the item is open again with `Send failed: <note>`, and the badge counts it
GIVEN the seeded fixture WHEN `work.notYet` runs on `WRK-2` THEN its suggestion leaves the slot and stays out after the next `redetect`

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
  - `start — one sweep after chat.restored, none in selfTest`
  - `start — runner.start only outside selfTest`
  - `redetect — writes suggestions only when they differ, and stops`
  - `badge — counts open needs_you items and logs each change`
  - `commands — each refusal is logged and rejects with its text` (a table over every channel method)
  - `commands — a press job is enqueued, unawaited`
  - `startSession — launched links the cards and resolves the toast; prompt resolves as it is`
  - `jobEnded — sweep end arms the timer, refreshes signals and expires snoozes`
  - `jobEnded — failed send and failed move restore the item and card`
  - `openJobRow — running refuses, closed resumes with no owner, unknown refuses`
  - `fixture — seed gives 7 items, 7 cards, 3 suggestions and badge 1`

Done when: `npm run typecheck` and `npm run lint` pass, the tests above pass, and `npm run selftest -- --plugin work`
passes in the test gate. Runtime checks of the views over this data defer to task 14 (Final verification), seeded
through `work.seed`.
Commit: one commit for the group.

## Proof

