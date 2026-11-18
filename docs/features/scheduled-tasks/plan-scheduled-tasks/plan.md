# Scheduled tasks — plan

Feature: Scheduled tasks · Implements: none · Ticket: none
Target: `main` of the `ai` repo (folders wigley-ai-gui and wigley-ai-marketplace) · Written: 2026-11-09

REQUIRED SUB-SKILL: Use wigley:make to implement this plan

**Contents**

- **Goal** — what the run lands.
- **Architecture** — the systems the work touches.
- **Preconditions** — each repository-state claim, with the command that checks it.
- **Docs written ahead** — the docs commit.
- **Mandatory Reads** — the rule files each task reads first.
- **Design Overview** — the after-state flow, out of scope, the decisions, the architecture.
- **File Structure** — files modified and created, boundary rules, and every shared name and shape.
- **Tasks** — the task documents by wave.
- **Run log** — written by `wigley:make`.

## Goal

The user schedules recurring and one-time agent tasks in the app. Each task fires as a new headless session in its
project folder at its schedule time, also while the app is quit, and also after a restart on macOS. The session host
starts every run. Chat adopts each run as a row. Every run stays open as a row until the user closes it. The user
manages tasks in a new Schedules mode, and main agents manage them through four MCP tools.

## Architecture

The work touches these systems:

- **Session host** (`src/session-host/`, `src/contracts/session-host*.ts`): a persisted deferred-spawn queue, run
  records, an env overlay and stdin lines on each spawn, one protocol bump.
- **Session host client** (`src/main/session-host/`): the queue and run members of `SessionHost`.
- **Agent harness** (`src/contracts/agent.ts`, `src/main/claude-code/`, `src/shared/fake-agent-harness.ts`): a pure
  prepare-a-run member, the start controls, the permission cap.
- **Chat plugin** (`src/plugins/chat/`): `controls` on `LaunchRequest`, the `prepareLaunch` and `adopt` exports.
- **Sessions plugin** (`src/plugins/sessions/`): the `offline` option of `contributeTools`, the offline table file,
  the `offlineEnv` and `replayCalls` exports.
- **Every tool contributor** (chat, forms, primer, practice, workflow, workflow-large, sessions): its offline answers.
- **Login start** (`src/contracts/login-start.ts`, `src/main/login-start/`, `src/main/main.ts`): a new platform seam
  with two macOS adapters, a no-op adapter and a fake.
- **Scheduling plugin** (`src/plugins/scheduling/`, new): the schedule parser, the task file, the run history, the
  planner, the queue sync, adoption, the MCP tools, Schedules mode and the Scheduled runs section.
- **Relay** (wigley-ai-marketplace `plugins/wigley/scripts/forms/`): an offline mode in `relay.py`, its tests and
  its README.

## Preconditions

`<gui>` is the `wigley-ai-gui` folder of the worktree `wigley:make` runs in, `/Users/jonathonwigley/Documents/.worktrees/ai-scheduled-tasks`; `<market>` is its
`wigley-ai-marketplace` folder, in the same `ai` repo and on the same branch. Each command ran at plan time with the result shown.
Re-run each one before the first dispatch.

| Claim | Command | Result at plan time |
|---|---|---|
| The `ai` base is origin's `main` (both folders) | `git -C <gui> fetch -q origin && git -C <gui> rev-parse HEAD origin/main` | `origin/main` `48f4fec5` (rebased onto it after the cold read; HEAD carries the three docs commits and the plan commit on top) |
| The host protocol is 3 | `grep -n 'SESSION_HOST_PROTOCOL = ' <gui>/src/contracts/session-host-protocol.ts` | `5:export const SESSION_HOST_PROTOCOL = 3;` |
| `HostedSpawn` has no `stdin`, `unsetEnv` or `inheritEnv` | `grep -cE '^\s+(stdin\|unsetEnv\|inheritEnv):' <gui>/src/contracts/session-host.ts` | `0` |
| `AgentHarness` has no prepare, start-controls or cap member | `grep -c 'prepareRun\|startControls\|capControls' <gui>/src/contracts/agent.ts` | `0` |
| `LaunchRequest` has no `controls` | `grep -n 'controls?:' <gui>/src/plugins/chat/contract.ts` | no match |
| No scheduling plugin and no `<Leader>kt` bind | `test -e <gui>/src/plugins/scheduling; echo $?; grep -c '<Leader>kt' <gui>/src/plugins/keymap.ts` | `1` and `0` |
| The relay has no offline mode | `grep -c 'WIGLEY_FORMS_OFFLINE\|offline.json' <market>/plugins/wigley/scripts/forms/relay.py` | `0` |
| No login item code exists | `grep -rln 'setLoginItemSettings\|LaunchAgents\|launchctl' <gui>/src <gui>/scripts <gui>/forge.config.mts` | no match |
| Electron is 44.9.1 (`setLoginItemSettings` type `agentService` is macOS 13+) | `grep -n '"electron":' <gui>/package.json` | `32:    "electron": "44.9.1",` |
| `contributeTools` call sites in plugin start files | `grep -n 'contributeTools(' <gui>/src/plugins/*/main/start.ts \| wc -l` | `12` — measured at plan time, re-verify |
| The shared fake host exists | `grep -c 'export function createFakeSessionHost' <gui>/src/shared/fake-session-host.ts` | `1` |
| Lint and typecheck pass at base | `npm --prefix <gui> run lint; npm --prefix <gui> run typecheck` | both exit 0 |
| No task file exists yet | `test -e ~/.config/wigley-ai-gui/scheduled-tasks.json; echo $?` | `1` |
| The stale pool comment is gone after the docs commit | `grep -n 'row moves once' <gui>/src/plugins/chat/contract.ts` | line 221 at plan time; no match once the docs commit lands |

## Docs written ahead

Each doc below is a hypothesis until task 20 re-reads it against the landed code.

| Doc | Repo, branch | Commits |
|---|---|---|
| `docs/features/scheduled-tasks/design.md` | `<gui>`, `scheduled-tasks-plan` | `8bc35160`, `53afbfcb`, `45f219cd` |
| `docs/features/session-host/design.md` | `<gui>`, `scheduled-tasks-plan` | `8bc35160`, `53afbfcb`, `45f219cd` |
| `docs/features/layouts/design.md` (the `scheduling` Adopters row) | `<gui>`, `scheduled-tasks-plan` | `53afbfcb` |
| `AGENTS.md`, `docs/features/followups.md`, `src/plugins/chat/contract.ts` (a comment) | `<gui>`, `scheduled-tasks-plan` | `8bc35160` |
| `plugins/wigley/scripts/forms/README.md` | `<market>`, on this worktree's branch | `e934b8a73`, `e0f4d6458`, `c2d3a6dcc` |

`docs/keymap.md` and `DESIGN.md` are not written ahead: task 12 edits them with the binds and the look it builds.

## Mandatory Reads

Every task reads these first:

- `<gui>/AGENTS.md` through its last line (the only `AGENTS*.md` or `CLAUDE*.md` in the gui repo; it has no
  `.claude/rules/`).
- `wigley:writing-code`, `wigley:writing-tests` and `wigley:codebase-design`.

By area:

- Session host tasks (02, 07, 13, 18, 24, 25): `<gui>/docs/features/session-host/design.md`; 25 also reads
  `<gui>/docs/features/agent-chat/claude-stream.md` § Message lifecycle, § Interrupt and § Subagents.
- UI tasks (12, 16, 19): `<gui>/DESIGN.md`, `<gui>/docs/keymap.md`, `<gui>/docs/features/layouts/design.md`.
- Scheduling plugin tasks (03, 10, 11, 15, 17, 19): `<gui>/docs/features/scheduled-tasks/design.md` (written ahead)
  and `<gui>/docs/features/auto-retro/design.md`, the template plugin.
- Relay task (04): `<market>/AGENTS.md` (the only `AGENTS*.md` or `CLAUDE*.md` in the marketplace folder; it has no
  `.claude/rules/`) and `<market>/plugins/wigley/scripts/forms/README.md` § The relay and § Boundary rules.
- Login tasks (01, 06, 18): `<gui>/.agents/skills/install/SKILL.md`.

## Design Overview

### Flow (after the change)

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
 session host (detached; started by the app, or at login by launchd)
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
 app open: runStarted push, or listRuns at plugin start
   scheduling → chat.adopt(record.adopt) inside sessions.holdConnects
     process runs  → row attached (relay join lands on the owned row)
     process gone  → row resting, history pending
   → sessions.replayCalls(hostSessionId)   (after adopt noted the run's callers: the attach replay, or a resting
                                            row's history read; a replayed call no note names as the main
                                            agent's is skipped)
   → sessionHost.forgetRuns([id]) → history entry → re-plan → setPending
   Sessions side bar: "Scheduled runs" section claims every open run row
   finished, unviewed run row → row activity `done` (raised) + Dock badge count
```

### Out of scope

- Windows login start. Windows tasks pause after a restart until the app opens. Follow-up in
  `docs/features/followups.md` (written ahead): it needs a launcher outside the `app-*` build folders that sets
  `ELECTRON_RUN_AS_NODE`.
- A worktree option per task. Each run uses the project folder as it is.
- System notifications. A finished run marks its row and the Dock badge only.
- Task expiry, repeat counts, a global pause switch, more than one prepared run per task, firing from the dev app.
- A third-party cron or date library. The parser is in-house.
- Waking the machine or keeping it awake.
- Per-platform program lookup and spawning for `claude` (follow-up :353). Lane P owns it
  (`docs/features/intent-alignment/plan-lane-p-platform/` tasks 04–05).

### Decisions

Settled with the user (interview rounds 1–6, `settled-design` of this feature, binding):

- A task holds name, project (folder or pool project), profile, prompt, schedule, permission mode, optional model and
  effort. Tasks never expire. Pause and resume per task. (round 1)
- Schedules: hourly, daily at a time, weekdays at a time, weekly on a day at a time, one time at a date and time, and
  a custom 5-field cron line. Local time. In-house parser, a pure module on the injected clock. (round 1)
- Each run is a new headless session in the task's project folder, with the prompt as its first message. A pool
  project's run starts in the pool's lowest-numbered clone with no claim. Each task sets its permission mode. (round 1)
- Catch-up: one run for the most recent missed time; older missed times are dropped. Overlap: a new run is skipped
  while the task's previous run still goes, and the skip goes in history. A run that fails to start goes in history
  as failed. (round 1)
- Four MCP tools for main agents, refused to scheduled runs. An agent-created task is active at once, its permission
  mode capped at the creating session's. (round 1)
- Chat's `launch` gains a harness-neutral `controls` field. A finished run marks its row and the Dock badge, with no
  system notification. Clock and timers injected. Its own plugin, `scheduling`, over chat's launch, with auto-retro
  as the template. (round 1)
- Tasks fire while the app is quit. Every run stays open as a row until the user closes it. Runs that ran in the
  background open as rows when the app opens, finished ones included. (rounds 2–5)
- One firer: the session host starts every run, also while the app is open. Chat adopts the run as a row inside
  `sessions.holdConnects`. (rounds 2–5)
- The host becomes a persisted deferred-spawn queue: `HostedSpawn` gains stdin lines, an env overlay and a
  harness-supplied unset list; a pending table `{ at, spawn, record }`; a runs record `{ id, record, startedAt,
  exit | null }`; replace-all `setPending`, `listRuns`, `forgetRuns`, pushed `runStarted`; one protocol bump; the app
  re-sends the queue on every connect. The host stays harness-neutral and MCP-free. (rounds 2–5)
- Only the next run of each task is prepared. The app re-prepares on every app start, task edit, task-file change and
  plugin reload. (rounds 2–5)
- Prepared runs carry only the app's own env vars plus PATH. Schedules mode says that other vars go in the profile's
  settings `env`. (rounds 2–5)
- The Claude harness gets a pure prepare-a-run step carved out of the live start; the fake harness is its second
  adapter. Fresh ids per occurrence. (rounds 2–5)
- Chat gains prepare-a-launch and adopt-a-run; the scheduler copies none of chat's rules. (rounds 2–5)
- Tasks live in one hand-editable file in the shared user config folder. Only the stable app queues and fires them.
  The dev app shows and edits the list and says in one line that it never fires. A file that fails to parse keeps
  the last good queue and shows the error. (round 3)
- With the app closed: rounds auto-answer, reports replay onto the row at adoption, a permission prompt the mode does
  not allow is denied, `start_session` and the practice tools answer "did not run". The relay gets an offline mode
  switched on by an env var only host-fired specs set; sessions writes the canned table; each contribution declares
  its closed-app answer and whether it replays; a replay export routes logged calls after the transcript replay fed
  chat's tool-caller tracking. (rounds 4–5)
- The session host starts at login while any task is active. macOS: try Electron's `agentService` login item first,
  fall back to a LaunchAgent file the app writes. The first build task checks which works. One login-start seam in
  `src/contracts`, two adapters plus a fake, picked in `main.ts`. (rounds 4–6)
- Schedules mode (list left with "+ New task", details and history right, drawn through a layout) and a Scheduled
  runs section in the Sessions side bar. (rounds 2, 6)

Decided by the agent while planning (implementation shape; each with its reason):

- **Overlap check in the host.** `PendingSpawn` carries `skipWhileBusy`: the process id of the task's latest run. At
  `at`, the host skips the entry when that process runs and its idle rule reads it busy, and writes a run record with
  `skipped: true`. Reason: the overlap rule must hold while the app is closed, and only the host is there then. The
  host reads busy from the idle rule it already keeps, so it learns nothing about any harness. An idle run whose
  process stays alive does not block the next run.
- **Run history in plugin data.** `history.json` in the stable instance's plugin data, the newest 20 entries per task.
  Reason: AGENTS.md § The user config folder keeps that folder for what the user changes, and the dev app fires
  nothing, so it has no history to show.
- **Who fires.** The plugin queues and fires when `!appInstance.isDev || runMode !== 'live'`. Reason: the dev app
  must never fire the shared list, and the self-test and drive runs use their own temp homes, so they may fire and
  can be checked.
- **Calls file keyed by session id.** `WIGLEY_FORMS_OFFLINE` names a folder; the relay appends to
  `<folder>/<hello session_id>.jsonl`. Reason: the env stays the same for every run, so chat picks the session id
  after the scheduler builds the env, and sessions finds the file from the host session id alone.
- **Offline answers per tool name.** `ContributeToolsOptions.offline` is a record by tool name, since one
  contribution holds tools with different answers (`ask_round`, `collect_last_round`). A tool left out answers that
  it did not run and does not replay.
- **Permission cap in the harness.** `AgentHarness.capControls` lowers a permission control to the cap. The Claude
  order, least to most permissive: `plan`, `dontAsk`, `manual`, `acceptEdits`, `auto`. Reason: `plan` writes
  nothing; `dontAsk` runs only pre-approved tools; `manual` asks; `acceptEdits` writes files unasked; `auto` lets the
  classifier approve. A cap with no value for the control caps at the harness's launch default (`auto` for Claude).
- **Start controls from the harness.** `AgentHarness.startControls()` gives the editor and the MCP tools the control
  ids and choices with no process. Reason: control ids and choices are adapter knowledge (AGENTS.md § A session
  control).
- **Carried env names in the adapter.** The Claude adapter carries `PATH`, `WIGLEY_AI_GUI_ENDPOINT_DIR` and
  `CLAUDE_CONFIG_DIR` (`CLAUDE_CARRIED_ENV`) from its `deps.env` into a prepared run. Reason: no plugin reads the
  app's environment, and the adapter already sets the app's `WIGLEY_SESSION_ROW`; `CLAUDE_CONFIG_DIR` is carried
  because a profile with no folder of its own reads its transcripts from the inherited folder, so a prepared run must
  write there for `adopt` to find its history. `APP_ENDPOINT_ENV` names the endpoint var once, in
  `src/shared/app-endpoint-dir.ts`.
- **Live starts keep their full env.** `HostedSpawn.inheritEnv` is false for `start`, whose child env is then exactly
  the launch env, as today, and true for `prepareRun`, whose child takes the host's env less `unsetEnv` under the
  carried names. Reason: the host outlives the app that started it, so its own env can hold names the current app's
  env lacks (a shell's proxy variables, launchd's names after a login start).
- **Catch-up window.** The planner looks back from now to the latest of the task's `updatedAt`, its latest history
  occurrence and `catchUpFloor` (the part's start time when `history.json` failed to load, else none). Reason: a
  resumed or edited task does not catch up times from before the change, as Hermes does for a paused job; an unread
  history must not fire a catch-up at every start (10, 17).
- **Finished means first turn ended.** A run is finished at its row's first `chat.turnFinished`, or at adoption: a
  listed run when its process is gone or its row reads idle after the attach replay, a pushed run only when its
  process is gone (17). A finished run stays unviewed until `sessions.selection` names its row; the mark is
  the history entry's `viewed` flag, so it survives an app restart. The page sets row activity `done` (emphasis
  `raised`) on unviewed run rows; main sets `services.alerts` open count `scheduling` to their number, with the noun `finished scheduled run` / `finished scheduled runs`.
- **One-time task after its run.** It stays in the list with no next run until the user edits or removes it.
- **Cron dialect.** Five numeric fields; `*`, lists, ranges and `/` steps; day of week 0–7 with 0 and 7 as Sunday;
  when day of month and day of week are both restricted, either matches (vixie cron). No names, no `L`, `W` or `?`.
  A local time that a DST gap skips does not occur; a time a DST overlap repeats occurs once, at the first instance.
- **Local time through `Date`.** `schedule.ts` reads local fields through `Date`'s local methods. Its tests set
  `process.env.TZ` to `America/New_York` for their run and restore it.
- **The spike runs in a scratch worktree.** Task 01 packages from a scratch worktree of the base commit with
  `node_modules` linked from the clone, so no other wave-1 edit enters its package and nothing is installed.
- **Both login adapters are built.** `main.ts` picks the one task 01 recorded as working on this Mac; the other stays
  for a Mac where it works.
- **Only background subagents hold a hosted process busy (25).** The user picked it: `background_tasks_changed` entries of
  kind `local_agent` count as busy and `local_bash` does not. A background Bash ends with its process at the keep
  window, so a drain stays bounded and a task's next run is not blocked by a build left in a shell.
- **Per-platform program lookup stays with Lane P.** The user settled it: the `claude` lookup and spawning on each
  platform (follow-up :353) belongs to `docs/features/intent-alignment/plan-lane-p-platform/` tasks 04–05 and is not
  done here.

### Architecture

- The session host's seam (`HostedSpawn`, `SessionHost`) deepens: behind two new record types, five `SessionHost`
  members and four wire messages sit persistence, timers, skip and exit-rule upkeep, all in the host. The host still
  knows no harness: every harness fact (args, carried env, unset names, opening stdin lines, idle rule) arrives in
  the spawn.
- The prepare step is one pure function in the Claude adapter that both `start` and `prepareRun` call, so a live
  start and a prepared run cannot drift. The fake harness is its second adapter.
- Chat keeps every launch rule (instructions, headless note, controls, pool target, ids, the adopt path through
  `restoreRecord`). The scheduling plugin holds no chat rule; it passes `LaunchRequest`s and `AdoptRequest`s.
- Sessions keeps every MCP fact: the offline table file, the calls folder, the replay through the normal call path
  and its guards. The relay keeps no tool logic: it serves a table the app wrote.
- Login start is a platform seam (AGENTS.md § Intent, macOS and Windows): the contract in `src/contracts`, adapters
  in `src/main/login-start/`, the pick in `main.ts`, so the plugin has no `process.platform` check.
- The scheduling plugin is a deep module over chat, sessions and the host: pure `schedule.ts` and `planner.ts` hold
  the time rules and test by table; the stores hold the files; `main/start.ts` only wires.

## File Structure

### Existing files modified

| File | Change | Task |
|---|---|---|
| `src/contracts/session-host.ts` | `HostedSpawn` gains `inheritEnv`, `unsetEnv`, `stdin`; `env` becomes an overlay when `inheritEnv` (02); `PendingSpawn`, `HostedRun` (07); the `SessionHost` queue members and `onConnected` (13) | 02, 07, 13 |
| `src/session-host/process-table.ts` | builds the child env from its own env, `unsetEnv` and the overlay; writes `stdin` after spawn (02); `isBusy(id)`, `processClosed(id, exit)` (07) | 02, 07 |
| `src/session-host/host-server.ts` | `SessionHostDeps.env` (02); the queue messages, the exit rule, `runStarted` pushes (07) | 02, 07 |
| `src/session-host/session-host.ts` | hands `process.env` to the host (02); any wiring the pending queue needs (07) | 02, 07 |
| `src/session-host/session-host-test-doubles.ts` | spawn literals carry the new fields | 02 |
| `src/main/claude-code/claude-launch.ts` | `claudeUnsetEnv`, `ClaudeLaunch.unsetEnv` (02); the pure spec builder `claudeSpawn`, `CLAUDE_CARRIED_ENV`, the moved `CLAUDE_IDLE_RULE`, `CLAUDE_DROPPED_OUT_KEYS` and `definedEnv` (08) | 02, 08 |
| `src/main/claude-code/claude-code-harness.ts` | `start` passes `unsetEnv` and `stdin: []` (02); `start` and `prepareRun` share one spec builder (08) | 02, 08 |
| `src/shared/fake-session-host.ts` | accepts the new spawn fields (02); the queue members (13) | 02, 13 |
| `src/session-host/process-table.test.ts`, `src/session-host/host-server.test.ts` | the env, stdin and validation cases (02); `isBusy`, the queue, the exit rule and drain cases (07) | 02, 07 |
| `src/shared/fake-session-host.test.ts` | a stdin line (02); the queue members (13) | 02, 13 |
| `src/main/claude-code/claude-code-harness.test.ts` | the unset names (02); `prepareRun` (08); `childHost`'s stubs for the new `SessionHost` members (13) | 02, 08, 13 |
| `src/main/session-host/session-host-client.test.ts` | spawn literals carry the new fields (02); the queue members and `sessionHostLaunch` (13) | 02, 13 |
| `src/plugins/manifests.ts` | lists `schedulingManifest` | 03 |
| `src/plugins/sessions/contract.ts` | `OfflineAnswer`, `ContributeToolsOptions.offline`, `offlineEnv`, `replayCalls` | 05 |
| `src/plugins/sessions/main/start.ts` | writes `offline.json`; the two exports (05); `set_session_title`'s offline answer (09) | 05, 09 |
| `src/plugins/sessions/main/session-list.ts` | keeps each contribution's offline answers; `offlineTable()`; replay through the call path | 05 |
| `src/plugins/sessions/main/relay/endpoint.ts` | `EndpointWriter.write` also writes `offline.json` | 05 |
| `src/contracts/login-start.ts` | created by 03 with the three types; 06 modifies it only where the seam needs; `LOGIN_START_FLAG`, `LOGIN_START_LABEL` (18) | 06, 18 |
| `src/contracts/plugin.ts` | `MainServices.loginStart` | 06 |
| `src/main/plugins/main-api.ts` | hands `loginStart` to each part (checked; edited only on a typecheck gap) | 06 |
| `src/shared/plugin-part-harness.test-support.ts` | a fake `loginStart` by default | 06 |
| `src/main/main.ts` | passes the no-op login start (06); the `--start-session-host` login entry, the macOS adapter pick, `APP_ENDPOINT_ENV` (18) | 06, 18 |
| `scripts/check-layers.mts` | `CORE_LAYERS` entry for `src/main/login-start` (06); edited again only if lint shows a gap (18) | 06, 18 |
| `src/contracts/session-host-protocol.ts` | protocol 4, the queue messages, `pendingFile`, `runsFile` | 07 |
| `src/contracts/agent.ts` | `AgentHarness.prepareRun`, `startControls`, `capControls` | 08 |
| `src/main/claude-code/claude-controls.ts` | `claudeStartControls`, `capClaudeControls`, `CLAUDE_PERMISSION_ORDER`, `claudeOpeningLines`, `CLAUDE_OPENING_REQUESTS`, `controlRequest` | 08 |
| `src/shared/fake-agent-harness.ts` | the three members, `preparedRuns`, `FakePreparedRun`, `FAKE_AGENT_COMMAND` | 08 |
| `src/shared/app-endpoint-dir.ts` | `APP_ENDPOINT_ENV` | 08 |
| `src/plugins/chat/main/start.ts` | offline answers for its two contributions that declare one (09); the new exports (14) | 09, 14 |
| `src/plugins/forms/main/tool-definitions.ts` | `ASK_ROUND_OFFLINE` | 09 |
| `src/plugins/chat/main/permission-tool.ts`, `chat/main/set-headless-tool.ts` | `PERMISSION_OFFLINE`, `SET_HEADLESS_OFFLINE` | 09 |
| `src/plugins/workflow/contract.ts` | `WORKFLOW_OFFLINE_ANSWER` | 09 |
| `src/plugins/sessions/main/title-tool.ts` | `SET_SESSION_TITLE_OFFLINE` | 09 |
| `src/plugins/forms/main/start.ts`, `workflow/main/start.ts`, `workflow-large/main/start.ts` | offline answers | 09 |
| `src/plugins/audio-picker/main/tool-definitions.ts`, `audio-picker/main/start.ts` | `OPEN_AUDIO_PICKER_OFFLINE` and its contribution | 09 |
| `src/plugins/live-view/main/live-tools.ts`, `live-view/main/start.ts` | `LIVE_VIEW_OFFLINE` and its contribution | 09 |
| `src/plugins/agent-form-fakes.test-support.ts` | the shared sessions fake (`previewSessions()`) records `contributeTools` options | 09 |
| `src/plugins/keymap.ts` | Schedules mode keys | 12 |
| `src/plugins/page.ts` | lists `schedulingPagePart` | 12 |
| `docs/keymap.md`, `DESIGN.md` | the `kt` row; the Schedules surface bullet | 12 |
| `src/main/session-host/session-host-client.ts` | the queue members, `onConnected`; `sessionHostLaunch` | 13 |
| `src/main/session-host/host-link.ts` | `HostLinkDeps.runStarted` | 13 |
| `src/plugins/chat/contract.ts` | `LaunchRequest.controls`, `PreparedLaunch`, `AdoptRequest`, `prepareLaunch`, `adopt`, `projects`, `onInstructionsChanged` | 14 |
| `src/plugins/chat/main/tool-callers.ts` (+ `.test.ts`) | `ToolCallers.noted`; `callerGuard` reads a replayed call's note without waiting | 14 |
| `src/plugins/chat/main/chat-sessions.ts` | launch controls, `prepareLaunch`, `adopt` | 14 |
| `src/plugins/main.ts` | lists `schedulingMainPart` | 17 |
| `forge.config.mts` | the bundle's agent plist, only when task 01 records `agentService` as working | 18 |
| `<market>/plugins/wigley/scripts/forms/relay.py`, `tests/test_relay.py`, the two wigley plugin manifests | offline mode; the version bump | 04 |
| `<market>/plugins/wigley/scripts/forms/README.md` | written ahead (§ Docs written ahead); 04 edits a line only where the code proves it wrong | 04 |
| `src/main/files/node-files.ts` (+ `.test.ts`), `src/contracts/files.ts` (comment) | a temp-name event reports the write's target | 22 |
| `src/plugins/workflow-large/main/plan-watch.ts`, `plan-reports.ts`, `src/plugins/unity-pool/main/pool-watch.ts`, `src/plugins/docs/main/doc-files.ts`, `src/plugins/practice/main/problem-store.ts` (+ each `.test.ts`) | `onMissed` rescans | 22 |
| `src/plugins/sessions/contract.ts`, `sessions/main/session-list.ts`, `sessions/main/start.ts` (+ `session-list.test.ts`) | `sessionsClaimedSlot`; the post-close pick skips claimed rows; a relay join keeps its host fields | 23 (after 05, 09) |
| `src/plugins/sessions/page/sessions-view.ts`, `sessions/page/start.ts` (+ `start.test.ts`) | writes `sessions.claimed` at each side bar draw | 23 |
| `src/shared/agent-forms/form-service.ts` (+ `.test.ts`) | reads a session's deadline at each use | 23 |
| `src/shared/local-channel/local-channel.ts` (+ `.test.ts`) | `<channel>.lock` held for the server's life | 24 |
| `src/session-host/host-server.ts` (+ `.test.ts`) | `shutDown` removes the record only when it holds its own pid | 24 (after 02, 07) |
| `src/contracts/session-host.ts`, `src/session-host/process-table.ts` (+ `.test.ts`), `src/main/claude-code/claude-launch.ts` (+ `.test.ts`), the `IdleRule` literals in `session-host-test-doubles.ts`, `host-server.test.ts`, `session-host-client.test.ts`, `fake-session-host.test.ts`, `claude-code-harness.test.ts` | `IdleRule` gains `sideKey`, `messageIdKey`, `messageEnd`, `turnEndIdsKey`, `background`; busy from open messages, a main turn and background work | 25 (after 02, 07, 08, 13) |
| `docs/features/session-host/design.md` | § The host: the lock (24); the busy rule (25) | 24, 25 |
| `docs/features/followups.md` | each task removes the entries it lands | 22, 23, 24, 25 |

### New files

| File | Why | Task |
|---|---|---|
| `src/plugins/scheduling/manifest.ts` | the plugin's manifest (AGENTS.md § A plugin) | 03 (12 adds commands and scopes) |
| `src/plugins/scheduling/contract.ts` | the task, schedule, history, slot and channel types every part shares | 03 |
| `src/plugins/scheduling/schedule.ts` (+ `.test.ts`) | the pure schedule parser and stepper; both parts read it (next run, text) | 03 |
| `src/plugins/scheduling/task-file.ts` (+ `.test.ts`) | the pure task-file reader and writer; main and the MCP tools share it | 03 |
| `src/contracts/login-start.ts` | the login-start seam's three types, so the wave-1 scheduling contract typechecks | 03 (06 and 18 modify it) |
| `docs/features/scheduled-tasks/plan-scheduled-tasks/01-login-item-result.md` | the spike's result, whose `Pick:` line task 18 reads | 01 |
| `src/plugins/sessions/main/offline-calls.ts` (+ `.test.ts`) | reads, routes and deletes a session's calls file through `Files`; a deep module behind `replayCalls` | 05 |
| `src/shared/permission-cap.ts` (+ `.test.ts`) | `capPermission`, the one cap rule both harness adapters call | 08 |
| `src/shared/fake-login-start.ts` (+ `.test.ts`) | the fake adapter for tests | 06 |
| `src/main/login-start/no-login-start.ts` (+ `.test.ts`) | the adapter for Windows, Linux, the dev app, the self-test and drive runs | 06 |
| `src/session-host/pending-queue.ts` (+ `.test.ts`) | the persisted pending table, run records, timers and skip rule, testable without a socket | 07 |
| `src/plugins/scheduling/main/planner.ts` (+ `.test.ts`) | the pure run planner (catch-up, next run, Run now, overlap id) | 10 |
| `src/plugins/scheduling/main/task-store.ts` (+ `.test.ts`) | the task file read, watch and write, last good tasks, parse error | 11 |
| `src/plugins/scheduling/main/history-store.ts` (+ `.test.ts`) | `history.json` in plugin data | 11 |
| `src/plugins/scheduling/page/start.ts` and its view modules | Schedules mode and the editor (12), the section and row activity (16) | 12, 16 |
| `src/plugins/scheduling/layouts/layout.d.ts`, `layouts/default/layout.js`, `layout.css` | the plugin's Layout contract and `default` layout (AGENTS.md § Everything draws through a layout); 16 draws its section through the sessions layout and changes none of them | 12 |
| `src/plugins/scheduling/main/task-tools.ts` (+ `.test.ts`) | the four MCP tools | 15 |
| `src/plugins/scheduling/main/start.ts` (+ `.test.ts`) | the main part: wiring only | 17 (19 hands its self-test script) |
| `src/plugins/scheduling/main/run-records.ts` (+ `.test.ts`) | `ScheduledRunRecord`, read from a `HostedRun.record`, and the history entry a host run gives; main-only, so the wave-1 contract imports nothing from chat's wave-3 names | 17 |
| `src/main/login-start/agent-service-login-start.ts` (+ `.test.ts`) | Electron's `agentService` adapter over a structural `LoginItems` type; imports no `electron` | 18 |
| `src/main/login-start/launch-agent-login-start.ts` (+ `.test.ts`) | the LaunchAgent file adapter and its pure plist builder | 18 |
| `src/plugins/scheduling/main/selftest-script.ts` | the plugin's self-test script | 19 |

### Boundary rules

- `npm run lint` runs `scripts/check-layers.mts`. Every import stays inside the rules it derives.
- The session host (`src/session-host/`) imports only `src/contracts`, `src/shared` and `src/shared/local-channel`,
  with `node:` packages. It imports no plugin and no `electron`.
- `src/main/session-host/` imports only `src/contracts`, `src/shared`, `src/shared/local-channel` and `node:`.
- `src/main/login-start/` imports only `src/contracts` and `src/shared`, with no `electron` and no `node:` import.
  `main.ts` passes Electron's `app` to the `agentService` adapter as the structural `LoginItems` type. The LaunchAgent
  adapter writes its file through `Files`, deletes it with `files.deleteFile`, and runs no
  `launchctl`. Only `main.ts` imports an adapter.
- Sessions' `main/offline-calls.ts` reads, renames and deletes a calls file through `Files` (`deleteFile`, `rename`) and imports no `node:` module.
- Plugins reach each other only through contracts: the scheduling plugin imports `src/contracts`, `src/shared`, its
  own folder and the `contract.ts` of `chat` and `sessions` (its manifest's `dependsOn`). Its `page/` imports the
  page kits. It needs no `PLUGIN_EXTRAS` entry; a need for one is a concern to report.
- No feature code checks `process.platform`. The platform pick is in `main.ts`.
- The relay imports nothing from any other folder and uses the Python standard library only.

### Shared names and shapes

Every name below is used by more than one task. Write each one as given. A task that finds a conflict with the tree
reports it as a concern.

**`src/contracts/session-host.ts`** (02 grows `HostedSpawn`; 07 adds `PendingSpawn` and `HostedRun`; 13 adds the
`SessionHost` members):

```ts
export interface HostedSpawn {
  id: string;
  command: string;
  args: readonly string[];
  cwd: string;
  // With `inheritEnv` true: laid over the host's own environment, after the host drops `ELECTRON_RUN_AS_NODE` and
  // every name in `unsetEnv` from it; a name in both `unsetEnv` and `env` takes `env`'s value. With `inheritEnv`
  // false: the child's whole environment.
  env: Readonly<Record<string, string>>;
  // True for a spawn the host starts later (a prepared run), whose child takes the host's environment under `env`.
  // False for a live start, whose child environment is exactly `env`.
  inheritEnv: boolean;
  // Names the harness says the child must not inherit from the host's environment. Read only when `inheritEnv`.
  unsetEnv: readonly string[];
  // Lines written to stdin right after the spawn, in order, each logged as `in` like a `write`.
  stdin: readonly string[];
  idleRule: IdleRule;
  droppedOutKeys: readonly KeyPath[];
}

// A spawn the host starts at `at` (epoch ms; at or before now starts at once). `record` is the app's JSON, handed back
// untouched on the run. `skipWhileBusy` is a hosted process id: when that process runs and its idle rule reads it
// busy at `at`, the host skips the spawn and records a skipped run.
export interface PendingSpawn {
  at: number;
  spawn: HostedSpawn;
  record: unknown;
  skipWhileBusy: string | null;
}

// A run the host started or skipped from a pending entry. `id` is the entry's `spawn.id`; `startedAt` is when the host
// spawned or skipped it; `exit` is null while it runs and for a skipped run, and holds `error` for a spawn that failed.
export interface HostedRun {
  id: string;
  record: unknown;
  startedAt: number;
  skipped: boolean;
  exit: HostedExit | null;
}

export interface SessionHost {
  // …existing members unchanged…
  // Replaces every pending entry this app sent before. The client keeps the last list and sends it again on each
  // connect, so a new host takes it over.
  setPending(entries: readonly PendingSpawn[]): void;
  // Every run the current host started or skipped that no `forgetRuns` dropped, oldest first. Rejects as `list` does.
  listRuns(): Promise<HostedRun[]>;
  // Drops the runs with these ids from the host's runs record.
  forgetRuns(ids: readonly string[]): void;
  // Hears each run the host starts or skips while this app is connected.
  onRunStarted(listener: (run: HostedRun) => void): Disposable;
  // Hears each time the client connects to a host after its first connect: a new host after a host death, an update
  // or a login start. Runs the host started while no app was connected reach the app only through `listRuns`.
  onConnected(listener: () => void): Disposable;
}
```

`HostedRun`'s JSON shape and `runsFile`'s name form are frozen, as the children record is: no protocol bump changes
them, so a newer host can import an older host's run records (below).

**`src/contracts/session-host-protocol.ts`** (07):

```ts
export const SESSION_HOST_PROTOCOL = 4;
export interface SetPendingMessage { type: 'setPending'; entries: PendingSpawn[] }
export interface ListRunsMessage { type: 'listRuns'; requestId: number }
export interface ListRunsReply { type: 'listRuns'; requestId: number; runs: HostedRun[] }
export interface ForgetRunsMessage { type: 'forgetRuns'; ids: string[] }
// Pushed to every connected client when the host starts or skips a pending entry.
export interface RunStartedEvent { type: 'runStarted'; run: HostedRun }
// The host folder's pending table and runs record of host protocol `protocol`.
export function pendingFile(protocol: number): string; // `pending-v<protocol>.json`, holds `PendingSpawn[]`
export function runsFile(protocol: number): string;    // `runs-v<protocol>.json`, holds `HostedRun[]`
// The protocol of a `runs-v<n>.json` name, else null; frozen with `runsFile`, as `hostRecordProtocol` is.
export function runsFileProtocol(fileName: string): number | null;
```

`ClientMessage` gains the three client messages; `HostMessage` gains `ListRunsReply` and `RunStartedEvent`. The host
stays alive while its pending table or its runs record is non-empty. A host started with no client (at login) reads
both files at start.

A protocol change (07, 13): `drain` drops the old host's pending entries and deletes its pending file, and the old
host takes no `setPending` after it; the app sends its queue to the new host on connect. The old host's run records
stay in its frozen runs file, which it writes no more after the drain. Each new host, at load and again before each
`listRuns` reply, imports the records of every older protocol's `runs-v<n>.json` in its folder that its own record
lacks by id, saves its own file, and deletes the older file, so no run the old host fired is lost. The second import
is needed because the client drains older hosts only after the new host answered. The client also sends
`setPending` and fires `onConnected` only after that drain was sent, so the old and new host hold the queue together
only until the drain arrives (13).

**`src/main/session-host/session-host-client.ts`** (13 produces, 18 consumes):

```ts
// The command that starts the session host the client would start: `execPath` with `hostScript`, `folder` and
// `channel` as its arguments, and `ELECTRON_RUN_AS_NODE` set to `1`.
export function sessionHostLaunch(deps: Pick<SessionHostClientDeps, 'execPath' | 'hostScript' | 'folder' | 'channel'>):
  { command: string; args: string[]; env: Record<string, string> };
```

**`src/contracts/agent.ts`** (08):

```ts
export interface AgentHarness {
  // …existing members unchanged…
  // A start of `request` that the session host runs later. Its `stdin` holds the lines `start` writes when a process
  // opens, then `firstMessage`. Its `env` holds `env`, the harness's own values and the names the adapter carries from
  // the app's environment; its `unsetEnv` the names the child must not inherit. Pure: spawns and writes nothing.
  // Throws where `start` would throw before spawning, and on a control value the harness does not offer for a control
  // whose values it checks. `request.resume` is false.
  prepareRun(request: AgentStart, firstMessage: UserMessage, env: Readonly<Record<string, string>>): HostedSpawn;
  // The controls a new session starts from: each declared control with its choices and `value` null.
  startControls(): SessionControl[];
  // `controls` with each permission control lowered to `cap`'s value where `controls` grants more. A permission
  // control `cap` has no value for caps at the harness's launch default. Other controls stay as `controls` has them.
  capControls(
    controls: Readonly<Record<string, string>>,
    cap: Readonly<Record<string, string>>,
  ): Record<string, string>;
}
```

Claude adapter names. Each has one owner:

- 02, in `claude-launch.ts`: `claudeUnsetEnv(profileDir, homeDir, paths): string[]`, the one unset rule — the
  `NESTED_SESSION_ENV` names, `CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS`, `WIGLEY_SESSION_ROW`, and `CLAUDE_CONFIG_DIR`
  when the profile folder is the default one — and `ClaudeLaunch.unsetEnv`, which `claudeLaunch` fills from it.
  `claudeEnv` deletes exactly those names.
- 08, in `claude-launch.ts`: `claudeSpawn(input: ClaudeSpawnInput): HostedSpawn` (the one spec builder `start` and
  `prepareRun` call; its `unsetEnv` is `claudeLaunch`'s), `ClaudeSpawnInput`, `CLAUDE_CARRIED_ENV = ['PATH',
  APP_ENDPOINT_ENV, 'CLAUDE_CONFIG_DIR']`, and `CLAUDE_IDLE_RULE`, `CLAUDE_DROPPED_OUT_KEYS` and the private
  `definedEnv`, moved from `claude-code-harness.ts`.
- 08, in `claude-controls.ts`: `claudeStartControls()`, `capClaudeControls(controls, cap)`, `CLAUDE_PERMISSION_ORDER =
  ['plan', 'dontAsk', 'manual', 'acceptEdits', 'auto']` for the `mode` control, `claudeOpeningLines(firstMessage,
  uuid): string[]`, `CLAUDE_OPENING_REQUESTS = ['initialize', 'get_context_usage', 'get_settings']` and
  `controlRequest(subtype, requestId): object`.
- 08, in `src/shared/permission-cap.ts`: `capPermission(controls, cap, rule: PermissionRule)` and `PermissionRule {
  controlId; order; launchDefault }`, the cap rule both adapters call.
- 08, in `src/shared/fake-agent-harness.ts`: `FakeAgentHarness.preparedRuns: readonly FakePreparedRun[]`,
  `FakePreparedRun { request; firstMessage; env; spawn }` and `FAKE_AGENT_COMMAND = 'fake-agent'`.
- 08, in `src/shared/app-endpoint-dir.ts`: `export const APP_ENDPOINT_ENV = 'WIGLEY_AI_GUI_ENDPOINT_DIR';`.

**`src/plugins/chat/contract.ts`** (14):

```ts
export type LaunchRequest = StartTarget & {
  profile: string;
  message: UserMessage;
  unattended?: boolean;
  headless?: boolean;
  instructions?: readonly string[];
  owner?: string;
  // The first process's controls, by control id; the row keeps them as its picks. Left out, the harness defaults.
  controls?: Readonly<Record<string, string>>;
};

// What `adopt` opens a row from. JSON, so a `PendingSpawn.record` can carry it.
export interface AdoptRequest {
  hostSessionId: string;
  processId: string; // `<hostSessionId>-1-<epoch ms>`, chat's process id form
  rowId: string;
  projectDir: string;
  profile: string;
  headless: boolean;
  unattended: boolean;
  instructions: readonly string[]; // the run's own, as `LaunchRequest.instructions`
  owner: string | null;
  controls: Readonly<Record<string, string>>;
  titles: SessionTitles; // `firstMessage` from the prompt, the others null
}

export interface PreparedLaunch {
  spawn: HostedSpawn;
  adopt: AdoptRequest;
}

export interface ChatMainExports {
  // …existing members unchanged; `launch`'s reject list gains an unknown control id…
  // A launch the session host starts later: chat's instructions as they stand now, the headless note when
  // `request.headless`, `request.controls` as the first process's, `env` added to the run's environment, and fresh
  // ids (host session id, process id, row id, message uuid). Opens nothing. Throws where `launch` rejects, an unknown
  // control id included.
  prepareLaunch(request: LaunchRequest, env: Readonly<Record<string, string>>): PreparedLaunch;
  // Chat's checked projects, in settings order, as the channel's `projects` gives the page.
  projects(): readonly ChatProject[];
  // Opens the row of a run the session host started from a `prepareLaunch`, inside a sessions connect hold:
  // attached when the host still runs its process, else resting with its history pending. Resolves to the row's
  // sessionId once the attach settled and, for a resting row, its history was read. When a row already holds the
  // host session id, opens nothing and resolves to that row's sessionId. Rejects after `detachAll`.
  adopt(run: AdoptRequest): Promise<string>;
  // Hears each `addInstructions` registration and each disposal of one, so a prepared run can be prepared again with
  // the texts a live start would get.
  onInstructionsChanged(listener: () => void): Disposable;
}
```

**`src/plugins/sessions/contract.ts`** (05):

```ts
// A tool's answer while the app is closed, and whether the call replays onto its row when the app adopts the run.
export interface OfflineAnswer {
  readonly result: ToolResult;
  readonly replay: boolean;
}

export interface GuardedToolCall {
  // …existing members unchanged…
  // True for a call `replayCalls` routes from a calls file; false for every live call.
  readonly replayed: boolean;
}

export interface ContributeToolsOptions {
  readonly mainAgentOnly?: boolean;
  // Each listed tool's offline answer, by tool name. A tool left out answers that it did not run, and does not replay.
  readonly offline?: Readonly<Record<string, OfflineAnswer>>;
}

export interface SessionsMainExports {
  // …existing members unchanged…
  // The environment a run the host may start while the app is closed carries: `WIGLEY_FORMS_OFFLINE` set to the
  // calls folder. Empty in the self-test, which writes no endpoint files.
  offlineEnv(): Readonly<Record<string, string>>;
  // Routes each replayable call the relay logged for `hostSessionId` to that session's tool sessions, in order,
  // through the guards, results dropped; then deletes the calls file. Resolves to the count routed; 0 with no file.
  replayCalls(hostSessionId: string): Promise<number>;
}
```

**Offline files** (04 reads and writes them; 05 writes and reads them; the README states them):

- Env var: `WIGLEY_FORMS_OFFLINE`, the absolute path of the calls folder `<endpoint dir>/offline-calls`. Set only in
  host-fired specs. Unset or empty: today's behaviour.
- `<endpoint dir>/offline.json`, written by sessions beside `tools.json` on each write of the endpoint files:

  ```json
  { "tools": { "<tool name>": { "result": { "content": [{ "type": "text", "text": "…" }] }, "replay": true } } }
  ```

  `result` is a `ToolResult` as the app returns it (`content`, optional `structuredContent`, optional `isError`).
- Calls file `<calls folder>/<hello session_id>.jsonl`, one JSON line per `tools/call` the relay answered alone in
  offline mode: `{"tool": "<name>", "arguments": {…}, "toolUseId": "<id>" | null, "at": <epoch ms>, "replay": <bool>}`.
  `toolUseId` is the call's `params._meta["claudecode/toolUseId"]`. `replay` is the table entry's, `false` for a tool
  the table leaves out. Each line is one append that opens the file by name (04). Sessions claims the file by renaming
  it to `<hello session_id>.jsonl.replaying`, then reads, routes and deletes it (05), so a line appended after the
  rename starts a new file. A tool the table leaves out gets a tool error: `The app is closed: <tool> did not run.`; a
  `permission_prompt` the table leaves out gets the relay's own deny text block instead
  (`{"behavior":"deny","message":"The app is closed. The user was not asked, so this tool call did not run."}`).
- An `offline.json` that is missing or unreadable (not JSON, a top level or `tools` that is not an object) reads as an
  empty table, so every tool answers as left out of it; so does one entry that is not an object, whose `result` is not
  an object or has no `content` list, or whose `replay` is not a boolean.
- A null hello `session_id` (`CLAUDE_CODE_SESSION_ID` unset; a host-fired Claude run always sets it): each call still
  gets its offline answer, no calls-file line is written, and the relay logs one stderr line for each such call.
  Nothing of that run replays.

**Offline answers per tool** (09):

| Tool | Answer text (pinned) | Replay |
|---|---|---|
| `ask_round` | `The app is closed, so no round was shown. Take each item's recommended pick and list every pick as a Decided notice in your reply.` | no |
| `collect_last_round`, `open_primer`, `collect_last_primer`, `collect_last_audio_picker` | left out (did not run) | no |
| `permission_prompt` | one text block `{"behavior":"deny","message":"The app is closed: this run's permission mode does not allow this tool, so it was denied."}` | no |
| `start_session`, `add_practice_problem`, `read_practice_state`, `read_backlog_state`, `set_backlog_chunks` | left out (did not run) | no |
| `set_headless` | `The app is closed: the session stays headless.` | no |
| `set_workflow_step`, `set_workflow_checklist`, `set_workflow_plan` | `Recorded. The app applies it when it opens.` followed by a blank line and `HEADLESS_NOTE` | yes |
| `set_session_title` | `Title recorded. The app applies it when it opens.` | yes |
| `open_audio_picker` | `The app is closed, so no audio picker was shown. Take each moment's recommended candidate, wire it as its play, volume and pitch say, and list every pick as a Decided notice in your reply.` | no |
| `show_live_view` | `The app is closed, so no Live section streams. Carry on without the stream.` | no |
| `hide_live_view` | `The app is closed: no Live section was streaming.` | no |
| the four scheduling tools | left out (did not run) | no |

**Login start, `src/contracts/login-start.ts`** (03 writes the three types; 06, 17, 18 consume them; 18 adds the two
constants):

```ts
export type LoginStartState = 'on' | 'off' | 'needsApproval' | 'unsupported';
// `detail` says why, for the line Schedules mode shows: the approval step, a failure's reason; null otherwise.
export interface LoginStartStatus {
  state: LoginStartState;
  detail: string | null;
}
// Starts the session host when the user logs in, so its pending runs fire after a restart with no app open.
export interface LoginStart {
  // Registers the login start when `on` is true, removes it when false; resolves to the state after. Rewrites a
  // registration that differs from what this build would write. Never rejects: a failure is `off` with `detail`.
  set(on: boolean): Promise<LoginStartStatus>;
}
```

```ts
// 18 adds these two to the same file.
export const LOGIN_START_FLAG = '--start-session-host';
export const LOGIN_START_LABEL = 'wigley-ai-gui.session-host';
```

`MainServices.loginStart: LoginStart` (06). Adapters: `createNoLoginStart()` (`unsupported`, 06),
`createAgentServiceLoginStart(loginItems: LoginItems)` and `createLaunchAgentLoginStart({ files, homeDir,
programArguments })` (18); fake `createFakeLoginStart()` in `src/shared/fake-login-start.ts` (06), recording each
`set` and answering a state the test sets. LaunchAgent path `~/Library/LaunchAgents/wigley-ai-gui.session-host.plist`.

Both login entries run the app executable with `LOGIN_START_FLAG`. `main.ts` (18) checks the flag before
`startLiveApp`, so before its `requestSingleInstanceLock`: a login start never signals a running app's
`second-instance` (which shows its window) and never runs as a second app. Under the flag it sets the accessory
activation policy (no Dock icon), starts the session host detached through `sessionHostLaunch` (13), and exits.

Task 01's result file, `01-login-item-result.md` in this folder, holds the line `Pick: agentService`, `Pick:
launchAgent` or `Pick: none`. Task 18 reads it (← 01): the pick in `main.ts`, and whether `forge.config.mts` changes.

**Scheduling contract, `src/plugins/scheduling/contract.ts`** (03 produces; 10–19 consume):

```ts
// Imports nothing a later wave creates: `login-start.ts` is 03's own, and `ScheduledRunRecord` (which needs chat's
// `AdoptRequest`, 14) lives in 17's `main/run-records.ts`.
import type { StartTarget } from '../chat/contract';
import type { LoginStartStatus } from '../../contracts/login-start';
import type { SessionControl } from '../../contracts/agent';
import type { SlotKey } from '../../contracts/state';
import type { ChannelShape } from '../../contracts/plugin';

// Local time. `time` is `HH:MM`, 24 h. `day` 0 is Sunday … 6. `at` is local `YYYY-MM-DDTHH:MM`.
export type TaskSchedule =
  | { kind: 'hourly'; minute: number }
  | { kind: 'daily'; time: string }
  | { kind: 'weekdays'; time: string } // Monday to Friday
  | { kind: 'weekly'; day: number; time: string }
  | { kind: 'once'; at: string }
  | { kind: 'cron'; line: string }; // five fields

export interface ScheduledTask {
  id: string; // 8 lowercase hex characters
  name: string;
  target: StartTarget; // a `projectDir` may start with `~`
  profile: string;
  prompt: string;
  schedule: TaskSchedule;
  controls: Readonly<Record<string, string>>; // harness control id → value, the permission mode included
  paused: boolean;
  updatedAt: number; // epoch ms of the app's last write of this task
}

// `~/.config/wigley-ai-gui/scheduled-tasks.json`.
export interface TaskFile {
  tasks: ScheduledTask[];
}
export const TASK_FILE_NAME = 'scheduled-tasks.json';

export type RunOutcome = 'running' | 'finished' | 'skipped' | 'failed';
// One history entry. `occurrence` is the schedule time the run stands for (a Run now's is its press time).
// `reason` is a failed run's reason, null otherwise. `rowId` is the run row's `sessionId`, the id `chat.adopt`
// resolved to; `rowId` and `processId` are null for a skipped or failed run. `viewed` is false from a run's start until
// the user views its row after it finished (a run that finishes while its row is selected is viewed at once); true for
// a skipped or failed run. Kept in `history.json`, so a finished run's unviewed mark survives an app restart.
export interface RunHistoryEntry {
  taskId: string;
  occurrence: number;
  at: number;
  outcome: RunOutcome;
  reason: string | null;
  rowId: string | null;
  processId: string | null;
  viewed: boolean;
}

export interface ScheduledTaskView {
  task: ScheduledTask;
  nextRun: number | null; // epoch ms; null while paused, for a spent one-time task, or where the app does not fire
  history: RunHistoryEntry[]; // newest first
}

export interface SchedulingState {
  tasks: ScheduledTaskView[];
  fileError: string | null; // the task file's parse error; the list holds the last good tasks
  fires: boolean; // false in the dev app
  loginStart: LoginStartStatus | null; // null where `fires` is false
  runRows: string[]; // every open run row's sessionId, oldest first
  unviewedRows: string[]; // open run rows whose history entry is `finished` with `viewed` false
}
export const schedulingStateSlot: SlotKey<SchedulingState, 'main', 'scheduling'>; // id `scheduling.state`

// A task as the editor sends it: `id` null for a new task. Main sets `id` and `updatedAt`.
export type TaskDraft = Omit<ScheduledTask, 'id' | 'updatedAt'> & { id: string | null };

// What the editor offers: chat's profiles and project names, and the harness's start controls.
export interface EditorChoices {
  profiles: string[];
  projects: string[];
  controls: SessionControl[];
}

export interface SchedulingChannel extends ChannelShape {
  invoke: {
    saveTask(draft: TaskDraft): Promise<string>; // resolves to the task id; rejects with the reason
    setPaused(id: string, paused: boolean): Promise<void>;
    runNow(id: string): void;
    removeTask(id: string): Promise<void>;
    editorChoices(): EditorChoices;
  };
  messages: Record<never, never>;
}
```

The channel follows `ChatChannel`'s `ChannelShape` form. The three members whose main side writes the task file
return promises, since a main handler returns the declared type.

**`src/plugins/scheduling/schedule.ts`** (03):

```ts
// The schedule `value` holds, or the reason it is not one, naming the bad field.
export function readSchedule(value: unknown): TaskSchedule | string;
// The first occurrence strictly after `after` (epoch ms); null when none comes (a spent one-time task).
export function nextOccurrence(schedule: TaskSchedule, after: number): number | null;
// The latest occurrence in `(after, notAfter]`; null when none.
export function latestOccurrence(schedule: TaskSchedule, after: number, notAfter: number): number | null;
// One line for the list and the tools: `Hourly at :15`, `Daily at 09:00`, `Weekdays at 09:00`,
// `Mondays at 09:00`, `Once on 2026-11-20 at 14:30`, `Cron 0 9 * * 1-5`.
export function scheduleText(schedule: TaskSchedule): string;
```

**`src/plugins/scheduling/task-file.ts`** (03):

```ts
// The tasks `text` holds, or the parse error naming the first bad task and field.
export function readTaskFile(text: string): TaskFile | string;
// The file's text: two-space JSON with a trailing newline.
export function taskFileText(file: TaskFile): string;
```

**Planner, `src/plugins/scheduling/main/planner.ts`** (10):

```ts
export interface PlannedRun {
  taskId: string;
  occurrence: number;
  at: number;
  skipWhileBusy: string | null; // the processId of the task's newest history entry with one
}
// One run per task to queue: a Run now press at `now`, else a catch-up at `now` for the latest missed occurrence,
// else the next occurrence. None for a paused task or a spent one-time task.
export function planRuns(input: {
  tasks: readonly ScheduledTask[];
  history: readonly RunHistoryEntry[];
  runNow: readonly string[]; // task ids pressed since the last plan
  now: number;
  catchUpFloor: number | null; // no catch-up window starts before it; 17's start time when history.json failed to load
}): PlannedRun[];
```

**Stores** (11): `createTaskStore(deps)` returns `{ load(): Promise<void>; tasks(): ScheduledTask[]; error(): string |
null; onChanged(listener): Disposable; save(draft: TaskDraft): Promise<string>; setPaused(id, paused): Promise<void>;
remove(id): Promise<void>; settled(): Promise<void>; dispose(): void }` (its deps include `log`);
`createHistoryStore(files: Files, log: (line: string) => void)` returns `{ load():
Promise<void>; entries(): RunHistoryEntry[]; add(entry): void; update(taskId, occurrence, change:
Partial<RunHistoryEntry>): void; settled(): Promise<void> }`. History keeps the newest 20 entries per task in
`history.json`.

**Run records, `src/plugins/scheduling/main/run-records.ts`** (17 produces; 19 consumes):

```ts
// What a `PendingSpawn.record` holds for a scheduled run.
export interface ScheduledRunRecord {
  taskId: string;
  occurrence: number;
  adopt: AdoptRequest;
}
export function readRunRecord(record: unknown): ScheduledRunRecord | null;
// `rowId` is the sessionId `chat.adopt` resolved to; null for a skipped or failed run.
export function runEntry(run: HostedRun, record: ScheduledRunRecord, rowId: string | null): RunHistoryEntry;
```

**Main part hand-over** (17 produces; 19 consumes): `start.ts` keeps the step it runs for each `HostedRun` it hears
(`onRunStarted`) or reads (`listRuns`) as `adoptRun(run: HostedRun): Promise<void>`, and hands it and the task store
to `schedulingSelfTestScript` (19).

**Main part log lines** (17 writes them under the plugin's id; 21 waits on them): `queued <n> runs` · `adopted run of
<task name> as <row id>` · `skipped run of <task name>: its previous run is still going` · `run of <task name> failed
to start: <reason>` · `run of <task name> not opened: <reason>` · `replayed <n> calls for <row id>` (only when n > 0) · `runs not read: <reason>`. `<task name>`
is the task's name, or its id when the task is gone.

**MCP tools** (15 produces `startTaskTools`; 17 contributes it with `{ mainAgentOnly: true }` and no offline entries):

- `schedule_task` `{ name: string; prompt: string; schedule: TaskSchedule; folder?: string; project?: string;
  profile?: string; controls?: Record<string, string> }` → the new task's id and `scheduleText`. Defaults: the
  calling session's folder; the named project's own profile, else the calling session's. A project with its own
  profile refuses another; an unknown control id is refused. Controls capped through `capControls` at the calling
  session's.
- `list_scheduled_tasks` `{}` → each task's id, name, `scheduleText`, next run (local ISO or `paused`), and last
  outcome, as text and as `structuredContent.tasks`.
- `update_scheduled_task` `{ id: string; name?: string; prompt?: string; schedule?: TaskSchedule; folder?: string;
  project?: string; profile?: string; controls?: Record<string, string>; paused?: boolean }` → the changed task's
  `scheduleText` and state. The controls the task ends with, kept ones included, are capped as for `schedule_task`,
  unless the only field is `paused: true`.
- `remove_scheduled_task` `{ id: string }` → `Removed <name>.`
- A call from a run row (`SchedulingState.runRows`) gets `errorResult('A scheduled run cannot manage scheduled
  tasks.')`.

## Tasks

> `wigley:make` ticks a box once its group is committed and proved, and sets `Status: done` in the
> task document in the same change. The run is done when every box is ticked.

### Wave 1
- [x] [Login item spike](01-login-item-spike.md)
- [x] [Host spawn shape](02-host-spawn-shape.md)
- [x] [Scheduling skeleton, schedule and task file](03-scheduling-skeleton.md)
- [x] [Relay offline mode (marketplace)](04-relay-offline-mode.md)
- [x] [Sessions offline tools](05-sessions-offline-tools.md)
- [x] [File watch reliability](22-file-watch-reliability.md)

### Wave 2
- [x] [Login-start seam](06-login-start-seam.md) — after 03 (modifies its `login-start.ts`)
- [x] [Host pending queue](07-host-pending-queue.md) — after 02
- [x] [Harness prepare-a-run](08-harness-prepare-run.md) — after 02
- [x] [Offline answers per contributor](09-offline-answers.md) — after 05
- [x] [Run planner](10-run-planner.md) — after 03
- [x] [Task and history stores](11-task-and-history-stores.md) — after 03
- [x] [Schedules mode](12-schedules-mode.md) — after 03

### Wave 3
- [x] [Host client queue](13-host-client-queue.md) — after 07
- [x] [Chat prepare and adopt](14-chat-prepare-and-adopt.md) — after 08, 09
- [x] [Scheduling MCP tools](15-task-tools.md) — after 05, 08, 11
- [x] [Scheduled runs section](16-scheduled-runs-section.md) — after 12
- [x] [Session list fixes](23-session-list-fixes.md) — after 05, 09

### Wave 4
- [x] [Scheduling main part](17-scheduling-main-part.md) — after 05, 06, 10, 11, 12, 13, 14, 15
- [x] [Login-start adapters](18-login-start-adapters.md) — after 01, 06, 08, 13
- [x] [One host per channel](24-one-host-per-channel.md) — after 02, 07

### Wave 5
- [x] [Scheduling self-test](19-scheduling-selftest.md) — after 12, 16, 17
- [x] [Hosted turn state](25-turn-state-rule.md) — after 02, 07, 08, 13, 24

### Wave 6
- [x] [Doc re-read](20-doc-re-read.md) — after every task above

### Wave 7
- [ ] [Final verification](21-final-verification.md) — after 20

Coverage decision (task 19, per AGENTS.md § Running and testing): the self-test covers Schedules mode and the
Scheduled runs section over the fake harness, with fixture runs fed through the main part's `adoptRun`, which calls
`chat.adopt`. It cannot cover a
host-fired run, since the fake harness spawns no host process. Firing, the app-closed path and adoption with a real
relay are drive checks in task 21.

## Run log

Review base: a777cb41d0f13bab9e2b467551280556fcdb205a

### Groups
- 02 · hard; compile fix 8b8a40c12 (env row type) · 08b4e3534 · diff read: Produces present; wave 1 typecheck and lint pass after 8b8a40c12 · concerns: test lines hand-wrapped (oxfmt fixed)
- 03 · hard; compile fix 8b8a40c12 (kind key) · 498d9bc9f · diff read: Produces present; wave 1 typecheck and lint pass after 8b8a40c12 · concerns: TZ set at runtime relies on vitest forks pool; DST expectations checked with Python zoneinfo, not the code
- 04 · hard · 53b96493a · diff read: Produces present; wave 1 typecheck and lint pass after 8b8a40c12; relay tests not run (test gate) · concerns: README Calls-file sentence omits that refused and nameless calls write no line
- 05 · hard; compile fix 8b8a40c12 (offlineEnv type) · f12e30333 · diff read: Produces present; wave 1 typecheck and lint pass after 8b8a40c12 · concerns: added replayed:false to chat test literals (outside Files, typecheck needs them); relay/endpoint.ts imports node:path, the task said none
- 22 · hard · c781912c2 · diff read: Produces present; wave 1 typecheck and lint pass after 8b8a40c12 · concerns: kept copy watch may be dead on Linux after folder recreate; it.each options-arg form unchecked; possible rare flake in target-present row
- 01 · hard · 335b4f459 · result file written; every step 5 cleanup check passed · concerns: no approval was asked, possibly from an earlier grant; a clean Mac may still need it; the detached host survives unregister
- 06 · hard · b57725856 · diff read: Produces present; wave 2 typecheck and lint pass after ba5ff01d8 · concerns: none
- 07 · hard; compile fix ba5ff01d8 · 6e4b7e6ad · diff read: Produces present; wave 2 typecheck and lint pass after ba5ff01d8 · concerns: host-link compile gap from RunStartedEvent, patched in ba5ff01d8 until 13
- 08 · hard; compile fix ba5ff01d8 (test row type) · 617927acd · diff read: Produces present; wave 2 typecheck and lint pass after ba5ff01d8 · concerns: attach-replay test traced by hand only
- 09 · hard · 072c4d4f2 · diff read: Produces present; wave 2 typecheck and lint pass after ba5ff01d8; lint accepts workflow/contract.ts value imports · concerns: task 05 offline.json test narrowed to tools.ask since set_session_title now adds an entry
- 10 · hard · f204b9689 · diff read: Produces present; wave 2 typecheck and lint pass after ba5ff01d8 · concerns: a schedule function throw aborts the whole plan; relies on readTaskFile filtering bad schedules
- 11 · hard · b9e0581be · diff read: Produces present; wave 2 typecheck and lint pass after ba5ff01d8 · concerns: a throwing listener logs a line the plan does not pin
- 12 · hard; compile fix ba5ff01d8 · 4e7b0a90f · diff read: Produces present; wave 2 typecheck and lint pass after ba5ff01d8 · concerns: layout contract gained RowKit.cursorActions and FieldRowKit.textBox throw; History header and empty line are the app's
- 13 · hard · 9ecbd6a1d · diff read: Produces present; wave 3 typecheck and lint pass after 29482b015 · concerns: links to older or newer hosts also feed runStarted; never-set row proves by waiting, not a sync point
- 14 · hard · e0c4e038a · diff read: Produces present; wave 3 typecheck and lint pass after 29482b015 · concerns: adopt rejects if a control id vanished between prepare and adopt (17 must forget such a run); onInstructionsChanged listener throws are not caught; holdConnects with a rejecting promise unchecked
- 15 · hard · 759c6353d · diff read: Produces present; wave 3 typecheck and lint pass after 29482b015 · concerns: remove's description makes no claim about a run in progress
- 16 · hard · 4a75e0fc9 · diff read: Produces present; wave 3 typecheck and lint pass after 29482b015 · concerns: section cleanup done by both the part and sessions' tracking (harmless)
- 23 · hard; compile fix 29482b015 · fb012319f · diff read: Produces present; wave 3 typecheck and lint pass after 29482b015 · concerns: edited agent-form-drive.test.ts and sessions-view-fakes.ts for the new required claimed member; a deadline setting change now reaches live sessions
- 17 · hard; compile fix a2e4f76f4 · 5042267b0 · diff read: Produces present; wave 4 typecheck and lint pass after a2e4f76f4 · concerns: quit may wait on an in-flight adopt (stop order unchecked); adoptRun unused until 19
- 18 · hard · aea7ed142 · diff read: Produces present; wave 4 typecheck and lint pass after a2e4f76f4; app fits LoginItems type · concerns: login entry exits before ready: task 21 checks exit 0 and no Dock icon
- 24 · deep · 1c8af15c3 · diff read: Produces present; wave 4 typecheck and lint pass after a2e4f76f4 · concerns: pid reuse after a kill -9 can lock a channel out until that process ends (lock survives reboot); put-back branch untested; stale-socket row is the one that catches the old bug
- 19 · hard · dae39230b · diff read: Produces present; wave 5 typecheck and lint pass; AGENTS.md self-test list gains the script (lead) · concerns: a failed fixture adopt shows only as missing lines (serial catches); group 4 assumes details keep focus after Escape; scrollsItself [] until the fit check runs
- 25 · deep · 144ac8dc0 · diff read: Produces present; wave 5 typecheck and lint pass after formatter pass · concerns: drain ends a process at background_tasks_changed [] and can cut the self-started report turn ~20 ms later (the task's drain test asks for it); touched fake-agent-harness.ts FAKE_IDLE_RULE outside Files for typecheck; dropped-keys pre-filter removed
- 20 · standard · 5506249b0 · diff read: docs match code; no code changed · concerns: LaunchAgent adapter built and tested but unwired in main.ts; adoption finished wording reads process gone, code reads row not running
### Contract changes
### Rulings
- Waves keep 05 beside 04 and 15 beside 14: both dependencies are on plan-pinned formats or injected deps, with no code wait — 05 writes offline.json to the plan's shape, 15 reaches projects through a dep 17 fills — if wrong, a worker finds a missing name and reports BLOCKED · lead
- A once schedule computes its instant directly, with no 8-year horizon — the horizon guards stepping kinds only — a far-off once task still fires · group 03 · group 03
- Schedule functions throw on a schedule readSchedule would refuse — callers only pass read schedules — a caller passing raw JSON throws · group 03 · group 03
- Plugin version 2.16.0, not the plan's 2.4.0: next minor above origin/main's 2.15.0 — re-check at landing if origin moves · group 04 · group 04
- onMissed handlers never reopen a watch (pool-watch re-reads, plan-watch keeps open copy watches, doc-files compares mtime) — on macOS a reopen sends onMissed to every live watch and loops — a stale watch is not refreshed by onMissed · group 22 · group 22
- Malformed run records in a runs file are dropped with a diagnostics line — a bad file must not end the host at load — a dropped record loses that run's history · group 07 · group 07
- A spawn that throws after its run is recorded puts the error in that run's exit, not a second run — one run per pending entry — history shows failed, not two entries · group 07 · group 07
- skipWhileBusy is set on Run now and catch-up runs too — the overlap rule holds for every run — a Run now pressed while the previous run is busy is skipped by the host · group 10 · group 10
- Task store runs watch reads, onMissed reads, load and every mutation on one queue — its own write then emits one change — none · group 11 · group 11
- setPending while adopt waits on its drain only stores the list; adopt sends the latest once the drain settles — two hosts never hold the queue at once — a list set mid-drain goes out late · group 13 · group 13
- An update giving folder or project without profile takes the new project's own profile, else keeps the old — follows schedule_task's default — a project switch can keep a profile the user did not expect · group 15 · group 15
- No plan is sent until a listRuns read has succeeded; a failed read turns sending off until the 10 s retry succeeds — runs the host fired unseen must be adopted before re-planning — a host that cannot list keeps its old queue · group 17 · group 17
- After chat.restored(), a running entry is finished when its row is not open, as well as when its session reads not running — a closed row cannot finish later — none · group 17 · group 17
- design.md drain wording now 'once it reads idle' · group 25
- Protocol stays 4: no build carrying protocol 4 was installed between tasks 07 and 25, so the IdleRule fields need no bump — lead
### Review rounds
- R1 · 8e6865c20 · NEEDS FIXES: 2 critical, 19 important, 22 minor; 9 lead-applied (e984c3171); fixes e984c3171..c3e5e2535 · tier High (host protocol handoff, channel lock, busy state, adoption) → correctness re-review
### Test gate
