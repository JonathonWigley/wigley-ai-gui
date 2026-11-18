# Scheduled tasks

**Contents**

- **Intent** — agent tasks that run on a schedule as new headless sessions, also while the app is quit.
- **Vocabulary** — task, schedule, occurrence, run, run row, pending run, catch-up, skip.
- **Flow** — from a task to a run row, through the session host.
- **A task** — its fields, the task file and its shape, a file that fails to parse.
- **Schedules** — the six kinds, local time, the cron dialect, daylight saving.
- **Firing** — which app fires, what is queued and when it is re-planned, catch-up, overlap, a failed start.
- **The environment of a run** — the variables a prepared run carries, and where the rest go.
- **With the app closed** — what each tool answers, and what replays when the app opens.
- **Adoption** — how a run the host started becomes a row.
- **Login start** — the host starting at login while any task is active.
- **Schedules mode and Scheduled runs** — the mode, its keys and history lines, the section, the finished mark.
- **MCP tools** — the four tools main agents manage tasks with.
- **History** — where each task's runs are kept.
- **Decisions** — the choices a later change would otherwise reopen.

## Intent

The user schedules agent tasks: a prompt that runs in a project folder at set times. Each run is a new headless
session, started by the session host at its time, also while the app is quit and, on macOS, after a restart with no
app open. Every run stays a row until the user closes it, so the user reads each one when ready, the runs that ran
in the background included. The `scheduling` plugin holds the tasks, plans each task's next run and hands it to the
host; chat starts and adopts the run, and sessions answers its tool calls while the app is closed.

## Vocabulary

- **Task** — a named prompt with a project, a profile, a schedule and its controls, kept in the task file.
- **Schedule** — when a task fires: one of six kinds, in local time.
- **Occurrence** — one time a schedule names, as epoch ms. A Run now press is an occurrence at its press time.
- **Run** — one new session the host starts for one occurrence of a task.
- **Run row** — the sessions row chat opens for a run. It stays until the user closes it.
- **Pending run** — a run the app prepared and the host holds (`PendingSpawn`), waiting for its time.
- **Catch-up** — the one run the planner queues at once for the latest occurrence missed while nothing fired.
- **Skip** — a run the host does not start because the task's previous run is still busy. It goes in history.

## Flow

```
 user / main agent
   │ Schedules mode (page) ── channel ──┐      schedule_task … remove_scheduled_task (MCP, main agents)
   │                                     ▼                     │
   │                     scheduling main part ◄────────────────┘
   │   reads/writes ~/.config/wigley-ai-gui/scheduled-tasks.json (watched)
   │   history.json in plugin data (stable instance)
   │   planRuns(tasks, history, runNow, now) → one PlannedRun per active task
   │   chat.prepareLaunch(request, sessions.offlineEnv()) → { spawn, adopt }
   │   services.sessionHost.setPending([{ at, spawn, record, skipWhileBusy }])
   │   services.loginStart.set(any task active)
   ▼
 session host (detached; started by the app, or at login through the app's --start-session-host entry)
   │ pending-v4.json ── timer at `at` ──► skip when `skipWhileBusy` is busy, else spawn
   │   env = own env − ELECTRON_RUN_AS_NODE − unsetEnv + overlay; then writes stdin lines
   │ runs-v4.json ◄── { id, record, startedAt, skipped, exit }
   │ pushes runStarted to connected apps; stays alive while pending or runs is non-empty
   ▼
 claude -p … (headless note, task controls)
   │ relay.py with WIGLEY_FORMS_OFFLINE=<endpoint dir>/offline-calls
   │   app reachable → forwards as today
   │   app closed    → answers from <endpoint dir>/offline.json, appends each call to
   │                   <endpoint dir>/offline-calls/<session id>.jsonl, never starts the app
   ▼
 app open: runStarted push, or listRuns at plugin start and after each reconnect to a new host
   scheduling → chat.adopt(record.adopt) inside sessions.holdConnects
     process runs  → row attached (relay join lands on the owned row)
     process gone  → row resting, history pending
   → sessions.replayCalls(hostSessionId)   (after adopt noted the run's tool callers)
   → sessionHost.forgetRuns([id]) → history entry → re-plan → setPending
   Sessions side bar: "Scheduled runs" section claims every open run row
   finished, unviewed run row → row activity `done` (raised) + Dock badge count
```

## A task

A task (`ScheduledTask` in `src/plugins/scheduling/contract.ts`) holds:

- `id` — 8 lowercase hex characters, set by the app.
- `name` — the list's label.
- `target` — chat's `StartTarget`: a folder (`projectDir`, which may start with `~`) or a project from chat's
  `projects` setting (`project`).
- `profile` — the chat profile the run starts under.
- `prompt` — the run's first message.
- `schedule` — a `TaskSchedule` (§ Schedules).
- `controls` — the run's harness controls by control id, the permission mode included; model and effort are optional.
- `paused` — a paused task queues nothing until it is resumed.
- `updatedAt` — epoch ms of the app's last write of this task; the catch-up window starts there (§ Firing).

Every task lives in one file, `~/.config/wigley-ai-gui/scheduled-tasks.json` (`TASK_FILE_NAME`), in the user config
folder the stable and dev apps share. The user may edit it by hand; the app writes it as two-space JSON with a
trailing newline (`taskFileText`). One task:

```json
{
  "tasks": [
    {
      "id": "3f9a0c1e",
      "name": "Morning backlog triage",
      "target": { "projectDir": "~/Documents/ai-dev/wigley-ai-gui" },
      "profile": "default",
      "prompt": "Triage docs/features/followups.md and report the three items most worth doing next.",
      "schedule": { "kind": "weekdays", "time": "09:00" },
      "controls": { "mode": "plan", "effort": "medium" },
      "paused": false,
      "updatedAt": 1794297600000
    }
  ]
}
```

The app watches the file and re-plans on each change. A file that fails to parse (`readTaskFile` names the first bad
task and field) keeps the last good tasks, and Schedules mode shows the error above the list. While it fails to
parse, the app writes nothing to it (an edit, a pause or a tool call answers that the file has an error), so a
write never erases the user's unsaved hand edit. A deleted file reads as no tasks. A hand edit keeps the `updatedAt`
the file holds; the app does not stamp it. Tasks never expire: a task stays until the user or an agent removes it.

Each run is a new headless session in the task's folder, with the prompt as its first message and the task's
controls as its first process's. A pool project's run starts in the pool's lowest-numbered clone with no claim; the
agent claims a clone before it writes, as in every pool session. A run uses the folder as it is, with no worktree.

## Schedules

Six kinds, all in local time (`TaskSchedule`; `time` is `HH:MM`, 24 h; `day` 0 is Sunday … 6; `at` is local
`YYYY-MM-DDTHH:MM`):

| Kind | Fields | `scheduleText` |
|---|---|---|
| `hourly` | `minute` | `Hourly at :15` |
| `daily` | `time` | `Daily at 09:00` |
| `weekdays` | `time`, Monday to Friday | `Weekdays at 09:00` |
| `weekly` | `day`, `time` | `Mondays at 09:00` |
| `once` | `at` | `Once on 2026-11-20 at 14:30` |
| `cron` | `line`, five fields | `Cron 0 9 * * 1-5` |

`src/plugins/scheduling/schedule.ts` parses and steps every kind: `readSchedule`, `nextOccurrence`,
`latestOccurrence` and `scheduleText`. It is pure, reads local fields through `Date`'s local methods, and takes every
time as an argument, so it runs on the injected clock.

The cron dialect is vixie cron's numeric core:

- five numeric fields: minute, hour, day of month, month, day of week
- `*`, lists (`1,15`), ranges (`1-5`) and `/` steps (`*/10`, `0-30/5`)
- day of week 0–7, with 0 and 7 both Sunday
- when day of month and day of week are both restricted, a day that matches either one matches
- no month or day names, and no `L`, `W` or `?`

Daylight saving: a local time that a spring-forward gap skips does not occur that day, and a local time that a
fall-back overlap repeats occurs once, at its first instance. A one-time `at` that a gap skips is refused when the
schedule is read, since it would never fire.

## Firing

- **Only the stable app queues.** The plugin queues and fires when `!appInstance.isDev || runMode !== 'live'`. The
  dev app shows and edits the shared task list but never fires it, and its Schedules mode says so in one line. The
  self-test and drive runs fire in their own temp homes, so their checks reach a real queue.
- **One run per task.** The planner (`planRuns` in `main/planner.ts`) gives each active task one `PlannedRun`: a Run
  now press at once, else a catch-up at once, else the next occurrence. A paused task and a spent one-time task get
  none. The app sends the whole list with `setPending`, which replaces what it sent before. With the app closed, a
  task fires once and then waits until the app opens and plans again.
- **Re-plans** happen on app start, on each task edit, on each task-file change, on each Run now press, on a plugin
  reload, after each run is adopted, after the app connects to a new host, and when chat's session instructions change (`chat.onInstructionsChanged`), which also prepares
  every pending run again. The `claude.command` path and chat's profiles and projects, which a prepared run also
  holds, have no change signal: a change reaches a pending run at its next re-prepare, the next app start, edit of
  that task, task-file change or plugin reload.
- **Catch-up.** The planner looks back from now to the latest of the task's `updatedAt`, its latest history
  occurrence and, in a start whose `history.json` could not be read, that start's time. When that window holds a missed occurrence, it queues one run, at once, for the latest; older missed
  times are dropped. So a task resumed or edited after a gap does not catch up times from before the change. A task
  written by hand with an `updatedAt` older than its latest occurrence, and no history, catches up once at the next
  plan. In a start whose `history.json` could not be read, no task catches up (the window starts at that start),
  since the app cannot tell which times already ran.
- **Overlap.** Each pending run carries `skipWhileBusy`: the process id of the task's newest history entry with one.
  At `at`, the host skips the run while that process runs and its idle rule reads it busy, and records a run with
  `skipped: true`, which history shows as skipped. An idle run whose process stays alive does not block the next run.
- **A failed start.** A run that fails to start is a failed history entry with its reason. That covers a run the
  app could not prepare (`chat.prepareLaunch` throws: a missing folder, an unknown profile, project or control id)
  once its time has come, and a spawn the host could not make (`exit.error`). A prepare that fails before the run's
  time queues nothing for the task and tries again at that time, since a folder missing now may exist then.
- **A one-time task** stays listed after its run, with no next run, until the user edits or removes it.
- **Switching the plugin off** (the part's stop is `end`, for a switch-off or a removal) empties the host's queue and removes the login start. A
  quit or a restart of the app leaves both in place.

## The environment of a run

A prepared run stores only the app's own variables plus PATH, never the app's whole environment:
`WIGLEY_AI_GUI_ENDPOINT_DIR`, `CLAUDE_CONFIG_DIR`, `CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS`, `WIGLEY_SESSION_ROW`,
`WIGLEY_FORMS_OFFLINE` (from sessions' `offlineEnv`), and `PATH` as the app's login PATH when the run was prepared.
The Claude adapter carries `PATH`, `WIGLEY_AI_GUI_ENDPOINT_DIR` and `CLAUDE_CONFIG_DIR` from the app's environment
into the run (`CLAUDE_CARRIED_ENV`, `prepareRun`), so no plugin reads that environment. `CLAUDE_CONFIG_DIR` rides
along because a profile with no folder of its own keeps the inherited value, and the run must write its transcript
where adoption reads it. A profile whose folder is the default `~/.claude` runs with `CLAUDE_CONFIG_DIR` unset, and
any other profile folder sets it. The host lays these over its own environment, less
`ELECTRON_RUN_AS_NODE` and the harness's unset names; a host launchd started at login has launchd's bare one. A
variable a run needs beyond these goes in the Claude profile's settings `env`, and Schedules mode says so.

## With the app closed

Every run starts headless: a forms round answers itself with its recommendations, and the session's instructions
carry `HEADLESS_NOTE`. While the app is open, a permission prompt that the task's mode does not allow waits, with the
row marked needing you. While the app is closed, the relay answers each call from the table the app writes,
`offline.json` beside `tools.json` in the endpoint folder (forms README § The relay, in wigley-ai-marketplace). Each
tool's contribution declares its answer and whether it replays, through `contributeTools(…, { offline })`:

| Tool | Answer | Replays |
|---|---|---|
| `ask_round` | no round shown: take each item's recommended pick, list each pick as a Decided notice | no |
| `open_audio_picker` | no picker shown: take each moment's recommended candidate, list each pick as a Decided notice | no |
| `collect_last_round`, `open_primer`, `collect_last_primer`, `collect_last_audio_picker` | did not run | no |
| `permission_prompt` | a deny: the run's permission mode does not allow this tool | no |
| `show_live_view`, `hide_live_view` | no stream: carry on without it | no |
| `start_session`, `add_practice_problem`, `read_practice_state`, `read_backlog_state`, `set_backlog_chunks` | did not run | no |
| `set_headless` | the session stays headless | no |
| `set_workflow_step`, `set_workflow_checklist`, `set_workflow_plan` | recorded, applied when the app opens, then `HEADLESS_NOTE` | yes |
| `set_session_title` | title recorded, applied when the app opens | yes |
| the four scheduling tools | did not run | no |

A tool left out of the table answers `The app is closed: <tool> did not run.`, and does not replay; a
`permission_prompt` left out gets the relay's own deny instead, `The app is closed. The user was not asked, so this
tool call did not run.` So a denied permission prompt lets the run carry on around the tool, and `start_session` and
the practice tools did nothing. An `offline.json` that is missing or unreadable reads as an empty table: every tool
answers as left out of it, permission prompts with that deny.

A run whose relay hello has no session id (`CLAUDE_CODE_SESSION_ID` unset, which a host-fired Claude run always
sets) still gets each offline answer, but the relay writes no calls line and logs one stderr line, so nothing of
that run replays.

The relay appends each call it answered alone to the run's calls file, `<endpoint dir>/offline-calls/<session
id>.jsonl`. At adoption, `sessions.replayCalls(hostSessionId)` routes each replayable call to the row's tool sessions
in order, through the tool-call guards, drops the results, and deletes the file. It runs after `adopt` noted the
run's tool callers: the attach replay for a running process, or the history read for a resting row, whose saved
history holds the main agent's calls only. A replayed main-agent-only call that no note names as the main agent's is
skipped, with no wait, so a subagent's call is never applied as a main agent's.

## Adoption

The app learns of a run from the host's `runStarted` push while it is connected, or from `listRuns` when the plugin
starts and each time the host client connects to a new host (`sessionHost.onConnected`). Each `listRuns` read runs
inside `sessions.holdConnects`, so a run's relay hello waits for its row. For each run whose record is a
`ScheduledRunRecord`:

1. A skipped run, or one whose `exit.error` is set, goes straight to history. A spawn error reads `could not start
   the agent in <folder>: <error>`; an `ENOENT` says that the folder or the agent command is missing.
2. Any other run: `chat.adopt(record.adopt)` opens its row inside `sessions.holdConnects`, so the run's relay
   connection joins the owned row. A process that still runs is attached; a process that is gone gives a resting row
   with its history pending, through chat's restore path. When a row already holds the host session id (an earlier
   start adopted the run and quit before forgetting it, the same run heard twice, or the run's own relay row),
   `adopt` opens nothing and resolves to that row, and an existing history entry stands. A relay row has no chat
   session to report a turn's end, so its run is finished at adoption. A rejection (the app stopping, or a row chat
   cannot open) is a failed entry, `not opened: <reason>`, except while the app stops, when the run waits for the
   next start. A run's history entry names the row id `adopt` resolved to. A run read through
   `listRuns` is finished at adoption when its process is gone or its row reads idle after the attach replayed the
   pipe log; a run heard through `runStarted` is finished at adoption only when its process is gone, since its first
   turn has just begun.
3. `sessions.replayCalls(hostSessionId)` replays the calls the relay logged while the app was closed.
4. `sessionHost.forgetRuns([id])` drops the run from the host's runs record, the history entry is written, and the
   plugin re-plans and sends `setPending`.

A run that goes on while the user quits keeps going in the host and re-attaches on the next start, as every chat
session does.

## Login start

While any task is active (`services.loginStart.set(any task active)`; active means not paused with a planned run,
so a spent one-time task does not count), the session host starts when the user logs in, so pending runs fire after a restart with no app open. Both macOS login starts run the app executable with the
flag `--start-session-host` (`LOGIN_START_FLAG`). `main.ts` checks the flag before the single-instance lock, sets the
accessory activation policy so no Dock icon shows, starts the host detached through `sessionHostLaunch` as the app
would, and exits; so the host's folder and channel are worked out in one place and no plist holds them. A host
started this way reads its pending table and runs record at start. `LoginStart` (`src/contracts/login-start.ts`) is a platform seam; `set` resolves to a
`LoginStartStatus` (`on`, `off`, `needsApproval` or `unsupported`, with a `detail` line) that Schedules mode shows.

- **macOS** has two adapters in `src/main/login-start/`, label `wigley-ai-gui.session-host`. `main.ts` uses the
  login-item service in the live stable app, since a spike found it works on the user's Mac. The LaunchAgent adapter is
  built and tested, and `main.ts` does not import it: it stays for a Mac where the login item does not work.
  - The login-item service (`createAgentServiceLoginStart`): Electron's `setLoginItemSettings` with type
    `agentService`, over a plist inside the bundle.
  - A LaunchAgent file (`createLaunchAgentLoginStart`): `~/Library/LaunchAgents/wigley-ai-gui.session-host.plist`,
    running the app with the flag, rewritten on each start when it differs, deleted (`files.deleteFile`) when no task is
    active. The adapter runs no `launchctl`: launchd reads the file at the next login.
  - Neither adapter imports `electron`: `main.ts` hands the login-item service Electron's `app` as a structural
    `LoginItems` type.
- **Windows, Linux, the dev app, the self-test and drive runs** get `createNoLoginStart()`, which answers
  `unsupported`. On Windows a task does not fire after a restart until the app opens (follow-up: Scheduled tasks
  start at login on Windows).

## Schedules mode and Scheduled runs

- **Schedules mode** opens on `<Leader>kt`, drawn through the scheduling plugin's layout like every mode. The left
  side lists the tasks, under a "+ New task" row; each row shows its schedule and its next run, or Paused. The right
  side shows the selected task: project, schedule, permission mode and prompt, with Edit, Pause or Resume, Run now and
  Remove. The editor offers chat's profiles and projects and the harness's start controls (`editorChoices`).
- **The mode's keys**: `j`/`k` move, `a` makes a task, `i` edits the selected one, `p` pauses or resumes it, `r` runs
  it now, `d` removes it after a confirm; in the details, `j`/`k` move through the history and `<CR>` or `l` opens a run's
  row. `src/plugins/keymap.ts` holds the full list.
- **The mode's notices**, at the top of the details: the task file's parse error while one stands; in the dev app,
  that it never fires; where the app fires, the login start's state when it needs the user (approval, a failure, or
  no login start on this platform). The editor says, under its rows, that a variable a run needs goes in the
  profile's settings `env`.
- **History lines** under the selected task, newest first: `Running`, `Finished`, `Skipped, previous run still
  going`, and `Failed to start: <reason>`; `No runs yet.` with none. A line links to its run row while that row is
  open; a line whose row the user closed draws unlinked.
- **The Scheduled runs section** in the Sessions side bar, registered through sessions' `addSection`, claims every
  open run row (`SchedulingState.runRows`).
- **The finished mark.** A run is finished at its row's first `chat.turnFinished`, at adoption by the rule in
  § Adoption, when its row closes, or, after chat has restored its rows, when its row is not open or its session
  does not run. A run row that chat restores under a new row id stops counting as a run row: its history entry names
  the old id, so no section claims the new row and no mark or badge count stands for it. A finished run stays unviewed until `sessions.selection` names its row; a run that finishes while its row is
  selected is viewed at once. The mark is the history entry's `viewed` flag, so it survives an app restart. The page
  sets row activity
  `done` with emphasis `raised` on each unviewed run row, and main sets the `services.alerts` open count `scheduling`
  to their number, which the Dock badge shows.

## MCP tools

Main agents manage tasks through four tools, contributed with `{ mainAgentOnly: true }` (`main/task-tools.ts`):

- `schedule_task` — makes a task, active at once; the calling session's folder by default, and the named
  project's own profile, else the calling session's, as `start_session` defaults. A project with its own profile
  refuses any other.
- `list_scheduled_tasks` — each task's id, name, schedule, next run and last outcome.
- `update_scheduled_task` — changes any field; `paused` pauses and resumes.
- `remove_scheduled_task` — removes a task.

`schedule_task` and `update_scheduled_task` cap the task's controls at the calling session's, through the harness's
`capControls`, so an agent cannot schedule a run with more permission than it has. An update caps the controls the
task ends with, kept ones included, unless its only change is a pause. An unknown control id is refused at save. A call from a run row answers `A
scheduled run cannot manage scheduled tasks.`, so a run cannot reschedule itself. An agent's task shows in Schedules
mode like any other. With the app closed, the four tools did not run.

## History

Each task's runs are kept in `history.json` in the stable instance's plugin data (`main/history-store.ts`), the newest
20 entries per task. An entry (`RunHistoryEntry`) holds the occurrence, the time, the outcome (`running`, `finished`,
`skipped` or `failed`), a failed run's reason, the row and process ids of a run that started, and `viewed`, false
until the user views a finished run's row.

## Decisions

- **The host fires every run, also while the app is open.** One firer cannot double-fire, and only the host is there
  while the app is closed. A firer in the app was rejected: it fires nothing while the app is quit, and two firers
  would race.
- **One prepared run per task.** The user's pick. Preparing more than one was rejected: the app re-prepares on every
  start, edit and file change, so a closed app fires a task once and then waits for the app.
- **Overlap check in the host.** The overlap rule must hold while the app is closed, and only the host is there then.
  It reads busy from the idle rule it already keeps, so it learns nothing about any harness.
- **Run history in plugin data.** The user config folder keeps only what the user changes, and the dev app fires
  nothing, so it has no history to show.
- **Who fires.** The dev app must never fire the shared list; the self-test and drive runs use their own temp homes,
  so they may fire and can be checked.
- **Calls file keyed by session id.** The offline env stays the same for every run, so chat picks the session id after
  the scheduler builds the env, and sessions finds the file from the host session id alone.
- **Offline answers per tool name.** One contribution holds tools with different answers (`ask_round`,
  `collect_last_round`). A tool left out answers that it did not run and does not replay.
- **Permission cap in the harness.** The Claude order, least to most permissive: `plan` (writes nothing), `dontAsk`
  (only pre-approved tools), `manual` (asks), `acceptEdits` (writes files unasked), `auto` (the classifier approves).
  A cap with no value for the control caps at the harness's launch default, `auto` for Claude. Control values are
  adapter knowledge, so the order lives in the adapter.
- **Start controls from the harness.** `startControls()` gives the editor and the tools the control ids and choices
  with no process, since control ids and choices are adapter knowledge.
- **Carried env names in the adapter.** No plugin reads the app's environment, and the adapter already sets the app's
  `WIGLEY_SESSION_ROW`.
- **The unviewed mark in history.** Kept in `history.json` beside the entry, so a run the user has not read is still
  marked after an app restart.
- **One login entry in the app.** Both login starts run the app with `--start-session-host`, so the host command is
  built by the same `sessionHostLaunch` the app uses, and an app update needs no plist change for a new host path.
- **Live starts keep their full env.** A live start sets `inheritEnv` false, so its child env is exactly its launch
  env and does not change; a prepared run sets `inheritEnv` true and passes the carried names as an overlay on the
  host's env, less `unsetEnv`. The host outlives the app that started it, so its own env can hold names the current
  app's lacks.
- **Catch-up window from the last edit or run.** A resumed or edited task does not catch up times from before the
  change, as Hermes does for a paused job.
- **Finished means the first turn ended.** A run row is done once its first turn ends, and it stays marked until the
  user views it. A process stays alive after its turn, so adoption reads the row's activity, not only whether the
  process runs.
- **A one-time task stays after its run**, with no next run, until the user edits or removes it.
- **An in-house schedule parser.** A third-party cron or date library was rejected with the user: the dialect is five
  numeric fields, and a pure parser on the injected clock tests by table, DST cases included.
- **No system notification.** The app raises none: a finished run marks its row and the Dock badge, as a finished
  turn or an open form does.
- **Both login adapters are built.** `main.ts` uses the login-item service, which works on the user's Mac; the
  LaunchAgent adapter stays for a Mac where it does not.
