"""start_app.py with an injected spawn and channel probe: reusing a running app, the recorded command, the installed
app and its path on each platform (on Windows, the newest `app-*` folder, over a recorded command in the install root),
the installed app only for the default endpoint folder, each failure's reason, a start command that exits at once, the
endpoint folder WIGLEY_AI_GUI_ENDPOINT_DIR names, the endpoint's pid, the restart with an injected quit and exit probe,
and the command-line flags. One test probes a real Unix socket; two spawn a real command that exits; one lists a real
folder; two check real process ids."""

import json
import os
import signal
import socket
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path, PureWindowsPath
from unittest import mock

import start_app

CHANNEL = "/run/app.sock"


class FakeLaunch:
    """A spawned command that is still running, or has exited with `code` after writing `output` to stderr."""

    def __init__(self, code=None, output=""):
        self.code = code
        self.output = output
        self.closed = False

    def exit_code(self):
        return self.code

    def error_output(self):
        return self.output

    def close(self):
        self.closed = True


class StartAppTestCase(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.dir = Path(folder.name)
        # The temp folder stands in for the default endpoint folder, the only one that starts the installed app.
        patcher = mock.patch.object(start_app, "ENDPOINT_DIR", self.dir)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.spawned = []
        self.listening = False

    def write_endpoint(self, command=("node", "npm-cli.js", "start"), cwd="/work/wigley-ai-gui", **fields) -> None:
        endpoint = {"channel": CHANNEL, "launch": {"command": list(command), "cwd": cwd}, **fields}
        (self.dir / "endpoint.json").write_text(json.dumps(endpoint), encoding="utf-8")

    def accepts(self, path: str) -> bool:
        return self.listening and path == CHANNEL

    def spawn_that_starts_the_app(self, command, cwd) -> FakeLaunch:
        self.spawned.append((command, cwd))
        self.write_endpoint()
        self.listening = True
        return FakeLaunch()

    def record_spawn(self, command, cwd) -> FakeLaunch:
        self.spawned.append((command, cwd))
        return FakeLaunch()

    def start(self, spawn=None, installed_app=None, env=None, launch_wait=0.2) -> start_app.StartResult:
        return start_app.start_app(self.dir, env=env or {}, spawn=spawn or self.spawn_that_starts_the_app,
                                   accepts=self.accepts,
                                   installed_app=installed_app or (lambda env: (["/apps/wigley-ai-gui"], "/apps")),
                                   launch_wait=launch_wait, poll=0.01)


class StartTests(StartAppTestCase):
    def test_a_running_app_is_reused_without_a_start(self):
        self.write_endpoint()
        self.listening = True

        result = self.start()

        self.assertEqual(result, start_app.StartResult(True, "The wigley-ai-gui app was already running."))
        self.assertEqual(self.spawned, [])

    def test_the_endpoint_files_recorded_command_starts_the_app(self):
        self.write_endpoint(command=("node", "npm-cli.js", "start"), cwd="/work/wigley-ai-gui")

        result = self.start()

        self.assertEqual(result, start_app.StartResult(True, "The wigley-ai-gui app is ready."))
        self.assertEqual(self.spawned, [(["node", "npm-cli.js", "start"], "/work/wigley-ai-gui")])

    def test_with_no_endpoint_file_the_installed_app_starts(self):
        result = self.start(installed_app=lambda env: (["/apps/wigley-ai-gui"], "/apps"))

        self.assertTrue(result.ready)
        self.assertEqual(self.spawned, [(["/apps/wigley-ai-gui"], "/apps")])

    def test_the_default_folder_written_another_way_starts_the_installed_app(self):
        (self.dir / "x").mkdir()  # POSIX opens x/../endpoint.json only through an existing x
        same = self.dir / "x" / ".."

        result = start_app.start_app(same, env={}, spawn=self.spawn_that_starts_the_app, accepts=self.accepts,
                                     installed_app=lambda env: (["/apps/wigley-ai-gui"], "/apps"),
                                     launch_wait=0.2, poll=0.01)

        self.assertTrue(result.ready)
        self.assertEqual(self.spawned, [(["/apps/wigley-ai-gui"], "/apps")])

    def test_another_endpoint_folder_with_no_endpoint_file_fails_and_spawns_nothing(self):
        other = self.dir / "wigley-ai-gui-dev"

        result = start_app.start_app(other, env={}, spawn=self.record_spawn, accepts=self.accepts,
                                     installed_app=lambda env: (["/apps/wigley-ai-gui"], "/apps"),
                                     launch_wait=0.2, poll=0.01)

        self.assertEqual(result, start_app.StartResult(
            False, f"the installed app starts only for {self.dir}, not {other}; start the app that serves {other} "
                   f"first"))
        self.assertEqual(self.spawned, [])

    def test_another_endpoint_folder_whose_recorded_command_cannot_spawn_fails_naming_both_reasons(self):
        other = self.dir / "wigley-ai-gui-dev"
        other.mkdir()
        endpoint = {"channel": CHANNEL, "launch": {"command": ["/gone/node", "start"], "cwd": "/work/wigley-ai-gui"}}
        (other / "endpoint.json").write_text(json.dumps(endpoint), encoding="utf-8")
        tried = []

        def failing_spawn(command, cwd):
            tried.append((command, cwd))
            raise FileNotFoundError(2, "No such file or directory", command[0])

        result = start_app.start_app(other, env={}, spawn=failing_spawn, accepts=self.accepts,
                                     installed_app=lambda env: (["/apps/wigley-ai-gui"], "/apps"),
                                     launch_wait=0.2, poll=0.01)

        recorded = ("running ['/gone/node', 'start'] in /work/wigley-ai-gui failed: [Errno 2] No such file or "
                    "directory: '/gone/node'")
        self.assertEqual(result, start_app.StartResult(
            False, f"the recorded launch failed ({recorded}), and so did starting the installed app (the installed "
                   f"app starts only for {self.dir}, not {other}; start the app that serves {other} first)"))
        self.assertEqual(tried, [(["/gone/node", "start"], "/work/wigley-ai-gui")])

    def test_a_start_whose_channel_never_opens_fails_naming_the_command(self):
        result = self.start(spawn=self.record_spawn)

        self.assertFalse(result.ready)
        self.assertIn("did not open its channel", result.message)
        self.assertIn("'/apps/wigley-ai-gui'", result.message)

    def test_a_spawn_that_fails_returns_its_error(self):
        def failing_spawn(command, cwd):
            raise FileNotFoundError(2, "No such file or directory", command[0])

        result = self.start(spawn=failing_spawn)

        self.assertFalse(result.ready)
        self.assertIn("No such file or directory", result.message)

    def test_a_command_that_cannot_be_built_fails_with_its_reason(self):
        def no_app(env):
            raise start_app.StartFailed("there is no installed wigley-ai-gui app")

        result = self.start(installed_app=no_app)

        self.assertEqual(result, start_app.StartResult(False, "there is no installed wigley-ai-gui app"))
        self.assertEqual(self.spawned, [])

    def test_an_oserror_finding_the_installed_app_is_a_failed_start(self):
        def unreadable_app(env):
            raise PermissionError(13, "Permission denied", "/locked/wigley-ai-gui")

        result = self.start(installed_app=unreadable_app)

        self.assertFalse(result.ready)
        self.assertIn("Permission denied", result.message)
        self.assertEqual(self.spawned, [])

    def test_a_recorded_command_that_cannot_spawn_falls_back_to_the_installed_app(self):
        self.write_endpoint(command=("/gone/node", "npm-cli.js", "start"), cwd="/work/wigley-ai-gui")

        def spawn(command, cwd):
            if command[0] == "/gone/node":
                raise FileNotFoundError(2, "No such file or directory", command[0])
            return self.spawn_that_starts_the_app(command, cwd)

        result = self.start(spawn=spawn, installed_app=lambda env: (["/apps/wigley-ai-gui"], "/apps"))

        self.assertEqual(result, start_app.StartResult(True, "The wigley-ai-gui app is ready."))
        self.assertEqual(self.spawned, [(["/apps/wigley-ai-gui"], "/apps")])

    def test_a_failed_fallback_names_both_reasons(self):
        self.write_endpoint(command=("/gone/node", "start"), cwd="/work/wigley-ai-gui")

        def failing_spawn(command, cwd):
            raise FileNotFoundError(2, "No such file or directory", command[0])

        result = self.start(spawn=failing_spawn, installed_app=lambda env: (["/gone/wigley-ai-gui"], "/gone"))

        self.assertFalse(result.ready)
        self.assertIn("/gone/node", result.message)
        self.assertIn("/gone/wigley-ai-gui", result.message)


class WindowsRecordedCommandTests(StartAppTestCase):
    ENV = {"LOCALAPPDATA": r"C:\Users\me\AppData\Local"}
    ROOT = r"C:\Users\me\AppData\Local\Programs\wigley-ai-gui"
    OLDER_EXE = ROOT + r"\app-older\wigley-ai-gui.exe"
    NEWEST_EXE = ROOT + r"\app-newest\wigley-ai-gui.exe"

    def installed_on_windows(self, env, app_folders=None):
        folders = [(PureWindowsPath(self.ROOT, "app-older"), 100.0), (PureWindowsPath(self.ROOT, "app-newest"), 200.0)]
        return start_app.installed_app_command(env, "win32", lambda path: True,
                                               app_folders or (lambda base: folders))

    def start_on_windows(self, endpoint_dir, spawn, installed_app=None, platform="win32"):
        return start_app.start_app(endpoint_dir, env=self.ENV, spawn=spawn, accepts=self.accepts,
                                   installed_app=installed_app or self.installed_on_windows,
                                   launch_wait=0.2, poll=0.01, platform=platform)

    def test_a_recorded_command_runs_or_gives_way_to_the_newest_folder(self):
        recorded_cwd = r"C:\Users\me"
        newest = ([self.NEWEST_EXE], self.ROOT + r"\app-newest")
        rows = [
            ("a kept older folder", self.OLDER_EXE, "win32", newest),
            ("the root in another case", self.OLDER_EXE.upper(), "win32", newest),
            ("the flat install", self.ROOT + r"\wigley-ai-gui.exe", "win32", newest),
            ("a dev Node", r"C:\nvm\node.exe", "win32", ([r"C:\nvm\node.exe"], recorded_cwd)),
            ("a folder whose name extends the root's", self.ROOT + r"-dev\wigley-ai-gui.exe", "win32",
             ([self.ROOT + r"-dev\wigley-ai-gui.exe"], recorded_cwd)),
            ("macOS", self.OLDER_EXE, "darwin", ([self.OLDER_EXE], recorded_cwd)),
        ]
        for name, command, platform, expected in rows:
            with self.subTest(name):
                self.spawned = []
                self.write_endpoint(command=(command,), cwd=recorded_cwd)
                self.listening = False

                result = self.start_on_windows(self.dir, self.spawn_that_starts_the_app, platform=platform)

                self.assertTrue(result.ready)
                self.assertEqual(self.spawned, [expected])

    def test_another_endpoint_folder_runs_its_recorded_command_under_the_root(self):
        other = self.dir / "wigley-ai-gui-dev"
        other.mkdir()
        endpoint = {"channel": CHANNEL, "launch": {"command": [self.OLDER_EXE], "cwd": "/work"}}
        (other / "endpoint.json").write_text(json.dumps(endpoint), encoding="utf-8")

        self.start_on_windows(other, self.record_spawn)

        self.assertEqual(self.spawned, [([self.OLDER_EXE], "/work")])

    def test_a_flat_install_with_no_app_folder_runs_its_recorded_command(self):
        flat_exe = self.ROOT + r"\wigley-ai-gui.exe"
        self.write_endpoint(command=(flat_exe,), cwd=self.ROOT)

        def no_app_folder(env):
            return self.installed_on_windows(env, app_folders=lambda base: [])

        result = self.start_on_windows(self.dir, self.spawn_that_starts_the_app, installed_app=no_app_folder)

        self.assertTrue(result.ready)
        self.assertEqual(self.spawned, [([flat_exe], self.ROOT)])

    def test_when_neither_can_spawn_each_reason_keeps_its_own_label(self):
        self.write_endpoint(command=(self.OLDER_EXE,), cwd="/work")

        def failing_spawn(command, cwd):
            raise FileNotFoundError(2, "No such file or directory", command[0])

        result = self.start_on_windows(self.dir, failing_spawn)

        self.assertFalse(result.ready)
        recorded_part, installed_part = result.message.split("and so did starting the installed app")
        self.assertIn("app-older", recorded_part)
        self.assertIn("app-newest", installed_part)


class EarlyExitTests(StartAppTestCase):
    def test_a_command_that_exits_non_zero_fails_at_once_with_its_stderr(self):
        self.write_endpoint(command=("/bin/sh", "-c", "exit 1"), cwd="/")
        launch = FakeLaunch(code=1, output="The drive run /work/.drive/r1 has ended")
        began = time.monotonic()

        result = self.start(spawn=lambda command, cwd: launch, launch_wait=30)

        self.assertLess(time.monotonic() - began, 5)
        self.assertFalse(result.ready)
        self.assertTrue(result.message.startswith("The drive run /work/.drive/r1 has ended ("))
        self.assertIn("exited with code 1", result.message)
        self.assertTrue(launch.closed)

    def test_an_exit_with_no_stderr_names_the_command_and_code(self):
        self.write_endpoint(command=("cmd.exe", "/d", "/c", "exit 1 & rem The drive run C:\\r1 has ended"),
                            cwd="C:\\")

        result = self.start(spawn=lambda command, cwd: FakeLaunch(code=1), launch_wait=30)

        self.assertFalse(result.ready)
        self.assertIn("The drive run C:\\\\r1 has ended", result.message)
        self.assertIn("exited with code 1 before the app opened its channel", result.message)

    def test_an_exited_command_does_not_fall_back_to_the_installed_app(self):
        self.write_endpoint(command=("/bin/sh", "-c", "exit 1"), cwd="/")

        def spawn(command, cwd):
            self.spawned.append((command, cwd))
            return FakeLaunch(code=1)

        self.start(spawn=spawn, launch_wait=30)

        self.assertEqual(self.spawned, [(["/bin/sh", "-c", "exit 1"], "/")])

    def test_a_command_that_exits_zero_is_waited_out(self):
        # A second instance yields to the first, which opens the channel a moment later.
        polls = []

        def accepts(path):
            polls.append(path)
            return len(polls) > 3

        self.write_endpoint()
        result = start_app.start_app(self.dir, env={}, spawn=lambda command, cwd: FakeLaunch(code=0),
                                     accepts=accepts, installed_app=lambda env: (["/apps/wigley-ai-gui"], "/apps"),
                                     launch_wait=5, poll=0.01)

        self.assertEqual(result, start_app.StartResult(True, "The wigley-ai-gui app is ready."))

    @unittest.skipIf(sys.platform == "win32", "the ended drive run's command is a POSIX shell's")
    def test_a_real_ended_drive_run_command_reports_its_message_at_once(self):
        self.write_endpoint(command=("/bin/sh", "-c", 'echo "$0" >&2; exit 1',
                                     "The drive run /work/.drive/r1 has ended"), cwd="/")
        began = time.monotonic()

        result = start_app.start_app(self.dir, env={}, accepts=self.accepts, launch_wait=30, poll=0.02)

        self.assertLess(time.monotonic() - began, 5)
        self.assertFalse(result.ready)
        self.assertTrue(result.message.startswith("The drive run /work/.drive/r1 has ended ("), result.message)

    @unittest.skipIf(sys.platform == "win32", "the command is a POSIX shell's")
    def test_the_started_command_s_stderr_goes_to_the_start_log_emptied_each_launch(self):
        log = self.dir / start_app.START_LOG
        log.write_text("the last launch's stderr, longer than this one's\n", encoding="utf-8")
        self.write_endpoint(command=("/bin/sh", "-c", 'echo "$0" >&2; exit 1', "this launch"), cwd="/")

        start_app.start_app(self.dir, env={}, accepts=self.accepts, launch_wait=30, poll=0.02)

        self.assertEqual(log.read_text(encoding="utf-8"), "this launch\n")


class RestartTests(StartAppTestCase):
    NPM_START = ["node", "npm-cli.js", "start"]

    def setUp(self):
        super().setUp()
        self.events = []
        self.exit_answers = [True]

    def quit(self, pid):
        self.events.append(("quit", pid))
        self.listening = False

    def exited(self, pid):
        """The next of `exit_answers`, repeating the last."""
        answer = self.exit_answers.pop(0) if len(self.exit_answers) > 1 else self.exit_answers[0]
        self.events.append(("exited", pid, answer))
        return answer

    def spawn_recording_events(self, command, cwd):
        self.events.append(("spawn", command, cwd))
        return self.spawn_that_starts_the_app(command, cwd)

    def restart(self, from_folder=None, quit=None) -> start_app.StartResult:
        return start_app.restart_app(self.dir, from_folder, env={}, spawn=self.spawn_recording_events,
                                     accepts=self.accepts,
                                     installed_app=lambda env: (["/apps/wigley-ai-gui"], "/apps"),
                                     quit=quit or self.quit, exited=self.exited, quit_wait=0.05, launch_wait=0.2,
                                     poll=0.01)

    def test_a_running_app_is_quit_and_its_recorded_command_starts_once_it_has_exited(self):
        self.write_endpoint(pid=4242)
        self.listening = True
        self.exit_answers = [False, True]

        result = self.restart()

        self.assertEqual(result, start_app.StartResult(True, "The wigley-ai-gui app restarted."))
        self.assertEqual(self.events, [("quit", 4242), ("exited", 4242, False), ("exited", 4242, True),
                                       ("spawn", self.NPM_START, "/work/wigley-ai-gui")])

    def test_the_launch_uses_the_endpoint_read_before_the_quit_not_the_file_the_quit_leaves(self):
        def rewritten(command):
            return lambda: self.write_endpoint(command=command, pid=4242)

        rows = [
            ("the old app removes the file", lambda: (self.dir / "endpoint.json").unlink()),
            ("the old app rewrites it with another command", rewritten(("/other/app", "start"))),
            ("the old channel still accepts after the exit", lambda: setattr(self, "listening", True)),
        ]
        for name, leave in rows:
            with self.subTest(name):
                self.events = []
                self.write_endpoint(command=("/recorded/app",), cwd="/recorded", pid=4242)
                self.listening = True

                def quit_and_leave(pid):
                    self.quit(pid)
                    leave()

                result = self.restart(quit=quit_and_leave)

                self.assertEqual(result, start_app.StartResult(True, "The wigley-ai-gui app restarted."))
                self.assertEqual(self.events[-1], ("spawn", ["/recorded/app"], "/recorded"))

    def test_a_running_app_that_records_no_pid_fails_and_neither_quits_nor_starts(self):
        self.write_endpoint()
        self.listening = True

        result = self.restart()

        self.assertFalse(result.ready)
        self.assertIn(str(self.dir / "endpoint.json"), result.message)
        self.assertEqual(self.events, [])

    def test_with_no_app_answering_nothing_is_quit_and_the_app_starts_as_start_app_starts_it(self):
        self.write_endpoint(pid=4242)

        result = self.restart()

        self.assertEqual(result, start_app.StartResult(True, "The wigley-ai-gui app is ready."))
        self.assertEqual(self.events, [("spawn", self.NPM_START, "/work/wigley-ai-gui")])

    def test_a_process_still_running_at_the_quit_wait_fails_naming_it_and_starts_nothing(self):
        self.write_endpoint(pid=4242)
        self.listening = True
        self.exit_answers = [False]

        result = self.restart()

        self.assertFalse(result.ready)
        self.assertIn("4242", result.message)
        self.assertEqual([event for event in self.events if event[0] != "exited"], [("quit", 4242)])

    def test_a_quit_the_os_refuses_fails_naming_the_pid_and_starts_nothing(self):
        def refused_quit(pid):
            self.events.append(("quit", pid))
            raise PermissionError(1, "Operation not permitted")

        self.write_endpoint(pid=4242)
        self.listening = True

        result = self.restart(quit=refused_quit)

        self.assertFalse(result.ready)
        self.assertIn("4242", result.message)
        self.assertEqual(self.events, [("quit", 4242)])

    def test_from_a_folder_the_recorded_npm_start_runs_in_that_folder(self):
        checkout = self.dir / "checkout"
        checkout.mkdir()
        self.write_endpoint(pid=4242)
        self.listening = True

        result = self.restart(from_folder=checkout)

        self.assertEqual(result, start_app.StartResult(True, "The wigley-ai-gui app restarted."))
        self.assertEqual(self.events, [("quit", 4242), ("exited", 4242, True),
                                       ("spawn", self.NPM_START, str(checkout))])

    def test_from_a_folder_a_failed_check_fails_before_anything_is_quit(self):
        checkout = self.dir / "checkout"
        checkout.mkdir()
        gone = self.dir / "gone"
        endpoint = self.dir / "endpoint.json"
        rows = [
            ("no endpoint file", checkout, None, str(endpoint)),
            ("a recorded command that is no npm start", checkout, ("/apps/wigley-ai-gui",), "/apps/wigley-ai-gui"),
            ("a folder that does not exist", gone, tuple(self.NPM_START), str(gone)),
        ]
        for name, folder, command, named in rows:
            with self.subTest(name):
                self.events = []
                endpoint.unlink(missing_ok=True)
                if command is not None:
                    self.write_endpoint(command=command, pid=4242)
                self.listening = True

                result = self.restart(from_folder=folder)

                self.assertFalse(result.ready)
                self.assertIn(named, result.message)
                self.assertEqual(self.events, [])

    def test_with_no_spawn_given_the_start_spawns_detached_logging_to_the_endpoint_folder(self):
        # --from spawns through restart_app's own default, which start_app would not build for it.
        checkout = self.dir / "checkout"
        checkout.mkdir()
        self.write_endpoint()
        spawned = []

        def fake_spawn_detached(command, cwd, log):
            spawned.append((command, cwd, log))
            return self.spawn_that_starts_the_app(command, cwd)

        with mock.patch.object(start_app, "spawn_detached", fake_spawn_detached):
            result = start_app.restart_app(self.dir, checkout, env={}, accepts=self.accepts, quit=self.quit,
                                           exited=self.exited, launch_wait=0.2, poll=0.01)

        self.assertTrue(result.ready)
        self.assertEqual(spawned, [(self.NPM_START, str(checkout), self.dir / start_app.START_LOG)])


class ReadEndpointTests(StartAppTestCase):
    def test_pid_reads_only_as_a_positive_integer_and_any_other_leaves_the_file_readable(self):
        rows = [
            ("a positive integer", {"pid": 4242}, 4242),
            ("missing", {}, None),
            ("zero", {"pid": 0}, None),
            ("negative", {"pid": -1}, None),
            ("a boolean", {"pid": True}, None),
            ("a string", {"pid": "4242"}, None),
        ]
        for name, fields, pid in rows:
            with self.subTest(name):
                self.write_endpoint(command=("node", "npm-cli.js", "start"), cwd="/work/wigley-ai-gui", **fields)

                endpoint = start_app.read_endpoint(self.dir)

                self.assertEqual(endpoint, start_app.Endpoint(CHANNEL, ["node", "npm-cli.js", "start"],
                                                              "/work/wigley-ai-gui", pid))


class InstalledAppCommandTests(unittest.TestCase):
    def test_no_installed_app_fails_naming_the_path_and_install_app(self):
        with self.assertRaises(start_app.StartFailed) as raised:
            start_app.installed_app_command({}, platform="darwin", is_file=lambda path: False)

        self.assertIn("/Applications/wigley-ai-gui.app/Contents/MacOS/wigley-ai-gui", str(raised.exception))
        self.assertIn("npm run install-app", str(raised.exception))

    def test_windows_runs_the_exe_in_the_newest_app_folder(self):
        folders = [(PureWindowsPath("C:\\L\\Programs\\wigley-ai-gui\\app-aaa"), 100.0),
                   (PureWindowsPath("C:\\L\\Programs\\wigley-ai-gui\\app-bbb"), 200.0)]

        command = start_app.installed_app_command({"LOCALAPPDATA": "C:\\L"}, platform="win32",
                                                  is_file=lambda path: True, app_folders=lambda base: folders)

        self.assertEqual(command, (["C:\\L\\Programs\\wigley-ai-gui\\app-bbb\\wigley-ai-gui.exe"],
                                   "C:\\L\\Programs\\wigley-ai-gui\\app-bbb"))

    def test_windows_breaks_a_modified_time_tie_by_the_greater_name(self):
        folders = [(PureWindowsPath("C:\\L\\Programs\\wigley-ai-gui\\app-bbb"), 100.0),
                   (PureWindowsPath("C:\\L\\Programs\\wigley-ai-gui\\app-aaa"), 100.0)]

        command = start_app.installed_app_command({"LOCALAPPDATA": "C:\\L"}, platform="win32",
                                                  is_file=lambda path: True, app_folders=lambda base: folders)

        self.assertEqual(command[1], "C:\\L\\Programs\\wigley-ai-gui\\app-bbb")

    def test_windows_with_no_app_folder_fails_naming_the_folder(self):
        with self.assertRaises(start_app.StartFailed) as raised:
            start_app.installed_app_command({"LOCALAPPDATA": "C:\\L"}, platform="win32",
                                            is_file=lambda path: True, app_folders=lambda base: [])

        self.assertEqual(str(raised.exception),
                         "there is no installed wigley-ai-gui app at C:\\L\\Programs\\wigley-ai-gui; run npm run "
                         "install-app in the wigley-ai-gui repo")

    def test_list_app_folders_lists_only_app_folders(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        base = Path(folder.name)
        app_1 = base / "app-1"
        app_1.mkdir()
        (base / "app-2").write_text("a file", encoding="utf-8")
        (base / "other").mkdir()
        os.utime(app_1, (100, 100))

        self.assertEqual(start_app.list_app_folders(base), [(base / "app-1", 100.0)])
        self.assertEqual(start_app.list_app_folders(base / "missing"), [])

    def test_linux_fails_naming_the_platform(self):
        with self.assertRaises(start_app.StartFailed) as raised:
            start_app.installed_app_command({}, platform="linux", is_file=lambda path: True)

        self.assertEqual(str(raised.exception), "there is no installed wigley-ai-gui app on linux; run npm run "
                                                "install-app in the wigley-ai-gui repo")

    def test_windows_with_no_localappdata_fails(self):
        with self.assertRaises(start_app.StartFailed) as raised:
            start_app.installed_app_command({}, platform="win32", is_file=lambda path: True)

        self.assertEqual(str(raised.exception),
                         "LOCALAPPDATA is not set, so the installed wigley-ai-gui app cannot be found")


class EndpointDirTests(unittest.TestCase):
    def test_endpoint_dir_from_variable(self):
        self.assertEqual(start_app.endpoint_dir({"WIGLEY_AI_GUI_ENDPOINT_DIR": "/tmp/x"}), Path("/tmp/x"))

    def test_endpoint_dir_default_when_unset_or_empty(self):
        self.assertEqual(start_app.endpoint_dir({}), start_app.ENDPOINT_DIR)
        self.assertEqual(start_app.endpoint_dir({"WIGLEY_AI_GUI_ENDPOINT_DIR": ""}), start_app.ENDPOINT_DIR)


class ParseArgsTests(unittest.TestCase):
    def test_the_flags_pick_the_endpoint_folder_the_restart_and_the_from_folder(self):
        env = {"WIGLEY_AI_GUI_ENDPOINT_DIR": "/run/endpoint"}
        dev = start_app.DEV_ENDPOINT_DIR
        rows = [
            (["--from", "x"], (dev, True, Path.cwd() / "x")),
            (["--restart", "--dev"], (dev, True, None)),
            (["--dev"], (dev, False, None)),
            (["--restart"], (Path("/run/endpoint"), True, None)),
            ([], (Path("/run/endpoint"), False, None)),
        ]
        for argv, expected in rows:
            with self.subTest(argv):
                self.assertEqual(start_app.parse_args(argv, env), expected)


class QuitProcessTests(unittest.TestCase):
    def test_the_process_is_asked_to_quit_as_each_platform_asks(self):
        sigterm = [mock.call(4242, signal.SIGTERM)]
        close_main_window = ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command",
                             "Get-Process -Id 4242 -ErrorAction SilentlyContinue | ForEach-Object { try { "
                             "[void]$_.CloseMainWindow() } catch {} }; exit 0"]
        rows = [
            ("POSIX", "linux", None, None, sigterm, []),
            ("POSIX, the process already gone", "linux", ProcessLookupError(3, "No such process"), None, sigterm,
             []),
            ("POSIX, a process this one may not signal", "linux", PermissionError(1, "Operation not permitted"),
             PermissionError, sigterm, []),
            ("Windows", "win32", None, None, [], [close_main_window]),
        ]
        for name, platform, kill_error, raises, kills, runs in rows:
            with (self.subTest(name), mock.patch.object(start_app.os, "kill", side_effect=kill_error) as kill,
                  mock.patch.object(start_app.subprocess, "run") as run):
                if raises is None:
                    start_app.quit_process(4242, platform)
                else:
                    with self.assertRaises(raises):
                        start_app.quit_process(4242, platform)

                self.assertEqual(kill.call_args_list, kills)
                self.assertEqual([call.args[0] for call in run.call_args_list], runs)


@unittest.skipIf(sys.platform == "win32", "the probes here are POSIX's os.kill and ps")
class ProcessExitedTests(unittest.TestCase):
    def test_a_running_process_is_not_exited_and_a_reaped_one_is(self):
        finished = subprocess.Popen([sys.executable, "-c", "pass"])
        finished.wait()

        self.assertFalse(start_app.process_exited(os.getpid()))
        self.assertTrue(start_app.process_exited(finished.pid))

    def test_an_unreaped_child_is_exited(self):
        zombie = subprocess.Popen([sys.executable, "-c", "pass"])
        self.addCleanup(zombie.wait)
        deadline = time.monotonic() + 10
        while not self._ps_state(zombie.pid).startswith("Z"):
            self.assertLess(time.monotonic(), deadline, "the child did not exit within 10 s")
            time.sleep(0.05)

        self.assertTrue(start_app.process_exited(zombie.pid))

    def test_the_ps_state_decides_a_process_a_signal_finds(self):
        no_process = ProcessLookupError(3, "No such process")
        not_permitted = PermissionError(1, "Operation not permitted")

        def ps_prints(code, stdout):
            return subprocess.CompletedProcess([], code, stdout, "")

        rows = [
            ("no process to signal", [no_process], [], True),
            ("a running process", [None], [ps_prints(0, "Ss\n")], False),
            ("a zombie", [None], [ps_prints(0, "Z\n")], True),
            ("a zombie this one may not signal", [not_permitted], [ps_prints(0, "Z+\n")], True),
            ("a running process this one may not signal", [not_permitted], [ps_prints(0, "S\n")], False),
            ("ps cannot run", [None, None], [FileNotFoundError(2, "No such file", "ps")], False),
            ("the process gone before ps reads it", [None, no_process], [ps_prints(1, "")], True),
            ("ps prints nothing for a process still there", [not_permitted, not_permitted], [ps_prints(0, "")],
             False),
        ]
        for name, kills, ps_runs, exited in rows:
            with (self.subTest(name), mock.patch.object(start_app.os, "kill", side_effect=kills),
                  mock.patch.object(start_app.subprocess, "run", side_effect=ps_runs)):
                self.assertEqual(start_app.process_exited(4242, "linux"), exited)

    @staticmethod
    def _ps_state(pid):
        return subprocess.run(["ps", "-o", "stat=", "-p", str(pid)], capture_output=True, text=True).stdout.strip()


@unittest.skipIf(sys.platform == "win32", "Unix sockets are not Windows")
class ChannelAcceptsTests(unittest.TestCase):
    def test_a_listening_socket_accepts_and_a_missing_one_does_not(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        path = str(Path(folder.name) / "s.sock")
        self.assertFalse(start_app.channel_accepts(path))
        listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.addCleanup(listener.close)
        listener.bind(path)
        listener.listen()

        self.assertTrue(start_app.channel_accepts(path))


if __name__ == "__main__":
    unittest.main()
