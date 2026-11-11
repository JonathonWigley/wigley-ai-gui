# 04 — Final verification

Status: not started
Type: Task
Wave: 2 · Depends on: 01, 02, 03
Plan: [plan.md](plan.md)

`wigley:make` walks this task once, in its live session after the test gate. Risk: High (a contract two repos
share, and process lifecycle), so each flow the change touches gets a live run.

Setup:
- Run on macOS, with the dev app. Run the marketplace worktree's `start_app.py`, so the new code runs before the
  plugin update.
- Before any quit: when a dev app is running that this session did not start, ask the user before quitting it. It
  holds the user's view, and its sessions survive on the session host, but it is the user's app. When no dev app
  runs, start one with `npm start` in the wigley-ai-gui worktree that holds task 01.
- That worktree runs on the clone's dependencies: `ln -s <clone>/node_modules <worktree>/node_modules`
  (`~/wigley-agents/WigleyRepos.md` § Landing step 1). The link installs nothing.
- For check 5, add a second checkout of task 01's commit: `git -C <clone> worktree add --detach
  ../.worktrees/wigley-ai-gui-app-restart-from <task 01 commit>`, with the same `node_modules` link. Remove it with
  `git worktree remove` after the checks. Both checkouts then write `pid`.
- Never restart the stable app in this check: it holds this session.
- To watch the relay, start `relay.py` from the marketplace worktree with
  `WIGLEY_AI_GUI_ENDPOINT_DIR=/Users/jonathonwigley/.agents/wigley-ai-gui-dev`, send it `initialize` and
  `notifications/initialized` on stdin, and send a `tools/list` after each restart. Low confidence on this
  harness: the relay may need a hello field the env does not set. When it does, use a Claude session the dev app
  starts through its Chat tab instead (a drive run is no help: its endpoint folder is its own).

Checks:
1. Expected: `endpoint.json` in `~/.agents/wigley-ai-gui-dev/` holds `pid`, and that pid is the dev app's
   Electron main process (`ps -o pid=,args= -p <pid>`).
2. Expected (the brief's test, baseline): restart by hand — `kill <pid>` of the dev app's Electron main process
   only (the pid check 1 found; no `pkill`, whose patterns can hit the stable app that holds this session), wait
   for it to exit, then `python3 start_app.py` with `WIGLEY_AI_GUI_ENDPOINT_DIR` set to the dev folder. The relay
   answers `tools/list` from the new app.
3. Expected: `python3 start_app.py --restart --dev`. It prints a ready line. The old pid is gone, `endpoint.json`
   holds a new pid, no process of the old `npm start` (forge, Vite, Electron) is left (`pgrep -fl electron-forge`
   shows one start), and the relay answers `tools/list` from the new app.
4. Low-confidence (forge exit path, read from source only): after check 3, no orphan forge or Vite process of the
   old start remains.
5. Expected: `python3 start_app.py --from ../.worktrees/wigley-ai-gui-app-restart-from` (the second checkout from
   Setup). `endpoint.json`'s `launch.cwd` names that checkout, and its pid differs from the one before.
6. Low-confidence: with the dev app stopped, `python3 start_app.py --restart --dev` starts it (a plain start).

Dropped (a test already pins each): the missing-`pid` failure, the 15 s limit, `--from` refusals before any quit,
a failing quit, argument parsing, bad `pid` values (task 02's `RestartTests`, `read_endpoint` and `parse_args`
tables); the endpoint `pid` (task 01's tests).

The user's check, for the wrap-up only: on the Windows machine, `python3 start_app.py --restart` closes the running
app's window, the app exits, and a new one starts. No Windows machine is reachable here.

Close-out after the checks pass:
- Delete `~/wigley-agents/learning/briefs/gui-app-restart-script.md` and commit the deletion in `~/wigley-agents`
  (the brief's "When it lands").
- Land both repos per `~/wigley-agents/WigleyRepos.md` § Landing, the plugin update included.

## Proof
