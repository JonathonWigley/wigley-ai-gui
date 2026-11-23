"""hook.py: the request each tool call sends, the paths a `git commit` commits, the stdout line, the exchange with a
fake app on a temp Unix socket under the deadline, git calls cut to the deadline, and a main that always exits 0."""

import io
import json
import queue
import socket
import subprocess
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest import mock

import hook

WAIT_SECONDS = 5.0
TEST_DEADLINE_SECONDS = 0.5
DEADLINE_MARGIN_SECONDS = 0.4
DRIP_SECONDS = 0.2

TEXT = ("Chatroom: src/a.ts is claimed by Shop Revamp (refactor; 12 min left) — ask them in the room before you "
        "change it.")
HELLO = {"protocol": 2, "session_id": "session-1", "project_dir": "/w", "harness": "claude", "config_dir": None,
         "row_id": "row-7", "hook": "chatroom.pre"}
REQUEST = {"tool": "edit", "paths": ["/w/src/a.ts"], "agentId": None, "cwd": "/w"}


def hook_input(tool_name, tool_input, **fields):
    return {"session_id": "session-1", "transcript_path": "/t.jsonl", "cwd": "/w", "permission_mode": "default",
            "hook_event_name": "PreToolUse", "tool_name": tool_name, "tool_input": tool_input,
            "tool_use_id": "toolu_1", **fields}


class FakeGit:
    """A run_git that answers by args (top /w, staged a.ts, tracked b.ts) and records each call's args and cwd."""

    ANSWERS = {
        ("rev-parse", "--show-toplevel"): "/w\n",
        ("diff", "--cached", "--name-only", "-z"): "a.ts\0",
        ("diff", "--name-only", "-z"): "b.ts\0",
    }

    def __init__(self, failing=()):
        self.calls = []
        self._failing = set(failing)

    def __call__(self, args, cwd):
        self.calls.append((tuple(args), cwd))
        return None if tuple(args) in self._failing else self.ANSWERS.get(tuple(args))


class FakeHookApp:
    """The app's side of a hook call on a Unix socket: reads the hello and request lines, records them, then answers
    as `mode` says — text, refuse, silent, drip (one byte per DRIP_SECONDS, no newline) — or, for close, closes on
    accept."""

    def __init__(self, path: str, mode: str):
        self.received = queue.Queue()
        self._mode = mode
        self._connections = []
        self._stopped = threading.Event()
        self._listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self._listener.bind(path)
        self._listener.listen()
        self._listener.settimeout(0.05)
        threading.Thread(target=self._accept, daemon=True).start()

    def _accept(self) -> None:
        while not self._stopped.is_set():
            try:
                connection, _ = self._listener.accept()
            except socket.timeout:
                continue
            except OSError:
                return
            connection.settimeout(None)
            self._connections.append(connection)
            threading.Thread(target=self._talk, args=(connection,), daemon=True).start()

    def _talk(self, connection: socket.socket) -> None:
        try:
            if self._mode == "close":
                connection.close()
                return
            reader = connection.makefile("rb")
            self.received.put((json.loads(reader.readline()), json.loads(reader.readline())))
            if self._mode == "text":
                connection.sendall(json.dumps({"ok": True, "reply": {"text": TEXT}}).encode() + b"\n")
            elif self._mode == "refuse":
                connection.sendall(json.dumps({"ok": False, "error": "no live session"}).encode() + b"\n")
            elif self._mode == "silent":
                self._stopped.wait(WAIT_SECONDS)
            elif self._mode == "drip":
                connection.sendall(b"{")
                while not self._stopped.wait(DRIP_SECONDS):
                    connection.sendall(b" ")
            connection.close()
        except (OSError, ValueError):
            return

    def next_received(self):
        return self.received.get(timeout=WAIT_SECONDS)

    def stop(self) -> None:
        self._stopped.set()
        self._listener.close()
        for connection in self._connections:
            try:
                connection.close()
            except OSError:
                pass


class HookTestCase(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.dir = Path(folder.name)

    def start_app(self, mode: str) -> tuple[str, FakeHookApp]:
        channel = str(self.dir / f"{mode}.sock")
        app = FakeHookApp(channel, mode)
        self.addCleanup(app.stop)
        return channel, app

    def write_endpoint(self, channel: str) -> None:
        endpoint = {"protocol": 1, "channel": channel, "launch": {"command": ["npm", "start"], "cwd": "/app"}}
        (self.dir / "endpoint.json").write_text(json.dumps(endpoint), encoding="utf-8")


class RequestTests(unittest.TestCase):
    def test_request_from_input(self):
        commit_request = {"tool": "commit", "paths": ["/w/a.ts"], "agentId": None, "cwd": "/w"}
        rows = [
            ("edit pre in a subagent", "pre", hook_input("Edit", {"file_path": "/w/a.ts"}, agent_id="agent-1"),
             {"tool": "edit", "paths": ["/w/a.ts"], "agentId": "agent-1", "cwd": "/w"}),
            ("write post, main agent", "post", hook_input("Write", {"file_path": "/w/b.ts"}),
             {"tool": "write", "paths": ["/w/b.ts"], "agentId": None, "cwd": "/w"}),
            ("multiedit pre", "pre", hook_input("MultiEdit", {"file_path": "/w/c.ts"}),
             {"tool": "edit", "paths": ["/w/c.ts"], "agentId": None, "cwd": "/w"}),
            ("notebookedit pre", "pre", hook_input("NotebookEdit", {"notebook_path": "/w/n.ipynb"}),
             {"tool": "edit", "paths": ["/w/n.ipynb"], "agentId": None, "cwd": "/w"}),
            ("notebookedit with no notebook_path", "pre", hook_input("NotebookEdit", {"file_path": "/w/n.ipynb"}),
             None),
            ("bash git commit pre", "pre", hook_input("Bash", {"command": "git commit -m x"}), commit_request),
            ("bash git -C commit pre, cwd the git folder", "pre", hook_input("Bash", {"command": "git -C sub commit -m x"}),
             {**commit_request, "cwd": "/w/sub"}),
            ("bash npm test pre", "pre", hook_input("Bash", {"command": "npm test"}), None),
            ("bash git commit post", "post", hook_input("Bash", {"command": "git commit -m x"}), None),
            ("read pre", "pre", hook_input("Read", {"file_path": "/w/a.ts"}), None),
            ("input not an object", "pre", ["Edit"], None),
            ("edit with no file_path", "pre", hook_input("Edit", {"old_string": "a"}), None),
        ]
        for name, event, given, expected in rows:
            with self.subTest(name):
                self.assertEqual(hook.request_from_input(event, given, FakeGit()), expected)

    def test_commit_paths(self):
        rows = [
            ('git commit -m "fix it"', ["/w/a.ts"]),
            ("git commit -am x", ["/w/a.ts", "/w/b.ts"]),
            ("git commit -m x -- c.ts sub/", ["/w/c.ts", "/w/sub"]),
            ("cd x && git commit --message=y d.ts", ["/w/d.ts"]),
            ("git add n.ts&&git commit -m x b.ts", ["/w/b.ts"]),
            ("git add n.ts && git commit -m x", ["/w/a.ts", "/w/n.ts"]),
            ("git add -A && git commit -m x", ["/w/a.ts", "/w"]),
            ("git -C sub add -u && git commit -m x", ["/w/a.ts", "/w"]),
            ("git -C sub add --no-ignore-removal && git commit -m x", ["/w/a.ts", "/w"]),
            ("git add --all n.ts && git commit -m x", ["/w/a.ts", "/w/n.ts"]),
            ("git commit -i -m x c.ts", ["/w/a.ts", "/w/c.ts"]),
            ("git add n.ts && git commit --include -m x b.ts", ["/w/a.ts", "/w/n.ts", "/w/b.ts"]),
            ("git commit -o c.ts -m x", ["/w/c.ts"]),
            ("git commit --only c.ts -m x", ["/w/c.ts"]),
            ("git commit -ma", ["/w/a.ts"]),
            ("git commit -uno -m x", ["/w/a.ts"]),
            ("git commit -Sabc -m x", ["/w/a.ts"]),
            ("git commit -m x --pathspec-from-file f.txt", []),
            ("git commit -m x --pathspec-from-file=f.txt", []),
            ("git commit -m x && git push origin main", ["/w/a.ts"]),
            ("git status", None),
            ("git log --grep commit", None),
            ('git commit -m "unclosed', None),
        ]
        for command, expected in rows:
            with self.subTest(command):
                self.assertEqual(hook.commit_paths(command, "/w", FakeGit()), expected)

    def test_commit_paths_runs_git_in_the_dash_c_folder(self):
        run_git = FakeGit()
        self.assertEqual(hook.commit_paths("git -C sub commit -m x", "/w", run_git), ["/w/a.ts"])
        self.assertEqual({cwd for _, cwd in run_git.calls}, {"/w/sub"})

    def test_commit_paths_reads_each_top_level_once(self):
        run_git = FakeGit()
        hook.commit_paths("git add -A && git -C sub add -u && git commit -m x", "/w", run_git)
        top_reads = [cwd for args, cwd in run_git.calls if args == ("rev-parse", "--show-toplevel")]
        self.assertEqual(top_reads, ["/w", "/w/sub"])

    def test_commit_paths_roots_a_bare_add_at_its_folder_when_the_top_level_read_fails(self):
        run_git = FakeGit(failing={("rev-parse", "--show-toplevel")})
        self.assertEqual(hook.commit_paths("git -C sub add -u && git commit -m x", "/w", run_git), ["/w/sub"])

    def test_commit_paths_keeps_the_pathspec_when_the_staged_read_fails(self):
        run_git = FakeGit(failing={("diff", "--cached", "--name-only", "-z")})
        self.assertEqual(hook.commit_paths("git commit -i -m x c.ts", "/w", run_git), ["/w/c.ts"])

    def test_output_for(self):
        rows = [
            ("pre", TEXT, {"hookSpecificOutput": {"hookEventName": "PreToolUse", "additionalContext": TEXT}}),
            ("post", TEXT, {"hookSpecificOutput": {"hookEventName": "PostToolUse", "additionalContext": TEXT}}),
            ("pre", None, None),
            ("post", "", None),
        ]
        for event, text, expected in rows:
            with self.subTest(event=event, text=text):
                line = hook.output_for(event, text)
                if expected is None:
                    self.assertEqual(line, "")
                else:
                    self.assertEqual(json.loads(line), expected)
                    self.assertNotIn("\n", line)


class GitRunnerTests(unittest.TestCase):
    def test_git_runner_respects_the_deadline(self):
        finished = subprocess.CompletedProcess(["git"], 0, stdout="/w\n", stderr="")
        with mock.patch.object(hook.subprocess, "run", return_value=finished) as run:
            self.assertIsNone(hook.git_runner(time.monotonic() - 1)(["rev-parse"], "/w"))
            run.assert_not_called()
        rows = [(2.0, hook.GIT_TIMEOUT_SECONDS), (0.3, 0.3)]
        for time_left, most in rows:
            with self.subTest(time_left=time_left), \
                    mock.patch.object(hook.subprocess, "run", return_value=finished) as run:
                self.assertEqual(hook.git_runner(time.monotonic() + time_left)(["rev-parse"], "/w"), "/w\n")
                self.assertLessEqual(run.call_args.kwargs["timeout"], most)

    def test_git_runner_answers_none_when_git_fails(self):
        rows = [
            ("non-zero exit", {"return_value": subprocess.CompletedProcess(["git"], 128, stdout="", stderr="no")}),
            ("timeout", {"side_effect": subprocess.TimeoutExpired(["git"], 1.0)}),
            ("no git", {"side_effect": FileNotFoundError("git")}),
        ]
        for name, behaviour in rows:
            with self.subTest(name), mock.patch.object(hook.subprocess, "run", **behaviour):
                self.assertIsNone(hook.git_runner(time.monotonic() + 2.0)(["rev-parse"], "/w"))


class AskAppTests(HookTestCase):
    def test_ask_app_against_a_fake_app(self):
        rows = [("text", TEXT), ("refuse", None), ("silent", None), ("drip", None), ("close", None)]
        for mode, expected in rows:
            with self.subTest(mode):
                channel, app = self.start_app(mode)
                started = time.monotonic()
                self.assertEqual(hook.ask_app(channel, HELLO, REQUEST, started + TEST_DEADLINE_SECONDS), expected)
                self.assertLess(time.monotonic() - started, TEST_DEADLINE_SECONDS + DEADLINE_MARGIN_SECONDS)
                if mode == "text":
                    self.assertEqual(app.next_received(), (HELLO, REQUEST))

    def test_ask_app_with_no_app_listening(self):
        self.assertIsNone(hook.ask_app(str(self.dir / "none.sock"), HELLO, REQUEST, time.monotonic() + 0.5))


class MainTests(HookTestCase):
    EDIT_INPUT = hook_input("Edit", {"file_path": "/w/src/a.ts"})

    def run_main(self, stdin_text: str, env: dict) -> tuple[int, str]:
        stdout = io.StringIO()
        with mock.patch("sys.stderr", io.StringIO()):
            code = hook.main(["pre"], io.StringIO(stdin_text), stdout, env)
        return code, stdout.getvalue()

    def test_main_against_a_fake_app(self):
        pre_line = json.dumps({"hookSpecificOutput": {"hookEventName": "PreToolUse", "additionalContext": TEXT}})
        rows = [("text", pre_line + "\n"), ("drip", "")]
        env = {"WIGLEY_AI_GUI_ENDPOINT_DIR": str(self.dir), "WIGLEY_SESSION_ROW": "row-7"}
        for mode, expected in rows:
            with self.subTest(mode), mock.patch.object(hook, "HOOK_DEADLINE_SECONDS", TEST_DEADLINE_SECONDS):
                channel, app = self.start_app(mode)
                self.write_endpoint(channel)
                started = time.monotonic()
                self.assertEqual(self.run_main(json.dumps(self.EDIT_INPUT), env), (0, expected))
                self.assertLess(time.monotonic() - started, TEST_DEADLINE_SECONDS + DEADLINE_MARGIN_SECONDS)
                hello, request = app.next_received()
                self.assertEqual((hello["protocol"], hello["hook"], hello["row_id"], hello["session_id"]),
                                 (2, "chatroom.pre", "row-7", "session-1"))
                self.assertEqual(request, {"tool": "edit", "paths": ["/w/src/a.ts"], "agentId": None, "cwd": "/w"})

    def test_main_never_fails(self):
        def raising_runner(deadline):
            def run_git(args, cwd):
                raise RuntimeError("git exploded")
            return run_git

        app_env = {"WIGLEY_AI_GUI_ENDPOINT_DIR": str(self.dir)}
        rows = [
            ("stdin not JSON", "not json", app_env, None),
            ("no endpoint folder", json.dumps(self.EDIT_INPUT), {"WIGLEY_AI_GUI_ENDPOINT_DIR": str(self.dir / "gone")},
             None),
            ("run_git raising", json.dumps(hook_input("Bash", {"command": "git commit -m x"})), app_env,
             raising_runner),
        ]
        channel, _ = self.start_app("text")
        self.write_endpoint(channel)
        for name, stdin_text, env, runner in rows:
            with self.subTest(name), mock.patch.object(hook, "git_runner", runner or hook.git_runner):
                self.assertEqual(self.run_main(stdin_text, env), (0, ""))

    def test_main_runs_no_git_when_the_app_is_away(self):
        run_git = FakeGit()
        commit_input = json.dumps(hook_input("Bash", {"command": "git commit -m x"}))
        env = {"WIGLEY_AI_GUI_ENDPOINT_DIR": str(self.dir / "gone")}
        with mock.patch.object(hook, "git_runner", lambda deadline: run_git):
            self.assertEqual(self.run_main(commit_input, env), (0, ""))
        self.assertEqual(run_git.calls, [])


if __name__ == "__main__":
    unittest.main()
