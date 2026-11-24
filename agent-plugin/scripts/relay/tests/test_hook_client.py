"""hook_client.py: the reply object of one hook call against a fake app on a temp Unix socket, None on every failure
within the deadline, and the hook hello's fields."""

import tempfile
import time
import unittest
from pathlib import Path

import endpoint
import hook_client
from tests.fake_hook_app import FakeHookApp

TEST_DEADLINE_SECONDS = 0.5
DEADLINE_MARGIN_SECONDS = 0.4

HELLO = {"protocol": 2, "session_id": "session-1", "project_dir": "/w", "harness": "claude", "config_dir": None,
         "row_id": "row-7", "hook": "workflow.checklist"}
REQUEST = {"mode": "edit"}
REPLY = {"reported": True, "open": 2, "items": [{"text": "Write the hook", "done": False}]}


class AskAppReplyTests(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.dir = Path(folder.name)

    def start_app(self, name: str, mode: str, answer: dict | None = None) -> tuple[str, FakeHookApp]:
        channel = str(self.dir / f"{name}.sock")
        app = FakeHookApp(channel, mode, answer)
        self.addCleanup(app.stop)
        return channel, app

    def test_ask_app_reply_against_a_fake_app(self):
        rows = [
            ("answered", "answer", {"ok": True, "reply": REPLY}, REPLY),
            ("refused", "answer", {"ok": False, "error": "no live session"}, None),
            ("ok with no reply object", "answer", {"ok": True, "reply": "text"}, None),
            ("channel closed", "close", None, None),
            ("silent past the deadline", "silent", None, None),
            ("line not complete by the deadline", "drip", None, None),
        ]
        for index, (name, mode, answer, expected) in enumerate(rows):
            with self.subTest(name):
                channel, app = self.start_app(str(index), mode, answer)
                started = time.monotonic()
                reply = hook_client.ask_app_reply(channel, HELLO, REQUEST, started + TEST_DEADLINE_SECONDS)
                self.assertEqual(reply, expected)
                self.assertLess(time.monotonic() - started, TEST_DEADLINE_SECONDS + DEADLINE_MARGIN_SECONDS)
                if mode == "answer":
                    self.assertEqual(app.next_received(), (HELLO, REQUEST))

    def test_ask_app_reply_with_no_app_listening(self):
        channel = str(self.dir / "none.sock")
        self.assertIsNone(hook_client.ask_app_reply(channel, HELLO, REQUEST, time.monotonic() + 0.5))


class SessionHelloTests(unittest.TestCase):
    def test_session_hello(self):
        hook_input = {"session_id": "session-1", "cwd": "/w/sub"}
        rows = [
            ("app session", {"WIGLEY_SESSION_ROW": "row-7", "CLAUDE_PROJECT_DIR": "/w"},
             {**HELLO, "hook": "chatroom.pre"}),
            ("no row, no project dir", {}, {**HELLO, "hook": "chatroom.pre", "row_id": None, "project_dir": "/w/sub"}),
        ]
        for name, env, expected in rows:
            with self.subTest(name):
                self.assertEqual(hook_client.session_hello("chatroom.pre", hook_input, env), expected)
        self.assertEqual(HELLO["protocol"], endpoint.HOOK_PROTOCOL)


if __name__ == "__main__":
    unittest.main()
