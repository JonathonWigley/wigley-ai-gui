# 21 — Final verification

Status: not started
Type: Task
Wave: 7 · Depends on: 20
Plan: [plan.md](plan.md)

Files:     none in the repo (captures stay in the drive run folder under `<gui>/.drive/`, which git ignores)
Consumes:  Schedules mode and its editor ← 12 · the Scheduled runs section and the `done` row activity ← 16 · the
           pinned `[scheduling] …` log lines (plan.md § Shared names › Main part log lines) ← 17 · `TASK_TOOLS` names
           ← 15 · the offline answers ← 09 · the relay's offline mode ← 04 · the login entry `LOGIN_START_FLAG`
           ← 18 · the `drive` skill (`<gui>/.claude/skills/drive/SKILL.md`, tree) · `~/wigley-agents/WigleyRepos.md`
           § Landing (tree)
Produces:  a check report in the Proof section: each check below with its result and the capture paths

## Decisions

- **Why a live run.** The change starts agent runs from a detached process, across a new host protocol, while the
  app may be closed. No test spans the socket, the real relay and real Claude together. The checks below are only the
  paths no task's test covers (`wigley:writing-tests` § What earns a live run instead). The planner rules, the cron
  dialect, the skip rule, the offline table, the cap and the dev app's no-fire rule are each pinned by a test in tasks
  03–17 and get no live check.
- **Real Claude.** Checks 3–5, 10 and 11 start with `--harness claude`: the fake harness starts no process in the session host,
  so only real Claude fires a host run. It spends tokens of the user's plan; each run's prompt is one short reply, and
  the report names this spend.
- **Run folder.** One run, `--run sched-check`, with the user's chat profiles (only a profile logged in to Claude
  starts). Pass `--run sched-check` on every command. `<run>` below is `<gui>/.drive/sched-check`; `<endpoint>` is
  the folder `find <run>/home/.agents -name endpoint.json` finds.
- **The user's task file stays out of the run.** `--user-config` copies the whole of `~/.config/wigley-ai-gui`, the
  user's `scheduled-tasks.json` included, and a drive run fires (`runMode` is not `live`) with real Claude, so a
  copied task would run in the user's real folders at the user's cost. So, before the first start:
  1. `test -e ~/.config/wigley-ai-gui/scheduled-tasks.json; echo $?`.
  2. `1` (absent): start with `npm run drive -- start --run sched-check --harness claude --user-config`.
  3. `0` (present): make the home by hand, without the task file: `mkdir -p <run>/home/.config`, `cp -R
     ~/.config/wigley-ai-gui <run>/home/.config/`, `rm <run>/home/.config/wigley-ai-gui/scheduled-tasks.json` (the
     run's copy only), then start with `npm run drive -- start --run sched-check --harness claude`, no
     `--user-config`: `start` reuses a home the run folder holds.
  4. Either way, before check 1: `test -e <run>/home/.config/wigley-ai-gui/scheduled-tasks.json; echo $?` reads `1`,
     and `queued 0 runs` is in the log. Otherwise quit the run at once (`npm run drive -- quit --run sched-check`)
     and stop: report to the lead.
- **Times.** A one-time task's `at` is the local minute five minutes ahead: `date -v+5M +%Y-%m-%dT%H:%M` (BSD
  `date`). A daily task's time is twelve hours ahead, `date -v+12H +%H:00`, so no daily task fires during the run.
- **Waiting on a line.** `wait-log` takes one literal whole line and counts only lines logged after the call starts,
  and the CLI blocks, so it cannot wait for a line that holds a variable or one an earlier command already caused.
  Read the log with `npm run drive -- log --run sched-check` (and `<run>/app.log` for main's lines when `log` lacks
  them), polled with the Monitor tool's until-loop, and match with `command grep`. `wait-log` stays for a literal
  line the next command causes. Never a foreground `sleep`.
- **Keys.** Open Schedules mode with `<Leader>kt` (`key Space k t`). Drive the list and the editor with the keys task
  12 bound; read them from `src/plugins/keymap.ts` and the mode's key hints before the first step.
- **Stop on a failure.** A check that fails is a finding: record what the capture shows, keep the run, and report it
  to the lead. Do not fix code in this task.
- **The user's checks** (the Dock badge, firing after a real logout or restart, no Dock icon flashing at a login
  start, no spike entry left in System Settings > General > Login Items, and the picked login adapter registering
  once the installed stable app holds an active task and removing its entry once none is active) are not in this
  plan; the lead lists them in the wrap-up. The picked adapter is the user's check because drive and self-test runs
  get the no-op adapter (18), so no run here can register it; tasks 01 and 06 defer to this line.

## Precondition

The relay that real Claude runs is the one in the profile's installed wigley plugin, not the worktree's marketplace
folder. So before checks 3–5, 10 and 11 (the real-Claude checks), land the branch, which holds task 04's work and its plugin
version bump, and update the plugin:

1. Both folders, `wigley-ai-gui` and `wigley-ai-marketplace`, are one commit range on one branch of the `ai` repo, in
   the worktree `/Users/jonathonwigley/Documents/.worktrees/ai-scheduled-tasks` (the README commits written ahead,
   then 04's code and version-bump commit, then every other task's). Land that branch per
   `~/wigley-agents/WigleyRepos.md` § Landing steps 2–5: rebase onto `main` and fast-forward `main` (step 2, polling
   while `main` is unavailable), remove the worktree and the branch (step 3), push `ai`'s `main` (step 4, per
   § Syncing; the user's standing yes in § Landing covers it), and update the plugin for every Claude Code profile
   (step 5). Read § Landing and § Syncing before the first step. Before the push, write one chat line naming it, for
   example `Pushing main of the ai repo per WigleyRepos.md § Landing step 4 (standing yes; bypasses main's PR
   protection).`: the auto-mode classifier reads chat, not forms (`~/wigley-agents/ClaudeCode.md` § Harness).
2. Confirm the installed relay holds offline mode in the config folder real Claude uses in the run: the folder of
   the first profile in chat's `profiles` setting (the profile `chat.start` uses), read from the run home's copied
   config. `find <that folder>/plugins/cache -path '*wigley*/scripts/forms/relay.py' -print0 | xargs -0 command grep
   -c WIGLEY_FORMS_OFFLINE`, read for the version folder that `<that folder>/plugins/installed_plugins.json` names
   for the wigley plugin; that version equals 04's bump.

When a landing step is refused, or no installed relay holds `WIGLEY_FORMS_OFFLINE` after it, stop before check 3 and
report to the lead with the step and its output. Checks 1, 2, 6–9 and 12 run either way.

## Checks

1. **Schedules mode and the editor draw as `DESIGN.md` says** — expected path; low confidence for layout, which no
   test sees. Open Schedules mode, press "+ New task", fill it: name `Drive check`, folder `<run>/home/dev/drive-project`
   (make it first with `mkdir -p`), the first profile, prompt `Reply with the single word done.`, schedule daily at
   `<T1>` (`date -v+12H +%H:00`), save. Screenshot the empty mode, the editor, and the list with the task selected.
   Read each against `DESIGN.md` (lists, detail panes, forms, empty states). Then `cat
   <run>/home/.config/wigley-ai-gui/scheduled-tasks.json`: it holds the task with an 8-hex id. Pass: the task shows
   with `Daily at <T1>` and a next run; the file matches.
2. **The task file hot reloads and a broken file shows its error** — low confidence: the watch wiring has no test over
   the real file service. Write the file with one task's `schedule.time` set to `9:00` (python3 or a heredoc).
   Pass: Schedules mode shows the parse error naming `schedule.time` and keeps the last good task; restoring the
   file clears the error. Screenshot the error state.
3. **Run now fires through the host with the app open** — low confidence: the host push, chat's adopt and the
   section have no test together. Select `Drive check`, press Run now. Poll the log for a line matching
   `^\[scheduling\] adopted run of Drive check as \S+$`. Pass: the row shows in the Scheduled runs section, headless, its first message the prompt;
   after the turn ends the row shows the `done` activity, raised, and the task's history shows a Finished line that
   links to the row. Screenshot the section and the history before and after selecting the row; after selecting, the
   `done` mark is gone.
4. **A run fires while the app is quit, and its reports replay at adoption** — low confidence: the relay's offline
   mode with real Claude and the replay through `replayCalls` have no test together. Create task `Offline check` in
   the same folder, schedule once at five minutes ahead, prompt `Call the set_session_title tool with the title
   Scheduled offline check, then reply with the single word done.` Poll the log for `[scheduling] queued 2 runs`
   (Drive check and Offline check) after the save. Record whether the user's stable app runs (`pgrep -f
   /Applications/wigley-ai-gui.app`). Then `npm run drive -- quit --run sched-check --keep-sessions`. This check also
   covers 07's host that fires with no client from a pending file it read at start: before the time, read the run's
   host command line (`ps -o command= -p <pid>` for the `pgrep -fl session-host` process naming `<run>/user-data`;
   its paths hold no spaces), stop that host (`kill <pid>`; it is the drive run's own host, not the user's), and start
   it again with the same arguments and `ELECTRON_RUN_AS_NODE=1`, detached, in the background. Pass, in order:
   - the restarted session host runs (`pgrep -fl session-host` shows a process whose arguments name
     `<run>/user-data`) and `<run>/user-data/session-host/pending-v4.json` still holds the Offline check entry;
   - after the time, `<endpoint>/offline-calls/<session id>.jsonl` exists and holds a `set_session_title` line with
     `"replay": true`;
   - the user's stable app's running state did not change (the relay started no app);
   - `npm run drive -- start --run sched-check` brings the app back (it logs the adoption during its own startup, so
     read the log after `start` returns), the log holds lines matching `^\[scheduling\] adopted run of Offline check
     as \S+$` and `^\[scheduling\] replayed 1 calls for \S+$`; the row is in Scheduled runs with the title
     `Scheduled offline check`; the history shows Finished; the calls file is gone.
   - Then the host is replaced while the app runs (13's client handing its queue to a new host): stop the run's host
     as above. Pass: within a minute a new `session-host` process names `<run>/user-data`, the log holds a new
     `[scheduling] queued 1 runs` (Drive check) after the stop, and the new host's `pending-v4.json` holds the Drive
     check entry.
5. **An agent's `schedule_task` is capped at its session's mode** — low confidence: the cap runs on real Claude's
   control ids only here. `npm run drive -- do chat.start '{"projectDir":"<run>/home/dev/drive-project"}'`, set the
   row's permission mode to `manual` with the mode control's key, press `key i` (a `chat.start` row's composer opens
   in vim NORMAL mode), then type and send `Call the schedule_task tool with name Capped check, prompt Reply done.,
   schedule {"kind":"daily","time":"<T2>"} and controls {"mode":"auto"}.`, with `<T2>` from `date -v+13H +%H:00`.
   In `manual` mode the call may raise a permission card: take a screenshot, read its allow key from the card's
   hints, and allow it once. Pass: Schedules mode lists `Capped check` and its details show the mode `manual`; the
   task file agrees.
6. **The endpoint files list the tools and the offline table** — expected path, a file read. `<endpoint>/tools.json`
   lists `schedule_task`, `list_scheduled_tasks`, `update_scheduled_task` and `remove_scheduled_task`;
   `<endpoint>/offline.json` lists none of the four and holds the pinned texts of plan.md § Offline answers per tool
   for `ask_round`, `permission_prompt`, `set_headless`, `set_session_title`, the three workflow tools,
   `open_audio_picker`, `show_live_view` and `hide_live_view`. Assert the
   key set once, as the merged table of every contributor (09 checks each contribution alone): `python3 -c` reading
   `sorted(json.load(open('<endpoint>/offline.json'))['tools'])` equals exactly `['ask_round', 'hide_live_view',
   'open_audio_picker', 'permission_prompt', 'set_headless', 'set_session_title', 'set_workflow_checklist',
   'set_workflow_plan', 'set_workflow_step', 'show_live_view']`.
7. **Clean up and leave nothing running** — expected path. Remove every task through Schedules mode; poll the log
   for a `[scheduling] queued 0 runs` line after the last remove; close the run rows; `npm run drive -- quit --run sched-check`. Pass: no
   `session-host` process names `<run>/user-data` (`pgrep -fl session-host`). A host left alive is a finding: report
   it to the lead with its pid, and stop it only with the lead's word.
8. **No login item from the spike is left** — expected path; the lead settled that this task checks what a command
   can read. `command ls ~/Library/LaunchAgents | command grep -i wigley` and `launchctl print gui/$(id -u) | command
   grep -i wigley`. Pass: neither names the scratch registration task 01 recorded (its label is in
   `01-login-item-result.md`). A registration that is left is user state: report it to the lead with its label and
   path, and remove nothing. The System Settings > General > Login Items list is the user's eyes: the lead puts it
   in the wrap-up, not here.
9. **The login entry starts the host and exits, with no window** — low confidence: the entry spawns a real process
   and quits the app, which no test runs (18). The command is the dev build the drive run used:
   `<gui>/node_modules/.bin/electron <gui> --start-session-host`, run from `<gui>` in the background, with no
   `WIGLEY_DRIVE_DIR` and no `PROOF_SELFTEST` set. Outside drive the run mode is `live` and the app instance is the
   dev one, so 18's entry uses the user's real dev host folder, `~/Library/Application
   Support/wigley-ai-gui-dev/session-host` (not `<run>/user-data`, which checks 4 and 7 name). So run it only when
   no dev app is open, no `npm run drive` run is live, and `pgrep -fl session-host` shows no process naming that
   folder; otherwise skip this check and tell the lead, who puts it in the wrap-up as the user's check. Before and
   after, list the folder (`command ls -la`); a file that was there before and is changed or gone after is a
   finding, reported to the lead. Pass: the entry exits 0 within 10 s, having opened no window (no window of the dev
   app shows in `lsappinfo list` under the entry's pid while it runs); a `session-host` process whose arguments name
   that folder appears (`pgrep -fl session-host`, polled with the Monitor tool's until-loop); and that host, with no
   client and an empty queue, exits by itself within a minute. A host left alive is a finding, reported as in check
   7.
10. **A chat row's forms round shows a 300 s deadline** — low confidence: 23's deadline read crosses forms, sessions
    and the relay. `npm run drive -- do chat.start '{"projectDir":"<run>/home/dev/drive-project"}'`, then send a prompt
    that makes the agent call `ask_round` with one item. Pass: the round shows a 300 s deadline, not 240 s. Screenshot
    it, then answer or close the round.
11. **An interrupted background-subagent session ends at the keep window, and the host exits after** — low
    confidence: 25's turn-state rule has no test against real Claude. On a `--harness claude` row, ask the agent to
    start one background subagent that waits (for example `Start a background subagent that sleeps 120 seconds, then
    reply done.`), interrupt the row, then quit the app with `--keep-sessions`. Pass: the session's process ends
    at the keep window (`pgrep -fl` for its pid), and the host exits after it, with no client and an empty queue
    (`pgrep -fl session-host` names no process for `<run>/user-data`). A process or host left alive is a finding,
    reported as in check 7.
12. **Two hosts started together leave one listener** — optional, low confidence: 24's lock has only tests. Start
    two session hosts with the same arguments at once (the command line check 4 reads), and wait ten seconds. Pass:
    `lsof -U` or `pgrep -fl session-host` shows one host holding the channel; the other has exited. Stop the
    survivor as in check 7.

GIVEN the landed run WHEN the checks above run THEN each passes, or its failure is reported with its captures

## Tests

None added: this task runs live checks only.

Done when: each check has a result in the Proof section with its capture paths; the drive run is quit; checks 7, 8
and 9 report nothing left, or the lead has the report; the landing of the `ai` branch ran, or the lead has the refused step.
Commit:    none (the Proof section rides in the lead's next commit)

## Proof
