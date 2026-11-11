# 02 — Restart in start_app.py

Status: not started
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
- `read_endpoint` reads `pid` when present and an `int`, else `None`. A missing `pid` keeps the file readable: an
  app built before task 01 writes none, and the relay must still find it.
- `restart_app` order:
  1. Read the endpoint. When the file exists and its channel accepts:
     - `pid` is `None` → return a failed `StartResult` that names the endpoint file and says the running app
       records no process id, so it predates the restart; quit it by hand. Quit and start nothing.
     - else call `quit(pid)`, then poll `exited(pid)` every `poll` seconds up to `quit_wait`. Still running at the
       limit → return a failed `StartResult` that names the pid and the 15 s, and start nothing. Never force-kill.
  2. With no `from_folder`: return `start_app(...)` with the same injected arguments.
  3. With `from_folder`: the endpoint file must exist and its recorded `command` must end in `"start"` (an npm
     start). Else return a failed `StartResult` naming the recorded command, or the missing file. Then spawn
     `endpoint.command` with `cwd=str(from_folder)` through `spawn_or_fail`, close the launch in a `finally`, and
     return `wait_for_channel(...)`. No installed-app fallback for `--from`.
- `quit_process`: on `win32`, run `powershell.exe -NoProfile -NonInteractive -Command "Get-Process -Id <pid>
  -ErrorAction SilentlyContinue | ForEach-Object { try { [void]$_.CloseMainWindow() } catch {} }; exit 0"`, the
  command `scripts/install-app.mts` `quitStableApp` runs. Else `os.kill(pid, signal.SIGTERM)`, and a
  `ProcessLookupError` counts as already quit.
- `process_exited`: on POSIX, `os.kill(pid, 0)`: `ProcessLookupError` → `True`; success or `PermissionError` →
  `False`. On `win32`, open the process with `_winapi.OpenProcess(SYNCHRONIZE, False, pid)` and check
  `_winapi.WaitForSingleObject(handle, 0) == WAIT_OBJECT_0`; an `OSError` on open → `True`. Close the handle.
- `parse_args` uses `argparse` with `--restart`, `--dev` and `--from <folder>`. `--from` implies `--restart` and
  `--dev`. `--dev` gives `DEV_ENDPOINT_DIR`. With neither, the folder is `endpoint_dir(env)`. `--from` resolves the
  folder to an absolute path (`Path(folder).resolve()`).
- `main()` calls `parse_args(sys.argv[1:], os.environ)`, then `restart_app` or `start_app`. It prints the result as
  today: the message when ready, else `The wigley-ai-gui app could not be started: <message>`. Exit 0 or 1 as
  today. The ready message after a restart that quit an app says the app restarted.
- Update the module docstring: it names the restart and README § Restarting the app.
- Bump `version` from 2.6.5 to 2.6.6 in both plugin manifests in this commit (marketplace `AGENTS.md` § Changing a
  plugin).
GIVEN an app answers and records pid 4242 WHEN `restart_app` runs THEN `quit` gets 4242, `exited` is polled, and
  the recorded command spawns after `exited` returns True
GIVEN an app answers and records no pid WHEN `restart_app` runs THEN it fails, and neither `quit` nor `spawn` runs
GIVEN no app answers WHEN `restart_app` runs THEN `quit` does not run and the app starts as `start_app` starts it
GIVEN `exited` stays False WHEN `quit_wait` passes THEN it fails naming the pid, and `spawn` does not run
GIVEN `from_folder` and a recorded npm start WHEN `restart_app` runs THEN `spawn` gets the recorded command with
  `cwd` equal to the folder
GIVEN `from_folder` and no endpoint file, or a recorded command not ending in `start` WHEN `restart_app` runs
  THEN it fails and `spawn` does not run
GIVEN an endpoint file with and without `pid` WHEN `read_endpoint` reads it THEN `pid` is the integer, or None
GIVEN argv `["--from", "x"]`, `["--restart", "--dev"]`, `["--restart"]`, `[]` WHEN `parse_args` runs THEN it gives
  (DEV_ENDPOINT_DIR, True, absolute x), (DEV_ENDPOINT_DIR, True, None), (endpoint_dir(env), True, None),
  (endpoint_dir(env), False, None)
Tests:     in `tests/test_start_app.py`, with the fakes `StartAppTestCase` already uses (`FakeLaunch`, an injected
           `accepts`, a temp endpoint folder):
- a new `RestartTests(StartAppTestCase)` class, one test per GIVEN above about `restart_app`, with a fake `quit`
  that records its pid and a fake `exited` driven by a list of answers. Use `quit_wait` and `poll` small enough
  that the suite does not wait in real time.
- `read_endpoint` with and without `pid`: rows in one test.
- `parse_args`: the four rows in one table test.
- `process_exited`: on POSIX, the test process's own pid is not exited, and the pid of a finished
  `subprocess.Popen([sys.executable, "-c", "pass"])`, after `wait()`, is exited. Skip on `win32`.
Done when: `(cd plugins/wigley/scripts/forms && python3 -m unittest discover)` and the four checks in marketplace
           `AGENTS.md` § Done pass; the test gate runs the tests above.
Commit:    one commit for the group, the version bump included.

## Proof
