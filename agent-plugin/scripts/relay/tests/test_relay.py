"""relay.py against a fake app on a temp Unix socket: the hello line, forwarding unchanged, the replayed handshake,
starting the app, the answers with no app, a call held across an app restart and sent again, a call arriving soon after
a drop held the same way, the app-gone answers when no app comes back, the relay's own tool-list notice, a refused
hello, the deny a permission_prompt call gets on each of those paths, and offline mode's table answers and calls file.
The channels themselves are tested in test_endpoint.py."""

import json
import os
import queue
import socket
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest import mock

import endpoint
import relay
import start_app

WAIT_SECONDS = 5.0

HELLO = {"protocol": 1, "session_id": "session-1", "project_dir": "/work/project", "deadline_seconds": 300,
         "harness": "claude"}
INITIALIZE = {"jsonrpc": "2.0", "id": 0, "method": "initialize",
              "params": {"protocolVersion": "2025-06-18", "capabilities": {},
                         "clientInfo": {"name": "host", "version": "1"}}}
INITIALIZED = {"jsonrpc": "2.0", "method": "notifications/initialized"}
TOOLS_CHANGED = {"jsonrpc": "2.0", "method": "notifications/tools/list_changed"}


ROUND_NOT_STARTED_NEXT = (
    "No round exists. Send the same round again with ask_round once: the relay tries the start again. If "
    "needs_manual_open comes back a second time, tell the user the reason in summary and ask the round's questions "
    "and findings in the reply. collect_last_round is never the answer to this outcome.")
PRIMER_NOT_STARTED_NEXT = (
    "No primer exists. Send the same primer again with open_primer once: the relay tries the start again. If "
    "needs_manual_open comes back a second time, tell the user the reason in summary and work through the "
    "primer's rows in chat. collect_last_primer is never the answer to this outcome.")
ROUND_APP_GONE = ("The wigley-ai-gui app closed while this call waited; send the round again with ask_round "
                  "— it opens pre-filled.")
AUDIO_PICKER_NOT_STARTED_NEXT = (
    "No audio picker exists. Send the same audio picker again with open_audio_picker once: the relay tries the start "
    "again. If needs_manual_open comes back a second time, tell the user the reason in summary and name the pick and "
    "its ranked alternatives in the reply. "
    "collect_last_audio_picker is never the answer to this outcome.")
PRIMER_APP_GONE = ("The wigley-ai-gui app closed while this call waited; send the primer again with open_primer "
                   "— it opens pre-filled.")
ROUND_REFUSED = (
    "The wigley-ai-gui app refused this relay: boom. Send the round again with ask_round: the relay says hello again "
    "on each call. If the refusal comes back, tell the user the app's reason. When the reason is a protocol mismatch, "
    "the user updates the app, which carries the auri plugin, so both speak one relay protocol.")
ROUND_NOT_STARTED = {"outcome": "needs_manual_open", "summary": "The wigley-ai-gui app could not be started: boom",
                     "next": ROUND_NOT_STARTED_NEXT, "answers": [], "findings": [], "notices": []}
PRIMER_NOT_STARTED = {"outcome": "needs_manual_open", "summary": "The wigley-ai-gui app could not be started: boom",
                      "next": PRIMER_NOT_STARTED_NEXT}
AUDIO_PICKER_NOT_STARTED = {"outcome": "needs_manual_open",
                            "summary": "The wigley-ai-gui app could not be started: boom",
                            "next": AUDIO_PICKER_NOT_STARTED_NEXT}
NO_FORM_TOOL = "some_app_tool"
NO_FORM_NOT_STARTED = {
    "outcome": "needs_manual_open", "summary": "The wigley-ai-gui app could not be started: boom",
    "next": ("some_app_tool did not run. Call some_app_tool again once the app is back: the relay tries the start "
             "again on each call. If needs_manual_open comes back a second time, tell the user the reason in summary "
             "and that some_app_tool did not run.")}
NO_FORM_APP_GONE = ("The wigley-ai-gui app closed while this call waited; call some_app_tool again once the app is "
                    "back, or tell the user some_app_tool failed.")
NO_FORM_REFUSED = (
    "The wigley-ai-gui app refused this relay: boom. Call some_app_tool again: the relay says hello again on each "
    "call. If the refusal comes back, tell the user the app's reason. When the reason is a protocol mismatch, the "
    "user updates the app, which carries the auri plugin, so both speak one relay protocol.")


def tool_call(request_id):
    return named_tool_call(request_id, "ask_round", {"heading": "Pick a theme"})


def named_tool_call(request_id, name, arguments=None):
    return {"jsonrpc": "2.0", "id": request_id, "method": "tools/call",
            "params": {"name": name, "arguments": arguments or {}}}


def compact(message) -> bytes:
    """The fake app's spelling of a message, unlike relay.py's own json.dumps, so a re-encoded line would show."""
    return json.dumps(message, separators=(",", ":")).encode() + b"\n"


def wait_until(condition) -> None:
    deadline = time.monotonic() + WAIT_SECONDS
    while not condition():
        if time.monotonic() > deadline:
            raise AssertionError("timed out waiting for the relay")
        time.sleep(0.01)


class FakeApp:
    """The app's side of the channel: answers the hello, records every message it receives, answers each request."""

    ANSWERS = {
        "initialize": {"protocolVersion": "2025-06-18", "capabilities": {"tools": {}},
                       "serverInfo": {"name": "fake-app", "version": "0"}},
        "tools/call": {"content": [{"type": "text", "text": "answered by the app"}],
                       "structuredContent": {"outcome": "submitted"}},
    }

    def __init__(self, path: str, hello_reply=None, sent_with_reply: bytes = b"", hold_calls: bool = False,
                 hold_tool_lists: bool = False):
        self.hellos = queue.Queue()
        self.received = queue.Queue()
        self.received_raw = queue.Queue()
        self.ended_connections = queue.Queue()
        self._hello_reply = hello_reply if hello_reply is not None else {"ok": True}
        self._sent_with_reply = sent_with_reply
        self._hold_calls = hold_calls
        self._hold_tool_lists = hold_tool_lists
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
            reader = connection.makefile("rb")
            self.hellos.put(json.loads(reader.readline()))
            connection.sendall(compact(self._hello_reply) + self._sent_with_reply)
            if not self._hello_reply.get("ok"):
                connection.close()
                return
            for line in reader:
                self.received_raw.put(line.rstrip(b"\n"))
                message = json.loads(line)
                self.received.put(message)
                is_request = "id" in message and "method" in message
                is_held_call = self._hold_calls and message.get("method") == "tools/call"
                is_held_list = self._hold_tool_lists and message.get("method") == "tools/list"
                if is_request and not is_held_call and not is_held_list:
                    answer = self.ANSWERS.get(message["method"], {})
                    connection.sendall(compact({"jsonrpc": "2.0", "id": message["id"], "result": answer}))
        except (OSError, ValueError):
            return
        finally:
            self.ended_connections.put(connection)

    def next_received(self):
        return self.received.get(timeout=WAIT_SECONDS)

    def next_received_raw(self) -> bytes:
        return self.received_raw.get(timeout=WAIT_SECONDS)

    def drop(self) -> None:
        """Closes every connection, as an app that quit would."""
        for connection in self._connections:
            try:
                connection.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            connection.close()
        self._connections.clear()

    def stop(self) -> None:
        self._stopped.set()
        self._listener.close()
        self.drop()


class StillRunning:
    """A spawned start command that has not exited."""

    def exit_code(self):
        return None

    def error_output(self):
        return ""

    def close(self):
        pass


class RelayTestCase(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.dir = Path(folder.name)
        self.channel = str(self.dir / "s.sock")
        self.output = queue.Queue()
        self.spawned = []

    def start_app(self, **options) -> FakeApp:
        app = FakeApp(self.channel, **options)
        self.addCleanup(app.stop)
        return app

    def write_endpoint(self, command=("npm", "start"), cwd="/work/wigley-ai-gui") -> None:
        endpoint = {"protocol": 1, "channel": self.channel, "launch": {"command": list(command), "cwd": cwd}}
        (self.dir / "endpoint.json").write_text(json.dumps(endpoint), encoding="utf-8")

    def record_spawn(self, command, cwd) -> StillRunning:
        self.spawned.append((command, cwd))
        return StillRunning()

    def make_relay(self, spawn=None, launch_wait: float = 0.3, start=None, reconnect_wait: float = 0.3,
                   reconnect_poll: float = 0.02, offline_calls=None, hello=HELLO) -> relay.Relay:
        """A relay whose start is start_app's own, with a recording spawn, unless `start` replaces it."""
        def start_with_fakes():
            return start_app.start_app(self.dir, env={}, spawn=spawn or self.record_spawn,
                                       launch_wait=launch_wait, poll=0.02)

        made = relay.Relay(self.dir, hello, self.receive_host_line, start=start or start_with_fakes,
                           reconnect_wait=reconnect_wait, reconnect_poll=reconnect_poll, offline_calls=offline_calls)
        self.addCleanup(made.close)
        return made

    def receive_host_line(self, data: bytes) -> None:
        self.output.put(data)

    def send(self, made: relay.Relay, message) -> None:
        made.handle_line(json.dumps(message).encode())

    def next_output(self) -> bytes:
        return self.output.get(timeout=WAIT_SECONDS)

    def next_message(self):
        return json.loads(self.next_output())


class HelloTests(RelayTestCase):
    def test_hello_reads_session_project_and_deadline_from_the_environment(self):
        env = {"CLAUDE_CODE_SESSION_ID": "session-9", "CLAUDE_PROJECT_DIR": "/work/game",
               "WIGLEY_FORMS_DEADLINE_SECONDS": "300", "CLAUDECODE": "1", "CLAUDE_CONFIG_DIR": "/home/me/.claude-work",
               "WIGLEY_SESSION_ROW": "row-3"}
        self.assertEqual(relay.hello_from_env(env, "codex-aa"),
                         {"protocol": 1, "session_id": "session-9", "project_dir": "/work/game",
                          "deadline_seconds": 300, "harness": "claude", "config_dir": "/home/me/.claude-work",
                          "row_id": "row-3"})

    def test_hello_session_id_by_host(self):
        rows = [
            ({"CLAUDECODE": "1", "CLAUDE_CODE_SESSION_ID": "session-9"}, "codex-aa", "session-9"),
            ({}, "codex-aa", "codex-aa"),
            ({"CLAUDECODE": "1"}, "codex-aa", None),
            ({"CLAUDECODE": "0"}, "codex-bb", "codex-bb"),
            ({"WIGLEY_SESSION_ROW": "row-3"}, "codex-cc", None),
        ]
        for env, process_session_id, expected in rows:
            with self.subTest(env=env):
                self.assertEqual(relay.hello_from_env(env, process_session_id)["session_id"], expected)

    def test_codex_session_id_is_codex_and_32_hex(self):
        first, second = relay.codex_session_id(), relay.codex_session_id()

        self.assertRegex(first, r"^codex-[0-9a-f]{32}$")
        self.assertNotEqual(first, second)

    def test_a_codex_hello_keeps_its_session_id_across_an_app_restart(self):
        first = self.start_app()
        self.write_endpoint()
        made = self.make_relay(reconnect_wait=2.0, hello=relay.hello_from_env({}, relay.codex_session_id()))
        made.connect_if_running()
        first_id = first.hellos.get(timeout=WAIT_SECONDS)["session_id"]

        first.stop()
        wait_until(lambda: not made.connected)
        os.unlink(self.channel)
        second = self.start_app()
        self.send(made, tool_call(7))

        self.assertEqual(second.hellos.get(timeout=WAIT_SECONDS)["session_id"], first_id)
        self.assertTrue(first_id.startswith("codex-"))

    def test_the_hello_is_the_first_line_the_app_receives(self):
        app = self.start_app()
        self.write_endpoint()

        self.assertTrue(self.make_relay().connect_if_running())

        self.assertEqual(app.hellos.get(timeout=WAIT_SECONDS), HELLO)


class ForwardingTests(RelayTestCase):
    def test_forwards_the_hosts_messages_and_the_apps_answers_unchanged(self):
        app = self.start_app()
        self.write_endpoint()
        made = self.make_relay()
        made.connect_if_running()

        self.send(made, INITIALIZE)

        self.assertEqual(app.next_received(), INITIALIZE)
        self.assertEqual(self.next_output(),
                         compact({"jsonrpc": "2.0", "id": 0, "result": FakeApp.ANSWERS["initialize"]}))

    def test_bytes_the_app_sends_with_its_hello_reply_reach_the_host(self):
        notification = compact({"jsonrpc": "2.0", "method": "notifications/tools/list_changed"})
        self.start_app(sent_with_reply=notification)
        self.write_endpoint()

        self.make_relay().connect_if_running()

        self.assertEqual(self.next_output(), notification)


class NoAppTests(RelayTestCase):
    def test_initialize_echoes_the_hosts_protocol_version(self):
        made = self.make_relay()
        asked = {**INITIALIZE, "params": {**INITIALIZE["params"], "protocolVersion": "2025-11-25"}}

        self.send(made, asked)

        result = self.next_message()["result"]
        self.assertEqual(result["protocolVersion"], "2025-11-25")
        self.assertEqual(result["serverInfo"]["name"], "auri")
        self.assertEqual(result["capabilities"], {"tools": {"listChanged": True}})

    def test_tools_list_comes_from_the_apps_tools_file(self):
        tools = {"tools": [{"name": "ask_round", "description": "from the file", "inputSchema": {"type": "object"}}]}
        (self.dir / "tools.json").write_text(json.dumps(tools), encoding="utf-8")
        made = self.make_relay()

        self.send(made, {"jsonrpc": "2.0", "id": 1, "method": "tools/list"})

        self.assertEqual(self.next_message(), {"jsonrpc": "2.0", "id": 1, "result": tools})

    def test_tools_list_falls_back_to_a_built_in_list_with_the_same_names(self):
        made = self.make_relay()

        self.send(made, {"jsonrpc": "2.0", "id": 1, "method": "tools/list"})

        names = {tool["name"] for tool in self.next_message()["result"]["tools"]}
        self.assertEqual(names, {"ask_round", "collect_last_round", "open_primer", "collect_last_primer",
                                 "open_audio_picker", "collect_last_audio_picker"})

    def test_built_in_open_tools_take_any_object_leaving_validation_to_the_app(self):
        made = self.make_relay()

        self.send(made, {"jsonrpc": "2.0", "id": 1, "method": "tools/list"})

        schemas = {tool["name"]: tool["inputSchema"] for tool in self.next_message()["result"]["tools"]}
        self.assertEqual(schemas["ask_round"], {"type": "object"})
        self.assertEqual(schemas["open_primer"], {"type": "object"})
        self.assertEqual(schemas["open_audio_picker"], {"type": "object"})

    def test_ping_is_answered(self):
        made = self.make_relay()

        self.send(made, {"jsonrpc": "2.0", "id": 4, "method": "ping"})

        self.assertEqual(self.next_message(), {"jsonrpc": "2.0", "id": 4, "result": {}})

    def test_a_failed_start_returns_needs_manual_open_carrying_its_reason(self):
        made = self.make_relay(start=lambda: start_app.StartResult(False, "there is no wigley-ai-gui repo at /x"))

        self.send(made, tool_call(1))

        result = self.next_message()["result"]
        payload = result["structuredContent"]
        self.assertEqual(payload, relay.not_started("there is no wigley-ai-gui repo at /x", "ask_round"))
        self.assertEqual(json.loads(result["content"][0]["text"]), payload)
        self.assertEqual(payload["outcome"], "needs_manual_open")
        self.assertIn("there is no wigley-ai-gui repo at /x", payload["summary"])
        self.assertEqual(payload["next"], ROUND_NOT_STARTED_NEXT)
        self.assertEqual(payload["findings"], [])

    def test_a_failed_primer_start_returns_needs_manual_open_with_no_feature_or_entries(self):
        made = self.make_relay(start=lambda: start_app.StartResult(False, "there is no wigley-ai-gui repo at /x"))

        self.send(made, named_tool_call(1, "open_primer", {"feature": {"name": "Shop", "slug": "shop"}}))

        result = self.next_message()["result"]
        expected = {"outcome": "needs_manual_open",
                    "summary": "The wigley-ai-gui app could not be started: there is no wigley-ai-gui repo at /x",
                    "next": PRIMER_NOT_STARTED_NEXT}
        self.assertEqual(result["structuredContent"], expected)
        self.assertEqual(json.loads(result["content"][0]["text"]), expected)

    def test_a_tool_call_with_no_endpoint_runs_the_start(self):
        starts = []

        def start_that_brings_up_the_app():
            starts.append(self.start_app())
            self.write_endpoint()
            return start_app.StartResult(True, "The wigley-ai-gui app is ready.")

        made = self.make_relay(start=start_that_brings_up_the_app)

        self.send(made, tool_call(1))

        self.assertEqual(self.next_message(),
                         {"jsonrpc": "2.0", "id": 1, "result": FakeApp.ANSWERS["tools/call"]})
        self.assertEqual(len(starts), 1)

    def test_a_start_that_never_answers_returns_needs_manual_open(self):
        self.write_endpoint(command=("npm", "start"), cwd="/work/wigley-ai-gui")
        made = self.make_relay(launch_wait=0.2)

        self.send(made, tool_call(1))

        self.assertEqual(self.spawned, [(["npm", "start"], "/work/wigley-ai-gui")])
        payload = self.next_message()["result"]["structuredContent"]
        self.assertEqual(payload["outcome"], "needs_manual_open")
        self.assertIn("did not open its channel", payload["summary"])


class StartingTests(RelayTestCase):
    def test_a_tool_call_starts_the_app_and_replays_the_handshake(self):
        self.write_endpoint()
        started = []
        made = self.make_relay(spawn=lambda command, cwd: started.append(self.start_app()) or StillRunning())
        self.send(made, INITIALIZE)
        self.next_output()
        self.send(made, INITIALIZED)

        self.send(made, tool_call(1))

        self.assertEqual(self.next_message(), TOOLS_CHANGED)
        self.assertEqual(self.next_message(),
                         {"jsonrpc": "2.0", "id": 1, "result": FakeApp.ANSWERS["tools/call"]})
        app = started[0]
        self.assertEqual(app.next_received(), {**INITIALIZE, "id": relay.REPLAY_ID})
        self.assertEqual(app.next_received(), INITIALIZED)
        self.assertEqual(app.next_received(), tool_call(1))
        self.assertTrue(self.output.empty(), "the app's answer to the replayed initialize reached the host")


class AppGoneTests(RelayTestCase):
    def test_a_call_waiting_when_the_app_goes_gets_the_app_gone_error(self):
        app = self.start_app(hold_calls=True)
        self.write_endpoint()
        made = self.make_relay(start=lambda: start_app.StartResult(False, "gone"), reconnect_wait=0.1)
        made.connect_if_running()
        self.send(made, tool_call(7))
        app.next_received()

        app.stop()

        self.assertEqual(self.next_message(),
                         {"jsonrpc": "2.0", "id": 7,
                          "result": {"content": [{"type": "text", "text": ROUND_APP_GONE}], "isError": True}})

    def test_each_waiting_call_gets_the_app_gone_text_of_its_own_tool(self):
        app = self.start_app(hold_calls=True)
        self.write_endpoint()
        made = self.make_relay(start=lambda: start_app.StartResult(False, "gone"), reconnect_wait=0.1)
        made.connect_if_running()
        self.send(made, tool_call(7))
        self.send(made, named_tool_call(8, "open_primer"))
        app.next_received()
        app.next_received()

        app.stop()

        by_id = {message["id"]: message["result"] for message in (self.next_message(), self.next_message())}
        self.assertEqual(by_id, {
            7: {"content": [{"type": "text", "text": ROUND_APP_GONE}], "isError": True},
            8: {"content": [{"type": "text", "text": PRIMER_APP_GONE}], "isError": True},
        })

    def test_a_tools_list_waiting_when_the_app_goes_is_answered_from_the_tools_file(self):
        tools = {"tools": [{"name": "ask_round", "description": "from the file", "inputSchema": {"type": "object"}}]}
        (self.dir / "tools.json").write_text(json.dumps(tools), encoding="utf-8")
        app = self.start_app(hold_tool_lists=True)
        self.write_endpoint()
        made = self.make_relay()
        made.connect_if_running()
        self.send(made, {"jsonrpc": "2.0", "id": 9, "method": "tools/list"})
        app.next_received()

        app.drop()

        self.assertEqual(self.next_message(), {"jsonrpc": "2.0", "id": 9, "result": tools})

    def test_a_tools_list_waiting_at_the_drop_is_answered_while_a_call_waiting_there_is_held(self):
        first = self.start_app(hold_calls=True, hold_tool_lists=True)
        self.write_endpoint()
        made = self.make_relay(reconnect_wait=2.0)
        made.connect_if_running()
        self.send(made, tool_call(7))
        self.send(made, {"jsonrpc": "2.0", "id": 9, "method": "tools/list"})
        first.next_received()
        first.next_received()

        first.stop()

        self.assertEqual(self.next_message(), {"jsonrpc": "2.0", "id": 9, "result": relay.BUILT_IN_TOOLS})
        wait_until(lambda: not made.connected)
        os.unlink(self.channel)
        self.start_app()
        self.assertEqual(self.next_message(), {"jsonrpc": "2.0", "id": 7, "result": FakeApp.ANSWERS["tools/call"]})
        self.assertEqual(self.spawned, [])

    def test_a_tools_list_the_host_cancelled_gets_no_answer_at_the_drop(self):
        app = self.start_app(hold_tool_lists=True)
        self.write_endpoint()
        made = self.make_relay()
        made.connect_if_running()
        self.send(made, {"jsonrpc": "2.0", "id": 9, "method": "tools/list"})
        app.next_received()
        cancel = {"jsonrpc": "2.0", "method": "notifications/cancelled", "params": {"requestId": 9}}
        self.send(made, cancel)
        self.assertEqual(app.next_received(), cancel)

        app.drop()
        wait_until(lambda: not made.connected)
        self.send(made, {"jsonrpc": "2.0", "id": 4, "method": "ping"})

        self.assertEqual(self.next_message()["id"], 4)

    def test_a_tools_list_the_app_answered_gets_no_second_answer_at_the_drop(self):
        app = self.start_app()
        self.write_endpoint()
        made = self.make_relay()
        made.connect_if_running()
        self.send(made, {"jsonrpc": "2.0", "id": 9, "method": "tools/list"})
        self.assertEqual(self.next_message()["id"], 9)

        app.drop()
        wait_until(lambda: not made.connected)
        self.send(made, {"jsonrpc": "2.0", "id": 4, "method": "ping"})

        self.assertEqual(self.next_message()["id"], 4)

    def test_a_tools_list_answered_at_one_drop_gets_no_second_answer_at_the_next(self):
        app = self.start_app(hold_tool_lists=True)
        self.write_endpoint()
        made = self.make_relay()
        made.connect_if_running()
        self.send(made, {"jsonrpc": "2.0", "id": 9, "method": "tools/list"})
        app.next_received()
        app.drop()
        self.assertEqual(self.next_message()["id"], 9)
        wait_until(lambda: not made.connected)

        made.connect_if_running()
        app.drop()
        wait_until(lambda: not made.connected)
        self.send(made, {"jsonrpc": "2.0", "id": 4, "method": "ping"})

        self.assertEqual(self.next_message()["id"], 4)

    def test_a_call_after_the_wait_past_a_drop_starts_the_app_at_once(self):
        app = self.start_app()
        self.write_endpoint()
        made = self.make_relay(reconnect_wait=0.0)
        made.connect_if_running()
        app.stop()
        wait_until(lambda: not made.connected)

        self.send(made, tool_call(2))

        self.assertEqual(len(self.spawned), 1)
        self.assertEqual(self.next_message()["result"]["structuredContent"]["outcome"], "needs_manual_open")

    def test_a_call_the_host_cancelled_gets_no_app_gone_error(self):
        app = self.start_app(hold_calls=True)
        self.write_endpoint()
        made = self.make_relay()
        made.connect_if_running()
        self.send(made, tool_call(3))
        app.next_received()
        cancel = {"jsonrpc": "2.0", "method": "notifications/cancelled", "params": {"requestId": 3}}
        self.send(made, cancel)
        self.assertEqual(app.next_received(), cancel)

        app.drop()
        wait_until(lambda: not made.connected)
        self.send(made, {"jsonrpc": "2.0", "id": 4, "method": "ping"})

        self.assertEqual(self.next_message()["id"], 4)

    def test_an_answer_the_reader_holds_when_a_failed_write_drops_the_channel_is_not_sent_again(self):
        app = self.start_app()
        self.write_endpoint()
        made = self.make_relay(start=lambda: start_app.StartResult(False, "gone"), reconnect_wait=0.1)
        holding, holds_answer, release, read_ended = (threading.Event() for _ in range(4))
        real_read = endpoint.SocketChannel.read

        def read_held_until_released(channel):
            data = real_read(channel)
            if not data:
                read_ended.set()
            elif holding.is_set():
                holds_answer.set()
                release.wait(WAIT_SECONDS)
            return data

        with mock.patch.object(endpoint.SocketChannel, "read", read_held_until_released):
            made.connect_if_running()
            holding.set()
            self.send(made, tool_call(7))
            self.assertTrue(holds_answer.wait(WAIT_SECONDS))
            app.stop()
            with mock.patch.object(endpoint.SocketChannel, "write", side_effect=OSError("broken pipe")):
                self.send(made, {"jsonrpc": "2.0", "id": 8, "method": "ping"})
            release.set()
            self.assertTrue(read_ended.wait(WAIT_SECONDS))

        self.assertEqual([self.next_message(), self.next_message()],
                         [{"jsonrpc": "2.0", "id": 8, "result": {}},
                          {"jsonrpc": "2.0", "id": 7,
                           "result": {"content": [{"type": "text", "text": ROUND_APP_GONE}], "isError": True}}])
        self.assertTrue(self.output.empty())


class ToolsChangedTests(RelayTestCase):
    def test_the_host_hears_the_tool_list_changed_when_the_app_goes_and_comes_back(self):
        app = self.start_app()
        self.write_endpoint()
        made = self.make_relay()
        made.connect_if_running()
        self.send(made, INITIALIZE)
        self.next_output()
        self.send(made, INITIALIZED)

        app.stop()
        wait_until(lambda: not made.connected)

        self.assertEqual(self.next_message(), TOOLS_CHANGED)

        (self.dir / "s.sock").unlink()
        self.start_app()
        made.connect_if_running()

        self.assertEqual(self.next_message(), TOOLS_CHANGED)

    def test_a_failed_write_and_the_read_ending_on_one_drop_send_one_notice(self):
        self.start_app()
        self.write_endpoint()
        made = self.make_relay()
        made.connect_if_running()
        self.send(made, INITIALIZE)
        self.next_output()
        self.send(made, INITIALIZED)

        with mock.patch.object(endpoint.SocketChannel, "write", side_effect=OSError("broken pipe")):
            self.send(made, {"jsonrpc": "2.0", "id": 4, "method": "ping"})
        time.sleep(0.2)

        self.assertEqual([self.next_message(), self.next_message()],
                         [{"jsonrpc": "2.0", "id": 4, "result": {}}, TOOLS_CHANGED])
        self.assertTrue(self.output.empty())

    def test_a_host_that_has_not_initialized_hears_no_tool_list_change(self):
        app = self.start_app()
        self.write_endpoint()
        made = self.make_relay()
        made.connect_if_running()

        app.drop()
        wait_until(lambda: not made.connected)
        time.sleep(0.2)

        self.assertTrue(self.output.empty())


class FailingCallWrites:
    """A channel whose tools/call write raises OSError while `failing` is set, once, as an app that just left does."""

    def __init__(self, channel, failing: threading.Event):
        self._channel = channel
        self._failing = failing

    def hello_done(self) -> None:
        self._channel.hello_done()

    def read(self) -> bytes:
        return self._channel.read()

    def write(self, data: bytes) -> None:
        if self._failing.is_set() and b"tools/call" in data:
            self._failing.clear()
            raise OSError("the app left under the write")
        self._channel.write(data)

    def close(self) -> None:
        self._channel.close()


class HeldCallTests(RelayTestCase):
    REPLAYED_HANDSHAKE = [{**INITIALIZE, "id": relay.REPLAY_ID}, INITIALIZED]

    def setUp(self):
        super().setUp()
        self.notices = queue.Queue()

    def receive_host_line(self, data: bytes) -> None:
        """Sets each tool-list notice aside, so a test here reads the answers alone."""
        (self.notices if json.loads(data) == TOOLS_CHANGED else self.output).put(data)

    def connect_after_handshake(self, **relay_options) -> tuple[FakeApp, relay.Relay]:
        """A relay that shook hands with the host and an app that holds every call."""
        app = self.start_app(hold_calls=True)
        self.write_endpoint()
        made = self.make_relay(**relay_options)
        made.connect_if_running()
        self.send(made, INITIALIZE)
        app.next_received()
        self.next_output()
        self.send(made, INITIALIZED)
        app.next_received()
        return app, made

    def hold(self, made: relay.Relay, app: FakeApp, message) -> None:
        self.send(made, message)
        app.next_received()

    def end_app(self, made: relay.Relay, app: FakeApp) -> None:
        app.stop()
        wait_until(lambda: not made.connected)

    def bring_app_back(self, **options) -> FakeApp:
        os.unlink(self.channel)
        return self.start_app(**options)

    def fail_call_writes_when_set(self) -> threading.Event:
        failing = threading.Event()
        real_open_channel = endpoint.open_channel
        patcher = mock.patch.object(endpoint, "open_channel",
                                    lambda path: FailingCallWrites(real_open_channel(path), failing))
        patcher.start()
        self.addCleanup(patcher.stop)
        return failing

    def test_a_waiting_call_is_sent_again_to_the_app_that_comes_back(self):
        app, made = self.connect_after_handshake(reconnect_wait=2.0)
        raw_line = compact(tool_call(7)).rstrip(b"\n")
        made.handle_line(raw_line)
        app.next_received()

        self.end_app(made, app)
        second = self.bring_app_back()

        self.assertEqual(second.hellos.get(timeout=WAIT_SECONDS), HELLO)
        self.assertEqual([second.next_received() for _ in range(3)], [*self.REPLAYED_HANDSHAKE, tool_call(7)])
        self.assertEqual([second.next_received_raw() for _ in range(3)][2], raw_line)
        self.assertEqual(self.next_message(), {"jsonrpc": "2.0", "id": 7, "result": FakeApp.ANSWERS["tools/call"]})
        self.assertEqual(self.spawned, [])

    def test_a_restart_under_a_waiting_call_sends_one_notice_for_the_drop_and_one_for_the_open(self):
        app, made = self.connect_after_handshake(reconnect_wait=2.0)
        self.hold(made, app, tool_call(7))

        self.end_app(made, app)
        self.bring_app_back()

        self.next_message()
        self.assertEqual(self.notices.qsize(), 2)

    def test_a_failed_call_write_and_the_read_ending_on_one_drop_send_one_notice(self):
        failing = self.fail_call_writes_when_set()
        app, made = self.connect_after_handshake(reconnect_wait=2.0)
        failing.set()

        self.send(made, tool_call(7))

        self.assertEqual([app.next_received() for _ in range(3)], [*self.REPLAYED_HANDSHAKE, tool_call(7)])
        self.assertEqual(self.notices.qsize(), 2)

    def test_an_app_that_stays_gone_is_started_after_the_poll(self):
        starts = []

        def start_second_app():
            starts.append(self.bring_app_back())
            return start_app.StartResult(True, "The wigley-ai-gui app is ready.")

        app, made = self.connect_after_handshake(start=start_second_app, reconnect_wait=0.1)
        self.hold(made, app, tool_call(7))

        app.stop()

        self.assertEqual(self.next_message(), {"jsonrpc": "2.0", "id": 7, "result": FakeApp.ANSWERS["tools/call"]})
        self.assertEqual(len(starts), 1)

    def test_a_second_call_while_one_waits_is_held_and_sent_after_it(self):
        app, made = self.connect_after_handshake(reconnect_wait=2.0)
        self.hold(made, app, tool_call(7))
        self.end_app(made, app)

        self.send(made, named_tool_call(8, "open_primer"))
        second = self.bring_app_back()

        self.assertEqual([second.next_received() for _ in range(4)],
                         [*self.REPLAYED_HANDSHAKE, tool_call(7), named_tool_call(8, "open_primer")])
        self.assertEqual(self.spawned, [])

    def test_a_call_cancelled_while_it_waits_is_not_sent_again(self):
        app, made = self.connect_after_handshake(reconnect_wait=2.0)
        self.hold(made, app, tool_call(3))
        self.end_app(made, app)

        # The second call first: with no call left waiting, the reconnect ends at its next check.
        self.send(made, tool_call(4))
        self.send(made, {"jsonrpc": "2.0", "method": "notifications/cancelled", "params": {"requestId": 3}})
        second = self.bring_app_back()

        self.assertEqual([second.next_received() for _ in range(3)], [*self.REPLAYED_HANDSHAKE, tool_call(4)])
        self.assertEqual(self.next_message(), {"jsonrpc": "2.0", "id": 4, "result": FakeApp.ANSWERS["tools/call"]})
        self.assertTrue(self.output.empty(), "a message for the cancelled call reached the host")

    def test_a_reconnect_whose_only_call_is_cancelled_starts_no_app(self):
        app, made = self.connect_after_handshake(reconnect_wait=0.3)
        self.hold(made, app, tool_call(3))
        self.end_app(made, app)

        self.send(made, {"jsonrpc": "2.0", "method": "notifications/cancelled", "params": {"requestId": 3}})
        time.sleep(0.6)

        self.assertEqual(self.spawned, [])
        self.assertTrue(self.output.empty(), "the relay answered a call the host cancelled")

    def test_tools_list_while_a_call_waits_is_answered_by_the_relay(self):
        app, made = self.connect_after_handshake(reconnect_wait=2.0)
        self.hold(made, app, tool_call(7))
        self.end_app(made, app)

        self.send(made, {"jsonrpc": "2.0", "id": 5, "method": "tools/list"})

        self.assertEqual(self.next_message(), {"jsonrpc": "2.0", "id": 5, "result": relay.BUILT_IN_TOOLS})
        self.assertEqual(self.spawned, [])

    def test_a_call_soon_after_a_drop_that_left_none_waiting_is_sent_to_the_app_that_comes_back(self):
        app, made = self.connect_after_handshake(reconnect_wait=2.0)
        self.end_app(made, app)

        self.send(made, tool_call(7))
        second = self.bring_app_back()

        self.assertEqual([second.next_received() for _ in range(3)], [*self.REPLAYED_HANDSHAKE, tool_call(7)])
        self.assertEqual(self.next_message(), {"jsonrpc": "2.0", "id": 7, "result": FakeApp.ANSWERS["tools/call"]})
        self.assertEqual(self.spawned, [])

    def test_a_call_soon_after_a_drop_that_left_none_waiting_starts_the_app_only_past_the_wait(self):
        starts = []

        def start_second_app():
            starts.append(self.bring_app_back())
            return start_app.StartResult(True, "The wigley-ai-gui app is ready.")

        app, made = self.connect_after_handshake(start=start_second_app, reconnect_wait=0.3)
        self.end_app(made, app)

        self.send(made, tool_call(7))

        self.assertEqual(starts, [], "the call started the app inside the wait")
        self.assertEqual(self.next_message(), {"jsonrpc": "2.0", "id": 7, "result": FakeApp.ANSWERS["tools/call"]})
        self.assertEqual(len(starts), 1)

    def test_a_call_that_finds_the_channel_gone_after_connecting_is_held_and_sent_again(self):
        app = self.start_app(hold_calls=True)
        self.write_endpoint()
        made = self.make_relay(reconnect_wait=2.0)
        real_connect = made._connect

        def connect_then_lose_the_app(launch):
            connected = real_connect(launch)
            self.end_app(made, app)
            return connected

        with mock.patch.object(made, "_connect", connect_then_lose_the_app):
            self.send(made, tool_call(7))
        self.bring_app_back()

        self.assertEqual(self.next_message(), {"jsonrpc": "2.0", "id": 7, "result": FakeApp.ANSWERS["tools/call"]})
        self.assertEqual(self.spawned, [])

    def test_a_refused_hello_after_the_drop_answers_with_the_refusal(self):
        # A wait past next_message's own, so only the refusal's stop can answer in time.
        app, made = self.connect_after_handshake(reconnect_wait=WAIT_SECONDS * 2)
        self.hold(made, app, tool_call(7))
        self.end_app(made, app)

        self.bring_app_back(hello_reply={"ok": False, "error": "relay protocol 1, app protocol 2"})

        message = self.next_message()
        self.assertEqual(message["id"], 7)
        self.assertTrue(message["result"]["isError"])
        text = message["result"]["content"][0]["text"]
        self.assertIn("relay protocol 1, app protocol 2", text)
        self.assertIn("Send the round again with ask_round", text)
        self.assertEqual(self.spawned, [])

    def test_a_call_whose_write_fails_is_held_and_sent_again(self):
        failing = self.fail_call_writes_when_set()
        app = self.start_app()
        self.write_endpoint()
        made = self.make_relay(reconnect_wait=2.0)
        made.connect_if_running()
        failing.set()

        self.send(made, tool_call(7))

        self.assertEqual(self.next_message(), {"jsonrpc": "2.0", "id": 7, "result": FakeApp.ANSWERS["tools/call"]})
        self.assertEqual(app.next_received(), tool_call(7))
        self.assertEqual(self.spawned, [])

    def test_a_send_again_whose_write_fails_goes_on_to_the_next_channel(self):
        failing = self.fail_call_writes_when_set()
        app, made = self.connect_after_handshake(reconnect_wait=2.0)
        self.hold(made, app, tool_call(7))
        self.end_app(made, app)
        failing.set()

        second = self.bring_app_back()

        self.assertEqual(self.next_message(), {"jsonrpc": "2.0", "id": 7, "result": FakeApp.ANSWERS["tools/call"]})
        self.assertEqual(list(second.received.queue).count(tool_call(7)), 1)
        self.assertEqual(self.spawned, [])

    def test_a_close_during_the_start_closes_the_channel_the_start_brings_up(self):
        started = []

        def close_then_start_second_app():
            made.close()
            started.append(self.bring_app_back())
            return start_app.StartResult(True, "The wigley-ai-gui app is ready.")

        app, made = self.connect_after_handshake(start=close_then_start_second_app, reconnect_wait=0.1)
        self.hold(made, app, tool_call(7))

        app.stop()
        wait_until(lambda: started)

        started[0].ended_connections.get(timeout=WAIT_SECONDS)
        self.assertFalse(made.connected)
        self.assertTrue(self.output.empty(), "the relay answered a call after close")
        self.assertEqual(self.notices.qsize(), 1, "the channel opened after close sent a notice")


class RefusedTests(RelayTestCase):
    def test_a_refused_hello_turns_a_call_into_a_tool_error_naming_both_versions(self):
        self.start_app(hello_reply={"ok": False, "error": "relay protocol 1, app protocol 2"})
        self.write_endpoint()
        made = self.make_relay()

        self.send(made, tool_call(1))

        result = self.next_message()["result"]
        self.assertTrue(result["isError"])
        self.assertIn("relay protocol 1, app protocol 2", result["content"][0]["text"])
        self.assertEqual(self.spawned, [])

    def test_a_start_refusal_is_named_and_does_not_tell_the_agent_to_update(self):
        self.start_app(hello_reply={"ok": False, "error": "the app could not start the session: boom"})
        self.write_endpoint()
        made = self.make_relay()

        self.send(made, tool_call(1))

        text = self.next_message()["result"]["content"][0]["text"]
        self.assertIn("the app could not start the session: boom", text)
        self.assertIn("send the round again", text.lower())
        self.assertIn("When the reason is a protocol mismatch", text)

    def test_a_refused_primer_call_names_open_primer(self):
        self.start_app(hello_reply={"ok": False, "error": "relay protocol 1, app protocol 2"})
        self.write_endpoint()
        made = self.make_relay()

        self.send(made, named_tool_call(1, "collect_last_primer"))

        result = self.next_message()["result"]
        self.assertTrue(result["isError"])
        self.assertIn("Send the primer again with open_primer", result["content"][0]["text"])

    def test_a_refused_audio_picker_call_names_open_audio_picker(self):
        self.start_app(hello_reply={"ok": False, "error": "relay protocol 1, app protocol 2"})
        self.write_endpoint()
        made = self.make_relay()

        self.send(made, named_tool_call(1, "collect_last_audio_picker"))

        result = self.next_message()["result"]
        self.assertTrue(result["isError"])
        self.assertIn("Send the audio picker again with open_audio_picker", result["content"][0]["text"])


def with_text_parsed(result):
    """`result` with its first block's text read as JSON when it is JSON, so an assertion skips key order and
    spacing."""
    block = result["content"][0]
    try:
        text = json.loads(block["text"])
    except ValueError:
        return result
    return {**result, "content": [{**block, "text": text}, *result["content"][1:]]}


class UnreachableAppAnswerTests(RelayTestCase):
    def answer_with_failed_start(self, tool):
        made = self.make_relay(start=lambda: start_app.StartResult(False, "boom"))
        self.send(made, named_tool_call(1, tool))
        return self.next_message()

    def answer_with_refused_hello(self, tool):
        self.start_app(hello_reply={"ok": False, "error": "boom"})
        self.write_endpoint()
        self.send(self.make_relay(), named_tool_call(1, tool))
        return self.next_message()

    def answer_with_app_gone(self, tool):
        app = self.start_app(hold_calls=True)
        self.write_endpoint()
        made = self.make_relay(start=lambda: start_app.StartResult(False, "boom"), reconnect_wait=0.1)
        made.connect_if_running()
        self.send(made, named_tool_call(1, tool))
        app.next_received()
        app.stop()
        return self.next_message()

    def answer_with_hello_refused_after_the_drop(self, tool):
        app = self.start_app(hold_calls=True)
        self.write_endpoint()
        made = self.make_relay(reconnect_wait=WAIT_SECONDS * 2)
        made.connect_if_running()
        self.send(made, named_tool_call(1, tool))
        app.next_received()
        app.stop()
        wait_until(lambda: not made.connected)
        os.unlink(self.channel)
        self.start_app(hello_reply={"ok": False, "error": "boom"})
        return self.next_message()

    def test_a_permission_call_gets_a_deny_a_form_call_its_own_answer_and_any_other_tool_the_neutral_words(self):
        rows = [
            (self.answer_with_failed_start, "The wigley-ai-gui app could not be started: boom",
             {"content": [{"type": "text", "text": ROUND_NOT_STARTED}], "structuredContent": ROUND_NOT_STARTED},
             {"content": [{"type": "text", "text": NO_FORM_NOT_STARTED}], "structuredContent": NO_FORM_NOT_STARTED}),
            (self.answer_with_refused_hello, "The wigley-ai-gui app refused this relay: boom",
             {"content": [{"type": "text", "text": ROUND_REFUSED}], "isError": True},
             {"content": [{"type": "text", "text": NO_FORM_REFUSED}], "isError": True}),
            (self.answer_with_app_gone, "The wigley-ai-gui app closed while this call waited",
             {"content": [{"type": "text", "text": ROUND_APP_GONE}], "isError": True},
             {"content": [{"type": "text", "text": NO_FORM_APP_GONE}], "isError": True}),
            (self.answer_with_hello_refused_after_the_drop, "The wigley-ai-gui app refused this relay: boom",
             {"content": [{"type": "text", "text": ROUND_REFUSED}], "isError": True},
             {"content": [{"type": "text", "text": NO_FORM_REFUSED}], "isError": True}),
        ]
        for answer, why, form_result, no_form_result in rows:
            denied = {"behavior": "deny", "message": f"{why}. The user was not asked, so this tool call did not run."}
            cases = [("permission_prompt", {"content": [{"type": "text", "text": denied}]}), ("ask_round", form_result),
                     (NO_FORM_TOOL, no_form_result)]
            for tool, expected in cases:
                with self.subTest(path=answer.__name__, tool=tool):
                    self.setUp()
                    self.assertEqual(with_text_parsed(answer(tool)["result"]), expected)

    def test_each_form_tool_and_a_call_naming_no_tool_keep_their_form_words(self):
        rows = [("ask_round", ROUND_NOT_STARTED), ("collect_last_round", ROUND_NOT_STARTED), (None, ROUND_NOT_STARTED),
                ("open_primer", PRIMER_NOT_STARTED), ("collect_last_primer", PRIMER_NOT_STARTED),
                ("open_audio_picker", AUDIO_PICKER_NOT_STARTED),
                ("collect_last_audio_picker", AUDIO_PICKER_NOT_STARTED)]
        for tool, expected in rows:
            with self.subTest(tool=tool):
                self.assertEqual(relay.not_started("boom", tool), expected)


OFFLINE_DENIED = {"behavior": "deny",
                  "message": "The app is closed. The user was not asked, so this tool call did not run."}
TITLE_RESULT = {"content": [{"type": "text", "text": "Title recorded."}], "structuredContent": {"title": "kept"}}
ROUND_RESULT = {"content": [{"type": "text", "text": "Take each recommended pick."}]}


def left_out(tool):
    return {"content": [{"type": "text", "text": f"The app is closed: {tool} did not run."}], "isError": True}


def call_with(request_id, name, arguments, meta=None):
    params = {"name": name, "arguments": arguments}
    if meta is not None:
        params["_meta"] = meta
    return {"jsonrpc": "2.0", "id": request_id, "method": "tools/call", "params": params}


class OfflineTests(RelayTestCase):
    def setUp(self):
        super().setUp()
        self.calls = self.dir / "offline-calls"
        self.starts = []

    def record_start(self):
        self.starts.append(True)
        return start_app.StartResult(False, "a start ran")

    def make_offline_relay(self, **options) -> relay.Relay:
        return self.make_relay(start=self.record_start, offline_calls=self.calls, **options)

    def write_table(self, table) -> None:
        text = table if isinstance(table, str) else json.dumps(table)
        (self.dir / relay.OFFLINE_TABLE).write_text(text, encoding="utf-8")

    def logged_calls(self):
        path = self.calls / "session-1.jsonl"
        return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]

    def test_a_call_with_no_app_gets_the_tables_answer_and_a_calls_line_without_a_start(self):
        self.write_table({"tools": {"set_session_title": {"result": TITLE_RESULT, "replay": True},
                                    "ask_round": {"result": ROUND_RESULT, "replay": False}}})
        made = self.make_offline_relay()
        rows = [
            (lambda n: call_with(n, "set_session_title", {"title": f"t{n}"}, {"claudecode/toolUseId": "toolu_1"}),
             lambda n: TITLE_RESULT,
             lambda n: {"tool": "set_session_title", "arguments": {"title": f"t{n}"}, "toolUseId": "toolu_1",
                        "replay": True}),
            (lambda n: call_with(n, "ask_round", {"heading": f"h{n}"}),
             lambda n: ROUND_RESULT,
             lambda n: {"tool": "ask_round", "arguments": {"heading": f"h{n}"}, "toolUseId": None, "replay": False}),
            (lambda n: call_with(n, NO_FORM_TOOL, {"n": n}),
             lambda n: left_out(NO_FORM_TOOL),
             lambda n: {"tool": NO_FORM_TOOL, "arguments": {"n": n}, "toolUseId": None, "replay": False}),
            (lambda n: call_with(n, "permission_prompt", {"tool_name": f"Bash{n}"}),
             lambda n: {"content": [{"type": "text", "text": OFFLINE_DENIED}]},
             lambda n: {"tool": "permission_prompt", "arguments": {"tool_name": f"Bash{n}"}, "toolUseId": None,
                        "replay": False}),
            (lambda n: call_with(n, "ask_round", "x"),
             lambda n: ROUND_RESULT,
             lambda n: {"tool": "ask_round", "arguments": {}, "toolUseId": None, "replay": False}),
            (lambda n: call_with(n, "ask_round", {}, {"claudecode/toolUseId": 5}),
             lambda n: ROUND_RESULT,
             lambda n: {"tool": "ask_round", "arguments": {}, "toolUseId": None, "replay": False}),
        ]
        expected_lines, windows = [], []
        request_id = 0
        for message, result, line in rows:
            for _ in range(2):
                request_id += 1
                before = int(time.time() * 1000)
                self.send(made, message(request_id))
                answer = self.next_message()
                windows.append((before, int(time.time() * 1000)))
                self.assertEqual(with_text_parsed(answer["result"]), result(request_id))
                self.assertEqual(answer["id"], request_id)
                expected_lines.append(line(request_id))

        logged = self.logged_calls()
        for (before, after), entry in zip(windows, logged):
            self.assertTrue(before <= entry.pop("at") <= after)
        self.assertEqual(logged, expected_lines)
        self.assertEqual(self.starts, [])

    def test_a_call_the_relay_cannot_log_still_gets_its_answer(self):
        def without_session_id():
            return self.make_offline_relay(hello={**HELLO, "session_id": None})

        def calls_folder_is_a_file():
            self.calls.write_text("", encoding="utf-8")
            return self.make_offline_relay()

        rows = [(without_session_id, "no session id"), (calls_folder_is_a_file, str(self.calls.name))]
        for make, logged in rows:
            with self.subTest(case=make.__name__):
                self.setUp()
                made = make()
                with mock.patch.object(relay, "_log") as log:
                    self.send(made, named_tool_call(1, NO_FORM_TOOL))
                    self.assertEqual(self.next_message()["result"], left_out(NO_FORM_TOOL))
                log.assert_called_once()
                self.assertIn(logged, log.call_args.args[0])
                self.assertFalse(self.calls.is_dir())
                self.assertEqual(self.starts, [])

    def test_a_call_inside_the_hold_after_a_drop_waits_for_the_app(self):
        app = self.start_app()
        self.write_endpoint()
        made = self.make_offline_relay(reconnect_wait=1.0)
        made.connect_if_running()
        self.send(made, tool_call(1))
        self.assertEqual(self.next_message()["id"], 1)
        app.stop()
        wait_until(lambda: not made.connected)

        self.send(made, tool_call(2))
        self.assertTrue(self.output.empty(), "the call was answered inside the hold")
        os.unlink(self.channel)
        second = self.start_app()
        self.write_endpoint()

        self.assertEqual(self.next_message(), {"jsonrpc": "2.0", "id": 2, "result": FakeApp.ANSWERS["tools/call"]})
        self.assertEqual(second.next_received(), tool_call(2))
        self.assertFalse(self.calls.exists())
        self.assertEqual(self.starts, [])

    def test_an_unreadable_table_answers_every_call_as_left_out(self):
        rows = [None, "not json", "[]", {"tools": []},
                {"tools": {"ask_round": {"result": {"structuredContent": {}}, "replay": False}}},
                {"tools": {"ask_round": {"result": ROUND_RESULT, "replay": "yes"}}}]
        for table in rows:
            with self.subTest(table=table):
                self.setUp()
                if table is not None:
                    self.write_table(table)
                made = self.make_offline_relay()

                self.send(made, tool_call(1))

                self.assertEqual(self.next_message()["result"], left_out("ask_round"))
                self.assertEqual([line["replay"] for line in self.logged_calls()], [False])
                self.assertEqual(self.starts, [])

    def test_a_call_waiting_when_the_app_goes_gets_the_tables_answer_after_the_wait(self):
        self.write_table({"tools": {"ask_round": {"result": ROUND_RESULT, "replay": False}}})
        app = self.start_app(hold_calls=True)
        self.write_endpoint()
        made = self.make_offline_relay(reconnect_wait=0.1)
        made.connect_if_running()
        self.send(made, call_with(7, "ask_round", {"heading": "h"}, {"claudecode/toolUseId": "toolu_7"}))
        app.next_received()

        app.stop()

        self.assertEqual(self.next_message(), {"jsonrpc": "2.0", "id": 7, "result": ROUND_RESULT})
        logged = self.logged_calls()
        for entry in logged:
            entry.pop("at")
        self.assertEqual(logged, [{"tool": "ask_round", "arguments": {"heading": "h"}, "toolUseId": "toolu_7",
                                   "replay": False}])
        self.assertEqual(self.starts, [])

    def test_a_call_naming_no_tool_gets_the_no_tool_error_and_no_line_or_start(self):
        self.write_table({"tools": {"ask_round": {"result": ROUND_RESULT, "replay": False}}})
        made = self.make_offline_relay()

        self.send(made, {"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {"arguments": {}}})

        self.assertEqual(self.next_message(),
                         {"jsonrpc": "2.0", "id": 3,
                          "result": {"content": [{"type": "text", "text": relay.OFFLINE_NO_TOOL}], "isError": True}})
        self.assertFalse((self.calls / "session-1.jsonl").exists())
        self.assertEqual(self.starts, [])

    def test_a_call_naming_no_tool_waiting_when_the_app_goes_gets_the_no_tool_error(self):
        self.write_table({"tools": {"ask_round": {"result": ROUND_RESULT, "replay": False}}})
        app = self.start_app(hold_calls=True)
        self.write_endpoint()
        made = self.make_offline_relay(reconnect_wait=0.1)
        made.connect_if_running()
        self.send(made, {"jsonrpc": "2.0", "id": 8, "method": "tools/call", "params": {"arguments": {}}})
        app.next_received()

        app.stop()

        self.assertEqual(self.next_message(),
                         {"jsonrpc": "2.0", "id": 8,
                          "result": {"content": [{"type": "text", "text": relay.OFFLINE_NO_TOOL}], "isError": True}})
        self.assertFalse((self.calls / "session-1.jsonl").exists())
        self.assertEqual(self.starts, [])

    def test_a_call_with_the_app_reachable_is_forwarded_and_writes_no_line(self):
        self.write_table({"tools": {"ask_round": {"result": ROUND_RESULT, "replay": False}}})
        app = self.start_app()
        self.write_endpoint()
        made = self.make_offline_relay()

        self.send(made, tool_call(1))

        self.assertEqual(self.next_message(), {"jsonrpc": "2.0", "id": 1, "result": FakeApp.ANSWERS["tools/call"]})
        self.assertEqual(app.next_received(), tool_call(1))
        self.assertFalse(self.calls.exists())
        self.assertEqual(self.starts, [])

    def test_a_call_after_offline_answers_reaches_the_app_that_opened(self):
        made = self.make_offline_relay()
        self.send(made, INITIALIZE)
        self.next_output()
        self.send(made, INITIALIZED)
        self.send(made, tool_call(1))
        self.assertEqual(self.next_message()["result"], left_out("ask_round"))

        app = self.start_app()
        self.write_endpoint()
        self.send(made, tool_call(2))

        self.assertEqual([app.next_received() for _ in range(3)], [*HeldCallTests.REPLAYED_HANDSHAKE, tool_call(2)])
        self.assertEqual(self.next_message(), TOOLS_CHANGED)
        self.assertEqual(self.next_message(), {"jsonrpc": "2.0", "id": 2, "result": FakeApp.ANSWERS["tools/call"]})
        self.assertEqual(len(self.logged_calls()), 1)
        self.assertEqual(self.starts, [])

    def test_a_refused_hello_in_offline_mode_keeps_the_refusal(self):
        self.start_app(hello_reply={"ok": False, "error": "boom"})
        self.write_endpoint()
        made = self.make_offline_relay()

        self.send(made, tool_call(1))

        self.assertEqual(self.next_message()["result"],
                         {"content": [{"type": "text", "text": ROUND_REFUSED}], "isError": True})
        self.assertFalse(self.calls.exists())
        self.assertEqual(self.starts, [])

    def test_offline_calls_dir_reads_the_env(self):
        rows = [({}, None), ({relay.OFFLINE_ENV: ""}, None),
                ({relay.OFFLINE_ENV: "/x/offline-calls"}, Path("/x/offline-calls"))]
        for env, expected in rows:
            with self.subTest(env=env):
                self.assertEqual(relay.offline_calls_dir(env), expected)


if __name__ == "__main__":
    unittest.main()
