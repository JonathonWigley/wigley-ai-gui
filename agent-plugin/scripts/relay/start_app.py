"""Starts the wigley-ai-gui app, or finds it already running, and waits until its relay channel accepts; with
`--restart`, quits the running app first and starts it again on its current build.

The relay calls `start_app` when a tool call finds no app; an agent runs this file by hand to start the app the same
way. It starts the command the app's endpoint file records, else the installed stable app, never a dev app no
endpoint file records. On Windows a recorded command in the install root gives way to that root's newest build.
`--restart` asks the process the endpoint file's `pid` names to quit, waits for it to exit, then starts the app;
`--dev` targets the dev app's endpoint folder, and `--from <folder>` restarts the dev app from that checkout.
Exit 0 prints that the app is ready, was already running or restarted; exit 1 prints why it could not be started.
README.md § The relay (Starting the app, Restarting the app) is its spec. Standard library only.
"""

from __future__ import annotations

import argparse
import functools
import json
import os
import signal
import socket
import subprocess
import sys
import time
from pathlib import Path, PurePath, PurePosixPath, PureWindowsPath
from typing import BinaryIO, Callable, NamedTuple, Protocol

ENDPOINT_DIR = Path.home() / ".agents" / "wigley-ai-gui"
DEV_ENDPOINT_DIR = Path.home() / ".agents" / "wigley-ai-gui-dev"
START_LOG = "start.log"
LAUNCH_WAIT_SECONDS = 45.0
QUIT_WAIT_SECONDS = 15.0
POLL_SECONDS = 0.25
ERROR_INVALID_PARAMETER = 87  # Windows: OpenProcess names no process with this id


class Endpoint(NamedTuple):
    """What the app's endpoint file names: its channel, the command that started it, run in `cwd`, and `pid`, the
    app's main process id, None when the file records none (an app built before the restart)."""
    channel: str
    command: list[str]
    cwd: str
    pid: int | None


class StartResult(NamedTuple):
    ready: bool
    message: str


def endpoint_dir(env) -> Path:
    """The folder holding the app's endpoint file: WIGLEY_AI_GUI_ENDPOINT_DIR when set and non-empty, else
    ~/.agents/wigley-ai-gui."""
    override = env.get("WIGLEY_AI_GUI_ENDPOINT_DIR")
    return Path(override) if override else ENDPOINT_DIR


class Launch(Protocol):
    """A spawned start command, which the wait watches for an early exit."""
    def exit_code(self) -> int | None:
        """The command's exit code, or None while it runs."""

    def error_output(self) -> str:
        """What the command wrote to stderr; read only once it has exited."""

    def close(self) -> None:
        """Stops watching; the command keeps running."""


class DetachedLaunch:
    """A detached process and the log file its stderr goes to."""

    def __init__(self, process: subprocess.Popen, stderr: BinaryIO):
        self._process = process
        self._stderr = stderr

    def exit_code(self) -> int | None:
        return self._process.poll()

    def error_output(self) -> str:
        # The child shares this file's offset, so it is read only after the child has exited.
        self._stderr.seek(0)
        return self._stderr.read().decode("utf-8", errors="replace").strip()

    def close(self) -> None:
        self._stderr.close()


class StartFailed(Exception):
    """The app cannot be started; the message is the reason, in words the user can act on."""


def read_endpoint(endpoint_dir: Path) -> Endpoint | None:
    """The app's endpoint file, or None when it is missing or unreadable. A missing `pid`, or one that is not a
    positive integer, reads as None and leaves the file readable."""
    path = endpoint_dir / "endpoint.json"
    try:
        endpoint = json.loads(path.read_text(encoding="utf-8"))
        return Endpoint(endpoint["channel"], list(endpoint["launch"]["command"]), endpoint["launch"]["cwd"],
                        positive_pid(endpoint.get("pid")))
    except FileNotFoundError:
        return None
    except (OSError, ValueError, KeyError, TypeError) as exc:
        print(f"wigley-ai-gui start: {path} is unreadable: {exc!r}", file=sys.stderr, flush=True)
        return None


def positive_pid(value: object) -> int | None:
    """`value` when it is a JSON integer above 0, else None: `0` would signal this process's group and `-1` every
    process the user owns."""
    is_integer = isinstance(value, int) and not isinstance(value, bool)
    return value if is_integer and value > 0 else None


def channel_accepts(path: str) -> bool:
    """Whether the app is listening on its channel. Connects and closes without a hello, which the app ignores."""
    if sys.platform == "win32":
        return _pipe_accepts(path)
    probe = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    try:
        probe.connect(path)
    except OSError:
        return False
    finally:
        probe.close()
    return True


def _pipe_accepts(path: str) -> bool:
    import _winapi

    try:
        handle = _winapi.CreateFile(path, _winapi.GENERIC_READ | _winapi.GENERIC_WRITE, 0, _winapi.NULL,
                                    _winapi.OPEN_EXISTING, 0, _winapi.NULL)
    except OSError as exc:
        # Every instance of the pipe is busy with another connection, so the app is there.
        return exc.winerror == _winapi.ERROR_PIPE_BUSY
    _winapi.CloseHandle(handle)
    return True


def spawn_detached(command: list[str], cwd: str, log: Path) -> DetachedLaunch:
    """Starts the app in a session of its own, so it outlives this process and its host. Its stderr goes to `log`,
    emptied first, so a command that exits at once can say why and a running app's errors stay where the user can
    read them; never a pipe, which would block or break the app once this process stops reading it."""
    if sys.platform == "win32":
        # A hidden console the app's console children inherit; a detached one makes each child open its own window.
        options = {"creationflags": subprocess.CREATE_NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP}
    else:
        options = {"start_new_session": True}
    log.parent.mkdir(parents=True, exist_ok=True)
    # Truncated rather than replaced: on Windows a replace fails while the last start's app still holds the file.
    stderr = log.open("w+b")
    try:
        process = subprocess.Popen(command, cwd=cwd, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                   stderr=stderr, **options)
    except BaseException:
        stderr.close()
        raise
    return DetachedLaunch(process, stderr)


def list_app_folders(base: PurePath) -> list[tuple[PurePath, float]]:
    """Each folder in `base` whose name starts with `app-`, with its modified time in seconds; empty when `base` does
    not exist or cannot be listed."""
    try:
        with os.scandir(base) as entries:
            return [(base / entry.name, entry.stat().st_mtime) for entry in entries
                    if entry.name.startswith("app-") and entry.is_dir()]
    except OSError:
        return []


def no_installed_app_at(path: PurePath) -> StartFailed:
    return StartFailed(f"there is no installed wigley-ai-gui app at {path}; run npm run install-app in the "
                       f"wigley-ai-gui repo")


def windows_install_root(local_app_data: str) -> PureWindowsPath:
    return PureWindowsPath(local_app_data, "Programs", "wigley-ai-gui")


def runs_from_windows_install_root(command: list[str], env, platform: str) -> bool:
    """Whether `command` runs a file under the Windows install root; False on any other platform or with LOCALAPPDATA
    unset."""
    local_app_data = env.get("LOCALAPPDATA")
    if platform != "win32" or not local_app_data:
        return False
    return PureWindowsPath(command[0]).is_relative_to(windows_install_root(local_app_data))


def installed_app_command(env, platform: str = sys.platform,
                          is_file: Callable[[PurePath], bool] = lambda p: Path(p).is_file(),
                          app_folders: Callable[[PurePath], list[tuple[PurePath, float]]] = list_app_folders
                          ) -> tuple[list[str], str]:
    """The installed stable app's binary, which wigley-ai-gui's `npm run install-app` puts in place, and the folder
    holding it: `wigley-ai-gui.exe` in the newest-modified `app-*` folder of `%LOCALAPPDATA%\\Programs\\wigley-ai-gui`
    on Windows (LOCALAPPDATA read from `env`; on a modified-time tie, the greater name),
    `/Applications/wigley-ai-gui.app/Contents/MacOS/wigley-ai-gui` on macOS.
    Raises StartFailed when the binary or every `app-*` folder is missing, the platform has no installed app, or
    LOCALAPPDATA is unset."""
    if platform == "win32":
        local_app_data = env.get("LOCALAPPDATA")
        if not local_app_data:
            raise StartFailed("LOCALAPPDATA is not set, so the installed wigley-ai-gui app cannot be found")
        base = windows_install_root(local_app_data)
        folders = app_folders(base)
        if not folders:
            raise no_installed_app_at(base)
        newest, _ = max(folders, key=lambda folder: (folder[1], folder[0].name))
        binary = newest / "wigley-ai-gui.exe"
    elif platform == "darwin":
        binary = PurePosixPath("/Applications/wigley-ai-gui.app/Contents/MacOS/wigley-ai-gui")
    else:
        raise StartFailed(f"there is no installed wigley-ai-gui app on {platform}; run npm run install-app in the "
                          f"wigley-ai-gui repo")
    if not is_file(binary):
        raise no_installed_app_at(binary)
    return [str(binary)], str(binary.parent)


def spawn_or_fail(command: list[str], cwd: str, spawn: Callable[[list[str], str], Launch]) -> Launch:
    """Spawns `command` in `cwd`; raises StartFailed with the OS error when it cannot be spawned."""
    try:
        return spawn(command, cwd)
    except OSError as exc:
        raise StartFailed(f"running {command} in {cwd} failed: {exc}") from exc


def same_folder(a: Path, b: Path) -> bool:
    """Whether `a` and `b` name one folder, however each is written: `..` segments, links, short names and, on
    Windows, case. A path that cannot be resolved is compared as its absolute form."""
    return folder_key(a) == folder_key(b)


def folder_key(path: Path) -> str:
    try:
        resolved = path.resolve()
    except (OSError, RuntimeError):  # RuntimeError: a symlink loop before Python 3.13
        resolved = Path(os.path.abspath(path))
    return os.path.normcase(str(resolved))


def spawn_installed_app(endpoint_dir: Path, env, spawn: Callable[[list[str], str], Launch],
                        installed_app: Callable[[object], tuple[list[str], str]]) -> tuple[list[str], str, Launch]:
    """Spawns the installed app as `installed_app` builds it; returns the command, the folder it ran in, and its
    launch. Only the default endpoint folder starts it, since the installed app never answers on another.
    Raises StartFailed when `endpoint_dir` is not the default, or the command cannot be built or spawned."""
    if not same_folder(endpoint_dir, ENDPOINT_DIR):
        raise StartFailed(f"the installed app starts only for {ENDPOINT_DIR}, not {endpoint_dir}; "
                          f"start the app that serves {endpoint_dir} first")
    try:
        command, cwd = installed_app(env)
    except OSError as exc:
        raise StartFailed(f"finding the installed app failed: {exc}") from exc
    return command, cwd, spawn_or_fail(command, cwd, spawn)


def launch_app(endpoint: Endpoint | None, endpoint_dir: Path, env, spawn: Callable[[list[str], str], Launch],
               installed_app: Callable[[object], tuple[list[str], str]],
               platform: str = sys.platform) -> tuple[list[str], str, Launch]:
    """Spawns the app and returns the command, the folder it ran in, and its launch: the endpoint file's recorded
    command, else the installed app. When the recorded command cannot be spawned, the installed app is the fallback;
    one that spawns and then exits is not, so an ended drive run never starts the user's own app. The installed app
    starts only for the default endpoint folder.
    A recorded command under the Windows install root swaps the order, so a kept older `app-*` folder is not started
    over the newest; the recorded command remains the fallback, as for a flat install with no `app-*` folder or
    another endpoint folder.
    Raises StartFailed, naming both reasons when the fallback fails too."""
    if endpoint is None:
        return spawn_installed_app(endpoint_dir, env, spawn, installed_app)

    def spawn_recorded() -> tuple[list[str], str, Launch]:
        return endpoint.command, endpoint.cwd, spawn_or_fail(endpoint.command, endpoint.cwd, spawn)

    def spawn_installed() -> tuple[list[str], str, Launch]:
        return spawn_installed_app(endpoint_dir, env, spawn, installed_app)

    prefers_installed = runs_from_windows_install_root(endpoint.command, env, platform)
    try:
        return spawn_installed() if prefers_installed else spawn_recorded()
    except StartFailed as first_failure:
        try:
            return spawn_recorded() if prefers_installed else spawn_installed()
        except StartFailed as fallback_failure:
            recorded, installed = ((fallback_failure, first_failure) if prefers_installed
                                   else (first_failure, fallback_failure))
            raise StartFailed(f"the recorded launch failed ({recorded}), and so did starting the installed "
                              f"app ({installed})") from fallback_failure


def start_app(endpoint_dir: Path = ENDPOINT_DIR, env=os.environ,
              spawn: Callable[[list[str], str], Launch] | None = None,
              accepts: Callable[[str], bool] = channel_accepts,
              installed_app: Callable[[object], tuple[list[str], str]] = installed_app_command,
              launch_wait: float = LAUNCH_WAIT_SECONDS, poll: float = POLL_SECONDS,
              platform: str = sys.platform) -> StartResult:
    """Reuses a running app, else starts it — with the command its endpoint file records (falling back to the
    installed app when that command cannot be spawned; on Windows, a command under the install root gives way to the
    newest installed build first), or the installed stable app when there is no file, never a dev app no file
    records — and waits up to `launch_wait` seconds for its channel to accept. A command that exits
    non-zero before then fails the start at once, with what it wrote to stderr; one that exits 0 (a second instance
    yielding to the first) is waited out. The installed app starts only when `endpoint_dir` is the default
    ENDPOINT_DIR; with no endpoint file another folder fails at once. `spawn` defaults to `spawn_detached`, logging
    stderr to START_LOG in `endpoint_dir`.
    Never raises for a failed start: it returns the reason."""
    if spawn is None:
        spawn = functools.partial(spawn_detached, log=endpoint_dir / START_LOG)
    endpoint = read_endpoint(endpoint_dir)
    if endpoint is not None and accepts(endpoint.channel):
        return StartResult(True, "The wigley-ai-gui app was already running.")
    return start_from(endpoint, endpoint_dir, env, spawn, accepts, installed_app, launch_wait, poll, platform)


def start_from(endpoint: Endpoint | None, endpoint_dir: Path, env, spawn: Callable[[list[str], str], Launch],
               accepts: Callable[[str], bool], installed_app: Callable[[object], tuple[list[str], str]],
               launch_wait: float, poll: float, platform: str) -> StartResult:
    """Starts the app the way `start_app` does once it has decided to launch: with the command `endpoint` records,
    else the installed app, per `launch_app`, then waits for the channel. Reads the endpoint file only to watch
    for the channel. Never raises for a failed start: it returns the reason."""
    try:
        command, cwd, launch = launch_app(endpoint, endpoint_dir, env, spawn, installed_app, platform)
    except StartFailed as exc:
        return StartResult(False, str(exc))
    try:
        return wait_for_channel(endpoint_dir, accepts, launch, command, cwd, launch_wait, poll)
    finally:
        launch.close()


def wait_for_channel(endpoint_dir: Path, accepts: Callable[[str], bool], launch: Launch, command: list[str],
                     cwd: str, launch_wait: float, poll: float) -> StartResult:
    """Waits up to `launch_wait` seconds for the started app's channel to accept, failing early when `launch`
    exits non-zero."""
    deadline = time.monotonic() + launch_wait
    while time.monotonic() < deadline:
        time.sleep(poll)
        # The app rewrites the endpoint file on every start, so a first start's channel appears here.
        endpoint = read_endpoint(endpoint_dir)
        if endpoint is not None and accepts(endpoint.channel):
            return StartResult(True, "The wigley-ai-gui app is ready.")
        code = launch.exit_code()
        if code:
            exited = f"running {command} in {cwd} exited with code {code} before the app opened its channel"
            output = launch.error_output()
            return StartResult(False, f"{output} ({exited})" if output else exited)
    return StartResult(False, f"the app did not open its channel within {launch_wait:g} s of running {command} "
                              f"in {cwd}")


def quit_process(pid: int, platform: str = sys.platform) -> None:
    """Asks process `pid` to quit the way its user would, never forcing it: SIGTERM on POSIX, which Electron turns
    into its normal quit, and on Windows a close of its main window, as wigley-ai-gui's `npm run install-app` does.
    A process already gone counts as quit. Raises OSError when the ask cannot be made."""
    if platform == "win32":
        close_main_window = (f"Get-Process -Id {pid} -ErrorAction SilentlyContinue | "
                             "ForEach-Object { try { [void]$_.CloseMainWindow() } catch {} }; exit 0")
        subprocess.run(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", close_main_window],
                       check=False)
        return
    try:
        os.kill(pid, signal.SIGTERM)
    except ProcessLookupError:
        pass


def process_exited(pid: int, platform: str = sys.platform) -> bool:
    """Whether process `pid` has exited. On POSIX a zombie, which `ps` shows in a state starting with `Z`, has
    exited: an app the relay started stays one after its quit, since the relay never reaps it. A process this one
    may not signal or open is still running unless `ps` shows it a zombie, and so is one whose state `ps` cannot
    read while a signal still finds it."""
    if platform == "win32":
        return _windows_process_exited(pid)
    if not _signal_finds(pid):
        return True
    state = _ps_state(pid)
    if state is None:
        return not _signal_finds(pid)
    return state.startswith("Z")


def _signal_finds(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def _ps_state(pid: int) -> str | None:
    """Process `pid`'s state as `ps` prints it (`S`, `Ss`, `Z`), or None when `ps` cannot run, exits non-zero or
    prints nothing."""
    try:
        result = subprocess.run(["ps", "-o", "stat=", "-p", str(pid)], capture_output=True, text=True, check=False)
    except OSError:
        return None
    state = result.stdout.strip()
    return state if result.returncode == 0 and state else None


def _windows_process_exited(pid: int) -> bool:
    import _winapi

    try:
        handle = _winapi.OpenProcess(_winapi.SYNCHRONIZE, False, pid)
    except OSError as exc:
        return exc.winerror == ERROR_INVALID_PARAMETER
    try:
        return _winapi.WaitForSingleObject(handle, 0) == _winapi.WAIT_OBJECT_0
    finally:
        _winapi.CloseHandle(handle)


def recorded_npm_start(endpoint: Endpoint | None, endpoint_dir: Path, from_folder: Path) -> Endpoint:
    """The endpoint whose recorded npm start can run from `from_folder`. Raises StartFailed naming the folder that
    does not exist, the missing endpoint file, or the recorded command that is no npm start."""
    path = endpoint_dir / "endpoint.json"
    if not from_folder.is_dir():
        raise StartFailed(f"{from_folder} is not a folder, so the dev app cannot start from it")
    if endpoint is None:
        raise StartFailed(f"{path} is missing or unreadable, so no recorded npm start names the Node and npm to run "
                          f"from {from_folder}; start the dev app once with npm start")
    if endpoint.command[-1:] != ["start"]:
        raise StartFailed(f"the command {path} records, {endpoint.command}, is not an npm start, so it cannot run "
                          f"from {from_folder}")
    return endpoint


def quit_running_app(endpoint: Endpoint, endpoint_dir: Path, quit: Callable[[int], None],
                     exited: Callable[[int], bool], quit_wait: float, poll: float) -> None:
    """Asks the app's process to quit once and waits up to `quit_wait` seconds for it to exit, never forcing it.
    Raises StartFailed when the endpoint file records no pid, the ask fails, or the process is still running at
    the limit."""
    pid = endpoint.pid
    if pid is None:
        raise StartFailed(f"the running app records no process id in {endpoint_dir / 'endpoint.json'}, so it "
                          f"predates the restart; quit it by hand and run this again")
    try:
        quit(pid)
    except OSError as exc:
        raise StartFailed(f"asking the app's process {pid} to quit failed: {exc}") from exc
    deadline = time.monotonic() + quit_wait
    while not exited(pid):
        if time.monotonic() >= deadline:
            raise StartFailed(f"the app's process {pid} was still running {quit_wait:g} s after it was asked to "
                              f"quit, so nothing was started")
        time.sleep(poll)


def start_dev_from(endpoint: Endpoint, endpoint_dir: Path, from_folder: Path,
                   spawn: Callable[[list[str], str], Launch], accepts: Callable[[str], bool], launch_wait: float,
                   poll: float) -> StartResult:
    """Runs the recorded npm start in `from_folder` and waits for its channel, with no installed-app fallback."""
    cwd = str(from_folder)
    try:
        launch = spawn_or_fail(endpoint.command, cwd, spawn)
    except StartFailed as exc:
        return StartResult(False, str(exc))
    try:
        return wait_for_channel(endpoint_dir, accepts, launch, endpoint.command, cwd, launch_wait, poll)
    finally:
        launch.close()


def restart_app(endpoint_dir: Path, from_folder: Path | None = None, env=os.environ,
                spawn: Callable[[list[str], str], Launch] | None = None,
                accepts: Callable[[str], bool] = channel_accepts,
                installed_app: Callable[[object], tuple[list[str], str]] = installed_app_command,
                quit: Callable[[int], None] = quit_process, exited: Callable[[int], bool] = process_exited,
                quit_wait: float = QUIT_WAIT_SECONDS, launch_wait: float = LAUNCH_WAIT_SECONDS,
                poll: float = POLL_SECONDS, platform: str = sys.platform) -> StartResult:
    """Puts the app on its current build: when its channel accepts, asks the process the endpoint file's `pid`
    names to quit and waits up to `quit_wait` seconds for it to exit, then starts the app as `start_app` does, from
    the endpoint file read at the start and never read again before the launch; with no app answering it is a plain
    start. With `from_folder`, it first checks that the folder exists and that the endpoint file records an npm
    start, quitting nothing when either check fails, then runs that command in `from_folder`. `spawn` defaults to
    `spawn_detached`, logging stderr to START_LOG in `endpoint_dir`. Never raises for a failed restart: it returns
    the reason."""
    if spawn is None:
        spawn = functools.partial(spawn_detached, log=endpoint_dir / START_LOG)
    endpoint = read_endpoint(endpoint_dir)
    try:
        if from_folder is not None:
            endpoint = recorded_npm_start(endpoint, endpoint_dir, from_folder)
        app_running = endpoint is not None and accepts(endpoint.channel)
        if app_running:
            quit_running_app(endpoint, endpoint_dir, quit, exited, quit_wait, poll)
    except StartFailed as exc:
        return StartResult(False, str(exc))
    if from_folder is None:
        result = start_from(endpoint, endpoint_dir, env, spawn, accepts, installed_app, launch_wait, poll, platform)
    else:
        result = start_dev_from(endpoint, endpoint_dir, from_folder, spawn, accepts, launch_wait, poll)
    if app_running and result.ready:
        return StartResult(True, "The wigley-ai-gui app restarted.")
    return result


def parse_args(argv: list[str], env) -> tuple[Path, bool, Path | None]:
    """The endpoint folder, whether to restart, and the `--from` folder, made absolute. `--from` implies `--restart`
    and `--dev`; `--dev` picks DEV_ENDPOINT_DIR, else the folder is `endpoint_dir(env)`. A bad flag exits 2."""
    parser = argparse.ArgumentParser(description="Starts the wigley-ai-gui app, or finds it running; with "
                                                 "--restart, quits it and starts it again on its current build.")
    parser.add_argument("--restart", action="store_true", help="quit the running app and start it again")
    parser.add_argument("--dev", action="store_true", help=f"target the dev app's endpoint folder, {DEV_ENDPOINT_DIR}")
    parser.add_argument("--from", dest="from_folder", metavar="FOLDER",
                        help="restart the dev app from this checkout; implies --restart and --dev")
    args = parser.parse_args(argv)
    from_folder = Path(args.from_folder).resolve() if args.from_folder is not None else None
    dev = args.dev or from_folder is not None
    restart = args.restart or from_folder is not None
    return (DEV_ENDPOINT_DIR if dev else endpoint_dir(env)), restart, from_folder


def main() -> int:
    folder, restart, from_folder = parse_args(sys.argv[1:], os.environ)
    result = restart_app(folder, from_folder) if restart else start_app(folder)
    print(result.message if result.ready else f"The wigley-ai-gui app could not be started: {result.message}")
    return 0 if result.ready else 1


if __name__ == "__main__":
    sys.exit(main())
