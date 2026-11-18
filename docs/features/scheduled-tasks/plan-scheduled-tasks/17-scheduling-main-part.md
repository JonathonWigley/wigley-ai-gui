# 17 — Scheduling main part

Status: done
Type: Task
Wave: 4 · Depends on: 05, 06, 10, 11, 12, 13, 14, 15
Plan: [plan.md](plan.md)

Files:     create `src/plugins/scheduling/main/start.ts` · test `src/plugins/scheduling/main/start.test.ts` ·
           create `src/plugins/scheduling/main/run-records.ts` · test `src/plugins/scheduling/main/run-records.test.ts` ·
           modify `src/plugins/main.ts`
Consumes:  `SessionsMainExports.offlineEnv()`, `SessionsMainExports.replayCalls(hostSessionId)` ← 05 ·
           `MainServices.loginStart: LoginStart`, `LoginStart.set(on)`, `LoginStartStatus` ← 06 (types ← 03, see
           03's Decisions); the part harness's default fake `loginStart` ← 06 ·
           `AgentHarness.startControls()`, `AgentHarness.capControls(controls, cap)` ← 08 ·
           `planRuns`, `PlannedRun` in `src/plugins/scheduling/main/planner.ts` ← 10 ·
           `createTaskStore`, `TaskStore`, `createHistoryStore`, `HistoryStore` ← 11 ·
           `layouts/layout.d.ts` in `src/plugins/scheduling/` ← 12 (imported `?raw`, as auto-retro's main part does) ·
           `SessionHost.setPending`, `SessionHost.listRuns`, `SessionHost.forgetRuns`, `SessionHost.onRunStarted`,
           `SessionHost.onConnected`, `PendingSpawn`, `HostedRun` ← 13 (types ← 07); `createFakeSessionHost()` with
           the queue members and `connectAgain` ← 13 ·
           `ChatMainExports.prepareLaunch(request, env)`, `ChatMainExports.adopt(run)`, `AdoptRequest`,
           `PreparedLaunch`, `LaunchRequest.controls` ← 14 · `ChatMainExports.projects(): readonly ChatProject[]`, `ChatMainExports.onInstructionsChanged(listener)` ← 14 ·
           `RunHistoryEntry.viewed` ← 03 · `HistoryStore.update`, `TaskStore.settled`, `HistoryStore.settled` ← 11 ·
           `TASK_TOOLS`, `startTaskTools`, `TaskToolsDeps` ← 15 ·
           every scheduling contract name ← 03 ·
           tree: `chatMainKey`, `chatSessionSlot`, `chatControlsSlot`, `ChatMainEvents` (`turnFinished`),
           `CHAT_HARNESS_ID`, `ChatMainExports.profiles()`, `.profileOf()`, `.defaultProfile()`, `ChatSessionInfo.headless`
           in `src/plugins/chat/contract.ts`; `sessionsMainKey`, `sessionsRowsSlot`, `sessionsSelectionSlot`,
           `followRows`, `SessionsMainExports.holdConnects(until)`, `SessionRow.hostSessionId` in
           `src/plugins/sessions/contract.ts`; `services.alerts.setOpenCount(source, count, noun)` with `AlertNoun`
           (`src/contracts/alerts.ts`), `services.appInstance.isDev`, `services.runMode`, `services.agentHarnesses`, `api.data`,
           `api.channel.handle`, `api.state.publish`, `api.layouts.register` in `src/contracts/plugin.ts`; `errorText`
           in `src/shared/error-text.ts`; `startMainPart`, `fakeDependency` in
           `src/shared/plugin-part-harness.test-support.ts`
Produces:  in `src/plugins/scheduling/main/start.ts`:
           `export const schedulingMainPart: MainPart<typeof schedulingManifest>`
           inside it, the step for one host run, `adoptRun(run: HostedRun): Promise<void>` (Decisions, Handling a host
           run), which it hands with the task store to 19 (plan.md § Shared names, Main part hand-over)
           in `src/plugins/scheduling/main/run-records.ts`, as plan.md § Shared names › Run records gives it:
           ```ts
           // What a `PendingSpawn.record` holds for a scheduled run.
           export interface ScheduledRunRecord {
             taskId: string;
             occurrence: number;
             adopt: AdoptRequest;
           }
           // The record, or null when `record` is not a scheduled run's.
           export function readRunRecord(record: unknown): ScheduledRunRecord | null;
           // `rowId` is the sessionId `chat.adopt` resolved to; null for a skipped or failed run.
           export function runEntry(run: HostedRun, record: ScheduledRunRecord, rowId: string | null): RunHistoryEntry;
           ```
           `runEntry` gives `skipped` for a skipped run and `failed` for one whose `exit.error` is set, both with
           ids null and `viewed` true. The failed reason (pinned): `could not start the agent in <projectDir>:
           <error>`, with `<projectDir>` from `record.adopt.projectDir` and `<error>` the raw `exit.error` (08 sends
           no hint, so `spawn <command> ENOENT` arrives as is); when `<error>` holds `ENOENT`, the reason is `could
           not start the agent in <projectDir>: the folder or the agent command is missing (<error>)`; else `running` with `rowId`, the record's `processId` and
           `viewed` false.
           in `src/plugins/main.ts`: `schedulingMainPart` in the built-in main parts, after `autoRetroMainPart`

## Decisions

`start.ts` only wires: the time rules are the planner's (10), the files the stores' (11), the tools' rules 15's, the
launch and adopt rules chat's (14). It copies no chat rule. Every event, push, timer and channel call that changes
state runs as one step of a serial chain, as `src/plugins/auto-retro/main/start.ts` does, so each step reads the state
the last one left.

**Who fires.** `fires = !services.appInstance.isDev || services.runMode !== 'live'` (plan.md). Where `fires` is
false the part loads the stores, publishes the state with every `nextRun` null and `loginStart` null, serves the
channel and the tools, and never calls `setPending`, `listRuns`, `forgetRuns`, `onRunStarted`, `adopt` or
`loginStart.set`. The dev app's host folder is its own, so not calling `setPending` leaves the stable app's queue
alone.

**Start, where `fires`.**

1. Register the layouts (`api.layouts.register({ layoutTypes })` from `../layouts/layout.d.ts?raw`), publish the
   slot, handle the channel, contribute the tools (`sessions.contributeTools(TASK_TOOLS, startTaskTools(deps), {
   mainAgentOnly: true })`, no `offline`).
2. Load the task store (`configFolder` = `services.paths.join(services.homeDir, '.config', 'wigley-ai-gui')`, `log`
   the part's log) and the history store (`createHistoryStore(api.data, log)`). When the history store's `load`
   rejects, log `history.json not read: <reason>` and keep the part's start time (`clock.now()` at this step) as
   `catchUpFloor` for every plan of this start; else `catchUpFloor` is null. Reason: an unread history gives an empty
   `entries()`, and with no floor every task would fire a catch-up at each start while the file stays broken (10).
3. Subscribe `sessionHost.onRunStarted` and `sessionHost.onConnected`. Then read the runs: build the promise of
   `listRuns()` followed by `adoptRun` for each run, and hand it to `sessions.holdConnects` before `listRuns` is
   called, so the relay hello of a run not yet adopted waits and joins the adopted row instead of opening its own.
   Handle every listed run before the first plan. Reason: a run the host fired while the app was closed must be in
   history before the planner runs, or the planner plans a catch-up of that same occurrence and the task runs twice.
   When `listRuns` rejects, log `runs not read: <reason>`, plan nothing, and try step 3's read again after 10 000 ms.
4. Plan (below).
5. On each `onConnected` (a new host after a host death, an update or a login start), read the runs again as in
   step 3, inside `holdConnects`, as one step of the chain, then re-plan. Reason: runs a new host fired, or imported
   from an older host, while no app was connected reach the app only through `listRuns` (plan.md § Shared names).

**Handling a host run: `adoptRun(run)`** (from `listRuns` or a `runStarted` push, and 19's fixtures). Keep a set of
run ids handled in this start; a run id seen again is only forgotten again.

- `readRunRecord(run.record)` null: `forgetRuns([run.id])` and log `run <id> is not a scheduled run; forgotten`.
  Reason: only this plugin queues pending spawns, and a run left in the host keeps the host alive (07's exit rule).
- `skipped`, or `exit.error` set: `history.add(runEntry(run, record, null))`, then `forgetRuns([run.id])`, log,
  re-plan.
- Else: `chat.adopt(record.adopt)` (chat holds the connects, 14). On resolve with `rowId` (the sessionId adopt
  resolved to, which may differ from `record.adopt.rowId`): add `runEntry(run, record, rowId)` (running), log
  `adopted run of <task name> as <rowId>`, then apply the finished-at-adoption rule below (Rows and marks); then
  `sessions.replayCalls(record.adopt.hostSessionId)`, logging `replayed <n> calls for <rowId>` when n > 0; then
  `forgetRuns([run.id])`; then re-plan.
- **Finished at adoption.** `adopt` resolves after the attach settled (14), so the slot then reflects the replayed
  pipe log. A run read through `listRuns` is finished when `chatSessionSlot.get(rowId)` reads `running` false, or
  `activity` `'idle'`. A run heard through `onRunStarted` is finished only when the slot reads `running` false; while
  its process runs, it finishes at its row's first `chat.turnFinished`. Reason: a pushed run started moments ago, and
  its first turn cannot have ended, so an idle read there is only the attach racing the first `user` line. A listed
  run started while no app heard it, so its `in` lines are in the pipe log the attach replays (`foldPipeLine` in
  `session-fold.ts` folds `in` lines into the activity), and an idle read means its turn ended; its process stays
  alive after the turn, so `running` alone would never mark it. `adoptRun(run)` is the listed path (19's fixtures
  use it); the push handler runs the same step with the pushed rule.
- **Order against the tool callers.** `replayCalls` runs only after `adopt` resolved. `adopt` resolves once chat has
  noted the run's tool callers: through the attach replay for a running process, or through the history read for a
  resting row (14). Sessions skips a replayed main-agent-only call that no note names as the main agent's (05, 14).
  So a subagent's call is never applied as a main agent's (settled design).
  History is written before `forgetRuns`, so a quit between the two leaves the run in the host, and the next start
  finds it again rather than losing it.
- **A row already holds the host session id.** `adopt` then opens nothing and resolves to that row's sessionId:
  chat's held row, else the relay row (14). Every resolved id is the run's row. Handle it as any resolve, with one
  difference: when history already has an entry for that `taskId` and `occurrence` (an earlier start adopted the
  run and quit before `forgetRuns`, or a push and a `listRuns` named the same run), add no entry and keep the one
  there. Then replay, forget and re-plan as above.
- **A relay row.** When `chatSessionSlot.get(rowId)` is absent, the resolved row is a relay row: the run's process
  reached the app through its relay before an adopt, and chat holds no session for it, so `chat.turnFinished` never
  names it. Its run is finished at adoption (outcome `finished`, `viewed` false), whatever the push or list rule
  says. Reason: no later signal can mark it, and a run left `running` forever would never take the done mark; the
  row shows the relay's own activity, and the user views it as any run row.
- `adopt` rejects (only after chat's `detachAll`, or when chat could not open the row, 14). Log `run of <task name>
  not opened: <errorText>`. While this part is disposing (the app or plugin is stopping, so chat has detached), do
  nothing more: no entry, no `forgetRuns`, so the next start adopts the run. Otherwise add a `failed` entry with
  reason `not opened: <errorText>` and forget the run, so a row chat cannot open does not keep the host alive at
  every start.

**Planning** (on start, on each task store `onChanged`, after each handled run, on Run now, on each
`chat.onInstructionsChanged`, and on the one timer the prepare-throws case below sets; there is no other timer: the
host fires each run at its `at`, and its `runStarted` push or the next `listRuns` brings the re-plan):

- `planRuns({ tasks, history: history.entries(), runNow: <presses>, now: clock.now(), catchUpFloor })`; clear the
  presses.
- **Instructions change.** On each `chat.onInstructionsChanged` (14), drop every kept `PreparedLaunch` (Reuse,
  below), then re-plan, so each pending entry carries the instructions a live start would get. Subscribe in step 1
  through the part's consumer view, and only where `fires`.
- **Settings a prepare bakes in with no signal.** The `claude.command` path (08 reads it at prepare time; the harness
  gives no change signal, and no plugin hears that setting), and chat's profiles and projects settings, are held by
  a kept `PreparedLaunch` as they stood at its prepare. A change reaches a pending run at its next re-prepare: the
  next app start, edit of that task, task-file change or plugin reload. The design doc says so.
- For each planned run, build `LaunchRequest`: the task's `target` (a `projectDir` through
  `services.paths.expandTilde(…, services.homeDir)`), `profile`, `message: { text: task.prompt, images: [] }`,
  `headless: true`, `controls: task.controls`. No `unattended`: with the app open a prompt the mode does not allow
  waits with the row marked (settled design). No `owner`: an owned row takes no mark (`sessions.mark`), and a run row
  must take one. Then `chat.prepareLaunch(request, sessions.offlineEnv())`.
- **Reuse.** Keep the `PreparedLaunch` of each planned run keyed by `taskId`, `occurrence` and the task's
  `updatedAt`, and reuse it while that key is planned again; drop keys not planned. Reason: a re-plan for another
  task's edit then sends the same `spawn.id` for this task, and the host can tell a re-sent entry from a new one (07's
  `setPending` drops a pending entry whose `spawn.id` is in its runs record).
- **A prepare that throws.** When the run's `at` is now or earlier: add a `failed` entry (`occurrence`, `at` now,
  `reason` the error text), log `run of <task name> failed to start: <reason>`, and plan once more so the task's next
  occurrence queues. When `at` is later: queue nothing for the task and set one timer (`services.timers`) at `at` that
  re-plans; the run then fails or starts at its time. Reason: settled design records a failed start as history; a
  folder missing now may exist at the run's time.
- `services.sessionHost.setPending(entries)`, every time, an empty list included: each entry `{ at, spawn:
  prepared.spawn, record: { taskId, occurrence, adopt: prepared.adopt }, skipWhileBusy }`. Log `queued <n> runs`.
- **Login start.** `want` is true when any task is active: not paused, with a planned run, the timer case of a
  prepare that throws included (so `want` is `planned.length > 0`, read before the prepares). Reason: settled design,
  the host starts at login "while any task is active"; a task whose folder is missing now still waits for its time,
  and a spent one-time task fires nothing more. Call `services.loginStart.set(want)` at the first plan of each start,
  `want` false included, and whenever `want` changes, once per change and not once per plan; publish its status as
  `loginStart`. Reason: `set` rewrites a registration that differs from this build's, so the first call after an
  app update fixes it.
- `nextRun` of each task view is its planned run's `at` (the timer case included); null when not planned.

**Rows and marks.**

- A **run row** is an open row (`sessionsRowsSlot`) whose `sessionId` is the `rowId` of a history entry with outcome
  `running` or `finished`. `runRows` lists them by that entry's `at`, oldest first. A row restored under a new row id
  is not a run row; the design accepts this, since chat restores a row under its saved id unless another row holds it.
- A run is **finished** at its row's first `chat.turnFinished` (any `how`), at adoption by the finished-at-adoption
  rule (Handling a host run), or when its row closes. Update the entry's outcome to `finished`. Reason: plan.md (finished means first turn
  ended); a closed row's run cannot be running.
- A finished run's row is **unviewed** until `sessionsSelectionSlot` names it: the entry's `viewed` stays false,
  and the selection naming the row updates it to `viewed: true` through `history.update`. A run that finishes while
  its row is selected is updated to `finished` and `viewed: true` in one update. The mark is the history file's, so
  it survives an app restart (plan.md § Shared names, `RunHistoryEntry.viewed`); nothing is kept in memory. A row
  restored at start whose entry is still `running` and whose session reads not running is updated to `finished`.
- `unviewedRows` lists the open rows whose entry is `finished` with `viewed` false, by the entry's `at`. A row that
  closes leaves it, as it leaves `runRows`; its entry keeps its `viewed`.
- Each state publish calls `services.alerts.setOpenCount('scheduling', unviewedRows.length, { singular: 'finished
  scheduled run', plural: 'finished scheduled runs' })`. The words are pinned: the Windows overlay prints
  `<count> <singular|plural>`.

**Channel handlers.**

- Each handler returns as `SchedulingChannel` gives it (plan.md): `saveTask` the id, `setPaused` and `removeTask`
  nothing.
- `saveTask(draft)`: rejects with `No profile <name>.` when `draft.profile` is not in `chat.profiles()`, with `No
  project <name>.` for a `project` target not in `chat.projects()`, and with `Project <project> runs under its own
  profile <own>.` (15's text) when that project has its own profile and `draft.profile` differs; else
  `taskStore.save(draft)`. Reason: chat's `prepareLaunch` refuses that profile (14), so the task would fail at every
  run. The user's own controls are not capped.
- `setPaused`, `removeTask`: the store's.
- `runNow(id)`: throws `This app never fires scheduled tasks; Run now works in the installed app.` where `fires` is
  false; `No scheduled task <id>.` for an unknown id; `<name> is paused.` for a paused task. Else adds the press and
  re-plans.
- `editorChoices()`: `{ profiles: chat.profiles() names, projects: chat.projects() names, controls:
  harness.startControls() }`, where `harness` is the entry of `services.agentHarnesses` whose `id` is
  `CHAT_HARNESS_ID`, found as `src/plugins/chat/main/lookups.ts` finds it.

**Tool deps** (15): `views` built at call time from `taskStore.tasks()`, `history.entries()` and the last plan's
`nextRun` per task, the same function that builds the published views (not the last published state, since a tool
must see its own write before the chain re-publishes), `save` and `remove` from the task store, `isRunRow` from
`runRows`, `profileOf` and `defaultProfile` from chat, `profileNames` as for `editorChoices`, `projects` from
`chat.projects()`, `controlIds` the ids of the harness's `startControls()`,
`sessionControls(rowId)` = each control in `chatControlsSlot.get(rowId)` with a non-null `value`, by id;
`capControls` the harness's; `isAbsolute` and `stat` from `services.paths` and `services.files`; `log`.

**Dispose.** Await the chain. On `stop === 'end'` where `fires`: `setPending([])` and `loginStart.set(false)`, since a
switched-off plugin fires nothing. On `restart` and `quit`: leave the host's queue and the login start, so runs fire
while the app is quit. Then call the task store's `dispose()` and await both stores' `settled()`.

**Self-test.** No `runMode` branch here beyond `fires`. Task 19 adds the self-test script handover to this file,
handing `adoptRun` and the task store to `schedulingSelfTestScript`. Keep `adoptRun` a named function in the part's
closure so that edit is one line.

**Log lines (pinned; task 21 waits on them).** Under the plugin's id, so they show as `[scheduling] …`:
`queued <n> runs` · `adopted run of <task name> as <row id>` · `skipped run of <task name>: its previous run is still
going` · `run of <task name> failed to start: <reason>` · `run of <task name> not opened: <reason>` · `replayed <n>
calls for <row id>` (only when n > 0) · `runs not read: <reason>`. `<task name>` is the task's name, or its id when
the task is gone. plan.md § Shared names › Main part log lines holds the same list.

GIVEN the stable app with one active and one paused task WHEN the part starts THEN it calls `setPending` with one
entry for the active task and `loginStart.set(true)`
GIVEN the dev app in a live run WHEN the part starts THEN it never calls `setPending`, `listRuns` or `loginStart.set`,
and the state reads `fires: false`
GIVEN the host ran today's 09:00 while the app was closed WHEN the part starts at 12:00 THEN it adopts the run, writes
its history entry, and its first `setPending` holds tomorrow's 09:00, not a second 09:00
GIVEN a pushed run WHEN the part handles it THEN it calls adopt, adds the entry, replays the calls, forgets the run
and re-plans, in that order
GIVEN a task whose folder is missing and whose run is due WHEN the part plans THEN history holds a failed entry with
the error text and the next occurrence queues
GIVEN a run row WHEN its first turn finishes while another row is selected THEN the row is in `unviewedRows` and the
alert count is 1, and selecting the row clears both
GIVEN a finished, unviewed run row WHEN the app restarts and the part starts again THEN the row is in `unviewedRows`
and the alert count is 1
GIVEN a connected app WHEN the host client connects to a new host that lists a run THEN the part adopts it inside
`holdConnects` and re-plans
GIVEN the plugin is switched off WHEN its part disposes with `end` THEN it sends `setPending([])` and
`loginStart.set(false)`
GIVEN a history.json that fails to load and a daily task last edited three days ago WHEN the part starts at 12:00
THEN its first `setPending` holds tomorrow's 09:00, not a catch-up
GIVEN a pushed run whose process runs and whose slot reads idle at adoption WHEN the part adopts it THEN its entry
stays `running` until the row's first `turnFinished`
GIVEN the only active task is paused WHEN the part re-plans THEN it calls `loginStart.set(false)` once

## Tests

`start.test.ts`, through `startMainPart` with `fakeDependency` for chat and sessions (as
`src/plugins/auto-retro/main/start.test.ts` does), `createFakeSessionHost()` for `sessionHost`, the harness's fake
`loginStart`, memory files for the config folder and plugin data, and fake timers and clock. `prepareLaunch` in the
chat fake returns a `PreparedLaunch` whose ids carry a counter, so a test sees a fresh prepare. The chat fake also
implements `restored()` (resolving at once), which `ChatMainExports` now has; check `fakeDependency`'s typing, since a
full `ChatMainExports` fake fails to type-check without it.

- `start_FiresRule_QueuesOrNot` — `it.each` of `{ isDev, runMode, fires }`: `false, 'live'` → fires; `true, 'live'` →
  no fire; `true, 'drive'` → fires; `true, 'selfTest'` → fires. A fire row asserts one `setPending` call; a no-fire
  row asserts none and no `listRuns`, `loginStart.set` or `onRunStarted`, and `fires: false`, `loginStart: null`,
  `nextRun: null` in the state.
- `start_Tasks_QueuesOnePendingEntryPerPlannedTask` — two tasks, one paused: one entry; its `record` holds the task
  id, occurrence and the prepared `adopt`; `prepareLaunch` saw `headless: true`, the task's controls, the prompt as
  `message.text`, the tilde-expanded folder, no `unattended`, no `owner`, and `env` equal to `offlineEnv()`;
  `loginStart.set(true)`; log `queued 1 runs`.
- `start_HostRanWhileClosed_RecordsBeforeTheFirstPlan` — `listRuns` answers a run of today's 09:00 at 12:00: the first
  `setPending` holds tomorrow's 09:00. (Break caught: a plan before the runs are handled.)
- `start_ListRunsRejects_RetriesAndPlansNothing` — no `setPending` until the retry after 10 000 ms succeeds.
- `start_HoldsConnectsBeforeTheFirstListRuns` — the sessions fake's `holdConnects` was called before the host fake
  saw `listRuns`, and its promise settles after the listed run's `adopt`.
- `start_Reconnect_ListsRunsAgain` — the host fake's `connectAgain` after a `startRun` that pushed nothing to the part
  (the run added before the part subscribed): a second `listRuns`, the run adopted inside a second `holdConnects`, a
  `setPending` after it.
- `run_Pushed_AdoptsRecordsReplaysForgetsAndReplans` — one call log across the fakes: `adopt`, history add,
  `replayCalls(hostSessionId)`, `forgetRuns([id])`, `setPending`.
- `run_Outcome_WritesHistory` — `it.each` of `{ run, adopt, expected entries }`: skipped → `skipped`, no adopt;
  `exit.error` → `failed` with that reason, no adopt; adopt resolves to another id than `record.adopt.rowId` and the session
  reads idle → `finished`, `viewed` false, `rowId` the resolved id; adopt rejects → `failed` with `not opened:`
  and the log line; adopt rejects while the part disposes → the log line only, no entry, no `forgetRuns`; adopt resolves to a relay row (no chat session) → `finished`, `viewed` false,
  `rowId` the relay row's id; adopt resolves to a held row and history already has the entry → no new entry; listed, process running, slot idle → `finished`; pushed, process
  running, slot idle → `running`; pushed, process gone → `finished`. Every row but the disposing rejection asserts `forgetRuns([id])`. The
  skipped row also asserts the log line `skipped run of <task name>: its previous run is still going`, the
  `exit.error` row `run of <task name> failed to start: <reason>`, and a row whose `replayCalls` fake answers 1
  `replayed 1 calls for <row id>`.
- `start_HistoryLoadFails_PlansWithNoCatchUp` — the history file is not JSON: the `history.json not read:` log line,
  and the first `setPending` holds the next occurrence, not a catch-up.
- `plan_WantChanges_SetsLoginStartOnceAndPublishesStatus` — `it.each`: start with one active task → one
  `set(true)`; start with only paused tasks → one `set(false)`; pause the only task → one `set(false)`; resume → one
  `set(true)`; two re-plans with no change of `want` → no further `set`; the fake answers `needsApproval` → the
  state's `loginStart` holds it.
- `plan_InstructionsChange_PreparesAgain` — the chat fake fires `onInstructionsChanged`: the next `setPending`
  holds a new `spawn.id` for an unchanged task (the kept `PreparedLaunch` was dropped).
- The spawn-error reason rows are in `runEntry_Run_GivesTheEntry` (`run-records.test.ts`, below).
- `tools_ViewsReadTheStoresAtCallTime` — `views()` right after a `save` resolves holds the new task before the chain
  re-publishes.
- `run_NotAScheduledRecord_IsForgotten`; `run_SameIdTwice_IsHandledOnce`.
- `plan_PrepareThrows_RecordsFailedOnlyWhenDue` — due: a failed entry with the thrown text, and the task's next
  occurrence in the next `setPending`; future: no entry, no pending entry for the task, and after the fake timer
  reaches `at` a new prepare.
- `plan_UnchangedOccurrence_ReusesThePreparedLaunch` — adding a second task keeps the first entry's `spawn.id`;
  editing the first task changes it.
- `runNow_Press_QueuesAtNow` and `runNow_Refused_Throws` (`it.each`: dev app, unknown id, paused task, each with its
  pinned text).
- `rows_FinishAndView_TrackUnviewedAndAlerts` — `chat.turnFinished` on a run row: outcome `finished`, the row in
  `unviewedRows`, alert count 1; selection names it: both cleared; a second run row finishing while selected: not
  unviewed. The alert call also carries the pinned noun. A second part started over the same memory files: the first row's entry reads `viewed` as the first
  part left it.
- `rows_RunRowCloses_IsFinishedAndLeavesRunRows`.
- `saveTask_UnknownProfileOrProject_Rejects` — `it.each` of the three pinned texts (unknown profile, unknown
  project, another profile than the project's own); no write.
- `editorChoices_ReadsChatAndTheHarness`.
- `dispose_Stop_ClearsQueueOnlyOnEnd` — `it.each` over `end`, `restart`, `quit`.
- `tools_AreContributedMainAgentOnly` — the sessions fake recorded `TASK_TOOLS` with `{ mainAgentOnly: true }`.

`run-records.test.ts`:

- `readRunRecord_Value_ReadsOrRefuses` — `it.each`: a full record → it; `null`, a string, a record missing `adopt`, a
  record whose `occurrence` is a string, an `adopt` missing `rowId` → null.
- `runEntry_Run_GivesTheEntry` — `it.each`: skipped → `skipped`, `reason` null, ids null, `viewed` true, `at` the
  run's `startedAt`; `exit.error` `spawn x EPERM` with `projectDir` `/p` → `failed`, reason `could not start the
  agent in /p: spawn x EPERM`, ids null, `viewed` true; `exit.error` `spawn claude ENOENT` → reason `could not start
  the agent in /p: the folder or the agent command is missing (spawn claude ENOENT)`; `exit` null with `rowId`
  `r-2` → `running` with `rowId` `r-2` (not the record's), the record's `processId`, `viewed` false; `exit` with code
  0 and no error → `running` (adoption finds it ended).

Done when: compiles; `npm run lint` passes (the layer rules); the test gate runs the two test files above. The live
checks are task 21's.
Commit:    one commit for the group

## Proof

Commit 5042267b0 · proof: diff read: Produces present; wave 4 typecheck and lint pass after a2e4f76f4 · concerns: quit may wait on an in-flight adopt (stop order unchecked); adoptRun unused until 19
