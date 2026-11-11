# 02 — Restart in start_app.py

Status: done
Type: Task
Rung: deep · stops and starts another process across the app and its relay: process lifecycle and timing
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Repo: wigley-ai-marketplace. Work in a worktree per `~/wigley-agents/WigleyRepos.md` § Landing. The rules in
README § Restarting the app (written ahead) are the spec; this task document pins what the README leaves open.

Files:     modify `plugins/wigley/scripts/forms/start_app.py` · test `plugins/wigley/scripts/forms/tests/test_start_app.py`
           · modify `plugins/wigley/.claude-plugin/plugin.json` · modify `plugins/wigley/.codex-plugin/plugin.json`
Consumes:  the `endpoint.json` key `pid` ← 01 (a JSON integer). The tests fake the file, so this task does not
           wait for 01.
Produces:  in `start_app.py`:
           `class Endpoint(NamedTuple)` with a fourth field `pid: int | None`
           `DEV_ENDPOINT_DIR = Path.home() / ".agents" / "wigley-ai-gui-dev"`
           `QUIT_WAIT_SECONDS = 15.0`
           `def quit_process(pid: int, platform: str = sys.platform) -> None`
           `def process_exited(pid: int, platform: str = sys.platform) -> bool`
           `def restart_app(endpoint_dir: Path, from_folder: Path | None = None, env=os.environ, spawn=None,
               accepts=channel_accepts, installed_app=installed_app_command, quit=quit_process,
               exited=process_exited, quit_wait=QUIT_WAIT_SECONDS, launch_wait=LAUNCH_WAIT_SECONDS,
               poll=POLL_SECONDS, platform=sys.platform) -> StartResult`
           `def parse_args(argv: list[str], env) -> tuple[Path, bool, Path | None]` — the endpoint folder, whether
               to restart, and the `--from` folder
Decisions:
- `read_endpoint` reads `pid` only when it is an `int`, not a `bool`, and greater than 0; any other value, and a
  missing key, reads as `None`. A missing `pid` keeps the file readable: an app built before task 01 writes none,
  and the relay must still find it. A bad `pid` must never reach `os.kill`: `0` signals the caller's process
  group and `-1` every process the user owns.
- `restart_app` order. It reads the endpoint file once, in step 1, and every later step uses that `Endpoint`; it
  never reads the file again before the launch, since the old app rewrites it while it stops.
  1. When `spawn` is `None`, build the default once, as `start_app` does:
     `functools.partial(spawn_detached, log=endpoint_dir / START_LOG)`. Pass this `spawn` to every later step.
  2. Read the endpoint. With `from_folder`, check it now, before any quit: `from_folder` is an existing directory,
     the endpoint file exists, and its recorded `command` ends in `"start"` (an npm start). A failed check returns
     a failed `StartResult` naming the folder, the missing file or the recorded command. Nothing is quit.
  3. When the file exists and its channel accepts:
     - `pid` is `None` → return a failed `StartResult` that names the endpoint file and says the running app
       records no process id, so it predates the restart; quit it by hand. Quit and start nothing.
     - else call `quit(pid)` once. An `OSError` from `quit` returns a failed `StartResult` naming the pid and the
       error, and starts nothing. Then poll `exited(pid)` every `poll` seconds up to `quit_wait`. Still running at
       the limit → return a failed `StartResult` that names the pid and the 15 s, and start nothing. Never
       force-kill, and never call `quit` a second time.
  4. With no `from_folder`: return `start_app(...)` with the same injected arguments and the `spawn` from step 1.
  5. With `from_folder`: spawn the step-2 `endpoint.command` with `cwd=str(from_folder)` through `spawn_or_fail`
     (a `StartFailed` becomes a failed `StartResult`), close the launch in a `finally`, and return
     `wait_for_channel(...)`. No installed-app fallback for `--from`.
- The new start begins as soon as the Electron pid has exited. Under `npm start`, forge's Vite plugin then runs
  `exitHandler({ cleanup: true, exit: true })` synchronously: it kills its Vite watch children, closes its dev
  servers and calls `process.exit(0)`. It does not touch `.vite/build` (`VitePlugin.js` lines 388–406, plugin-vite
  8.0.1), so the overlap with the new start is milliseconds of process teardown. Task 04 check 4 confirms that no
  old forge or Vite process remains.
- `quit_process`: on `win32`, run `powershell.exe -NoProfile -NonInteractive -Command "Get-Process -Id <pid>
  -ErrorAction SilentlyContinue | ForEach-Object { try { [void]$_.CloseMainWindow() } catch {} }; exit 0"`, the
  command `scripts/install-app.mts` `quitStableApp` runs, through `subprocess.run(..., check=False)`. The exit code
  is not checked: the command ends `exit 0` in every case. A spawn failure raises `OSError` to `restart_app`. Else
  `os.kill(pid, signal.SIGTERM)`: a `ProcessLookupError` counts as already quit; any other `OSError` (such as
  `PermissionError`) raises to `restart_app`. Electron's POSIX main parts turn SIGTERM into `app.quit()`, which
  the app's `will-quit` handler holds until every part stops (`src/main/main.ts` line 531 in wigley-ai-gui).
- `process_exited`: on POSIX, `os.kill(pid, 0)`: `ProcessLookupError` → `True`; success or `PermissionError` →
  `False`. On `win32`, open the process with `_winapi.OpenProcess(_winapi.SYNCHRONIZE, False, pid)` and check
  `_winapi.WaitForSingleObject(handle, 0) == _winapi.WAIT_OBJECT_0`; close the handle. An `OSError` on open counts
  as exited only when its `winerror` is 87 (`ERROR_INVALID_PARAMETER`: no such process); any other error, such as
  access denied, counts as running. Unchecked claim: confirm each `_winapi` name exists in CPython's `_winapi`
  module source before use, else call `kernel32` through `ctypes`. No Windows machine is reachable here.
- `parse_args` uses `argparse` with `--restart`, `--dev` and `--from <folder>`. `--from` implies `--restart` and
  `--dev`. `--dev` gives `DEV_ENDPOINT_DIR`; `--dev` alone is a plain start of the dev app. With neither, the folder
  is `endpoint_dir(env)`. `--from` resolves the folder to an absolute path (`Path(folder).resolve()`). A bad flag
  exits 2 with argparse's usage, as argparse does.
- `main()` calls `parse_args(sys.argv[1:], os.environ)`, then `restart_app` or `start_app`. It prints the result as
  today: the message when ready, else `The wigley-ai-gui app could not be started: <message>`. Exit 0 or 1 as
  today. The ready message after a restart that quit an app says the app restarted.
- Update the module docstring: it names the restart and README § Restarting the app.
- Bump `version` one patch past `origin/main`'s (2.6.6 at plan time, so 2.6.7) in both plugin manifests in this commit (marketplace `AGENTS.md` § Changing a
  plugin).
GIVEN an app answers and records pid 4242 WHEN `restart_app` runs THEN `quit` gets 4242, `exited` is polled, and
  the recorded command spawns after `exited` returns True
GIVEN an app answers and records no pid WHEN `restart_app` runs THEN it fails, and neither `quit` nor `spawn` runs
GIVEN no app answers WHEN `restart_app` runs THEN `quit` does not run and the app starts as `start_app` starts it
GIVEN `exited` stays False WHEN `quit_wait` passes THEN it fails naming the pid, `quit` ran exactly once with that
  pid, and `spawn` does not run
GIVEN `quit` raises `PermissionError` WHEN `restart_app` runs THEN it fails naming the pid, and `spawn` does not run
GIVEN `from_folder` and a recorded npm start WHEN `restart_app` runs THEN `spawn` gets the recorded command with
  `cwd` equal to the folder
GIVEN `from_folder` and an app answering with a pid, and no endpoint file, or a recorded command not ending in
  `start`, or a folder that does not exist WHEN `restart_app` runs THEN it fails, and neither `quit` nor `spawn` runs
GIVEN no `spawn` argument WHEN `restart_app` starts the app THEN it spawns through `spawn_detached` with the start
  log in the endpoint folder
GIVEN an endpoint file whose `pid` is 4242, missing, `0`, `-1`, `true` or `"4242"` WHEN `read_endpoint` reads it
  THEN `pid` is 4242, or None for every other row
GIVEN argv `["--from", "x"]`, `["--restart", "--dev"]`, `["--dev"]`, `["--restart"]`, `[]` WHEN `parse_args` runs
  THEN it gives (DEV_ENDPOINT_DIR, True, absolute x), (DEV_ENDPOINT_DIR, True, None), (DEV_ENDPOINT_DIR, False,
  None), (endpoint_dir(env), True, None), (endpoint_dir(env), False, None)
GIVEN `quit_process(4242, "linux")` WHEN it runs THEN it calls `os.kill(4242, SIGTERM)`, and a
  `ProcessLookupError` from it returns normally; `quit_process(4242, "win32")` runs the PowerShell argv above
Tests:     in `tests/test_start_app.py`, with the fakes `StartAppTestCase` already uses (`FakeLaunch`, an injected
           `accepts`, a temp endpoint folder):
- a new `RestartTests(StartAppTestCase)` class, one test per GIVEN above about `restart_app`, with a fake `quit`
  that records each pid it gets and a fake `exited` driven by a list of answers. Use `quit_wait` and `poll` small
  enough that the suite does not wait in real time. The default-`spawn` test patches `start_app.spawn_detached`
  with a fake through `unittest.mock.patch`.
- `read_endpoint`: the six rows in one table test.
- `parse_args`: the five rows in one table test.
- `quit_process`: one table test over the two platforms, with `os.kill` and `subprocess.run` patched.
- `process_exited`: on POSIX, the test process's own pid is not exited, and the pid of a finished
  `subprocess.Popen([sys.executable, "-c", "pass"])`, after `wait()`, is exited. Skip on `win32`.
Done when: `(cd plugins/wigley/scripts/forms && python3 -m unittest discover)` and the four checks in marketplace
           `AGENTS.md` § Done pass; the test gate runs the tests above.
Commit:    one commit for the group, the version bump included.

## Proof

Commit marketplace 8f13bb5 · proof: diff read: Endpoint.pid, DEV_ENDPOINT_DIR, QUIT_WAIT_SECONDS, quit_process, process_exited, restart_app, parse_args present with planned signatures; py_compile passes; version 2.6.8 in both manifests · concerns: step 4's start_app re-reads endpoint.json after the old pid exits (plan's step 4 vs its read-once line); POSIX zombie reads as running; _winapi OpenProcess winerror unchecked on Windows
