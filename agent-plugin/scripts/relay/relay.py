"""The `auri` MCP server each session's host starts: a relay to the wigley-ai-gui app.

It forwards every MCP message, unchanged, between the host (one JSON-RPC message per line on stdin and stdout)
and the app's local channel (a Unix socket on macOS, a named pipe on Windows), which the app names in the endpoint
file it writes on every start, and adds only its own `notifications/tools/list_changed` when that channel drops or
opens. In offline mode (`WIGLEY_FORMS_OFFLINE`, for runs the app's session host fires) it never starts the app, and
answers a call the app cannot take from the app's `offline.json`, logging it for the app to replay. It holds no forms
logic, with the one exception README.md § Boundary rules names; README.md § The relay is its spec. The endpoint lookup
and the channel live in `endpoint.py`. Standard library only.
"""

from __future__ import annotations

import json
import os
import sys
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Callable, NamedTuple

import endpoint
import start_app

SERVER_INFO = {"name": "auri", "version": "1.0.0"}
DEFAULT_PROTOCOL_VERSION = "2025-06-18"
RECONNECT_WAIT_SECONDS = 30.0
RECONNECT_POLL_SECONDS = 0.5
# The relay's own id for a replayed initialize, so the app's answer to it never reaches the host.
REPLAY_ID = "wigley-relay-replayed-initialize"

# The name in a tools/call and in the app's tool list; the mcp__ prefix exists only on the host's side.
PERMISSION_TOOL = "permission_prompt"
APP_CLOSED = "The wigley-ai-gui app closed while this call waited"
APP_GONE = APP_CLOSED + "; send the {noun} again with {open_tool} — it opens pre-filled."
NO_FORM_APP_GONE = APP_CLOSED + "; call {tool} again once the app is back, or tell the user {tool} failed."
REFUSED = "The wigley-ai-gui app refused this relay: {reason}"
REFUSED_NEXT = "Send the {noun} again with {open_tool}: the relay says hello again on each call."
NO_FORM_REFUSED_NEXT = "Call {tool} again: the relay says hello again on each call."
NOT_STARTED_NEXT = ("No {noun} exists. Send the same {noun} again with {open_tool} once: the relay tries the start "
                    "again. If needs_manual_open comes back a second time, tell the user the reason in summary and "
                    "{fallback}. {collect_tool} is never the answer to this outcome.")
NO_FORM_NOT_STARTED_NEXT = ("{tool} did not run. Call {tool} again once the app is back: the relay tries the start "
                            "again on each call. If needs_manual_open comes back a second time, tell the user the "
                            "reason in summary and that {tool} did not run.")
# Offline mode: the env var naming the calls folder, the app's table in the endpoint folder, and the relay's own words.
OFFLINE_ENV = "WIGLEY_FORMS_OFFLINE"
OFFLINE_TABLE = "offline.json"
APP_IS_CLOSED = "The app is closed"
OFFLINE_LEFT_OUT = APP_IS_CLOSED + ": {tool} did not run."
OFFLINE_NO_TOOL = APP_IS_CLOSED + ": this call named no tool, so it did not run."
BUILT_IN_TOOLS = {"tools": [
    {"name": "ask_round",
     "description": ("Open a round of questions, findings and notices in the wigley-ai-gui app and wait for the "
                     "answers. The app is not running, so this is a stand-in for its full description."),
     "inputSchema": {"type": "object"}},
    {"name": "collect_last_round",
     "description": ("Re-attach to the round open in the wigley-ai-gui app, or return the last finished round's "
                     "answers again."),
     "inputSchema": {"type": "object", "properties": {"wait": {"type": "boolean"}}}},
    {"name": "open_primer",
     "description": ("Open a feature primer in the wigley-ai-gui app and wait for the user's edits. The app is not "
                     "running, so this is a stand-in for its full description."),
     "inputSchema": {"type": "object"}},
    {"name": "collect_last_primer",
     "description": ("Re-attach to the primer open in the wigley-ai-gui app, or return the last finished primer's "
                     "edits again."),
     "inputSchema": {"type": "object", "additionalProperties": False,
                     "properties": {"wait": {"type": "boolean"}}}},
    {"name": "open_audio_picker",
     "description": ("Open an audio picker in the wigley-ai-gui app and wait for the user's choices. The app is not "
                     "running, so this is a stand-in for its full description."),
     "inputSchema": {"type": "object"}},
    {"name": "collect_last_audio_picker",
     "description": ("Re-attach to the audio picker open in the wigley-ai-gui app, or return the last finished audio "
                     "picker's choices again."),
     "inputSchema": {"type": "object", "additionalProperties": False,
                     "properties": {"wait": {"type": "boolean"}}}},
]}


class _RetryWords(NamedTuple):
    """What the relay tells the caller of one tool to do next, for each way the call can miss the app."""
    not_started_next: str
    app_gone: str
    refused_next: str


def _form_words(noun: str, open_tool: str, collect_tool: str, fallback: str) -> _RetryWords:
    return _RetryWords(
        NOT_STARTED_NEXT.format(noun=noun, open_tool=open_tool, collect_tool=collect_tool, fallback=fallback),
        APP_GONE.format(noun=noun, open_tool=open_tool),
        REFUSED_NEXT.format(noun=noun, open_tool=open_tool))


def _no_form_words(tool: str) -> _RetryWords:
    return _RetryWords(NO_FORM_NOT_STARTED_NEXT.format(tool=tool), NO_FORM_APP_GONE.format(tool=tool),
                       NO_FORM_REFUSED_NEXT.format(tool=tool))


_ROUND_WORDS = _form_words("round", "ask_round", "collect_last_round",
                           "ask the round's questions and findings in the reply")
_PRIMER_WORDS = _form_words("primer", "open_primer", "collect_last_primer",
                            "work through the primer's rows in chat")
_AUDIO_PICKER_WORDS = _form_words(
    "audio picker", "open_audio_picker", "collect_last_audio_picker",
    "name the pick and its ranked alternatives in the reply")
# None is a tools/call whose params hold no string name, so it has no tool to name.
_FORM_WORDS_BY_TOOL = {"ask_round": _ROUND_WORDS, "collect_last_round": _ROUND_WORDS, None: _ROUND_WORDS,
                       "open_primer": _PRIMER_WORDS, "collect_last_primer": _PRIMER_WORDS,
                       "open_audio_picker": _AUDIO_PICKER_WORDS, "collect_last_audio_picker": _AUDIO_PICKER_WORDS}


def _words(tool: str | None) -> _RetryWords:
    return _FORM_WORDS_BY_TOOL.get(tool) or _no_form_words(tool)


class _WaitingCall(NamedTuple):
    """A call the app has not answered: its tool's name, and the host's line as received, without the newline."""
    tool: str | None
    line: bytes


class RelayRefused(Exception):
    """The app answered the hello with ok: false; the message is its reason."""


def codex_session_id() -> str:
    """A new id for one relay process under Codex, which gives the relay no session id of its own."""
    return "codex-" + uuid.uuid4().hex


def hello_from_env(env, process_session_id: str) -> dict[str, Any]:
    """The hello line's fields, from the host's environment; each is None when unset.

    `harness` is claude under Claude Code (`CLAUDECODE=1`), else codex; it is never None. `row_id` is the app's row id
    for a session the app started (`WIGLEY_SESSION_ROW`). `session_id` is `CLAUDE_CODE_SESSION_ID`; for a Codex
    session the app did not start, `process_session_id`; else None.
    """
    harness = "claude" if env.get("CLAUDECODE") == "1" else "codex"
    row_id = env.get("WIGLEY_SESSION_ROW") or None
    is_codex_outside_the_app = harness == "codex" and row_id is None
    return {
        "protocol": endpoint.RELAY_PROTOCOL,
        "session_id": (env.get("CLAUDE_CODE_SESSION_ID")
                       or (process_session_id if is_codex_outside_the_app else None)),
        "project_dir": env.get("CLAUDE_PROJECT_DIR") or None,
        "deadline_seconds": _deadline_seconds(env.get("WIGLEY_FORMS_DEADLINE_SECONDS")),
        "harness": harness,
        "config_dir": env.get("CLAUDE_CONFIG_DIR") or None,
        "row_id": row_id,
    }


def offline_calls_dir(env) -> Path | None:
    """The calls folder `WIGLEY_FORMS_OFFLINE` names, as given (`~` is not expanded); None, offline mode off, when it
    is unset or empty."""
    value = env.get(OFFLINE_ENV)
    return Path(value) if value else None


def _deadline_seconds(value: str | None) -> int | None:
    if not value:
        return None
    try:
        return int(value)
    except ValueError:
        _log(f"WIGLEY_FORMS_DEADLINE_SECONDS is not a whole number of seconds: {value!r}")
        return None


def not_started(reason: str, tool: str | None) -> dict[str, Any]:
    """The needs_manual_open payload for a call to `tool`: the relay could not start the app, so the call did not
    run. Only a round's payload carries the empty answer lists: a primer's carries no feature or entries, and a tool
    that opens no form has neither."""
    words = _words(tool)
    payload = {
        "outcome": "needs_manual_open",
        "summary": f"The wigley-ai-gui app could not be started: {reason}",
        "next": words.not_started_next,
    }
    if words is not _ROUND_WORDS:
        return payload
    return {**payload, "answers": [], "findings": [], "notices": []}


def _refused_text(reason: str, tool: str | None) -> str:
    """The tool error's text for a call to `tool` when the app refused the hello with `reason`."""
    return (f"{REFUSED.format(reason=reason)}. {_words(tool).refused_next} If the refusal comes back, tell the "
            "user the app's reason. When the reason is a protocol mismatch, the user updates the app, which "
            "carries the auri plugin, so both speak one relay protocol.")


def _tool_name(message: dict[str, Any]) -> str | None:
    """The name of the tool a tools/call names, or None when its params hold no string name."""
    params = message.get("params")
    name = params.get("name") if isinstance(params, dict) else None
    return name if isinstance(name, str) else None


def write_stdout(data: bytes) -> None:
    sys.stdout.buffer.write(data)
    sys.stdout.buffer.flush()


class Relay:
    """One host's link to the app: forwards while connected, answers for the app while it is away, holds a call that
    waits on the app, or arrives within `reconnect_wait` of the last drop, across a restart, and tells the host when
    the tool list changes. With `offline_calls`, offline mode: it never starts the app, and answers a call no app took
    from the app's offline table, logging it in that folder."""

    def __init__(self, endpoint_dir: Path, hello: dict[str, Any], write_host: Callable[[bytes], None],
                 start: Callable[[], start_app.StartResult] | None = None,
                 reconnect_wait: float = RECONNECT_WAIT_SECONDS, reconnect_poll: float = RECONNECT_POLL_SECONDS,
                 offline_calls: Path | None = None):
        self._endpoint_dir = endpoint_dir
        self._offline_calls = offline_calls
        # Held across each calls-file append, which the main thread and the reconnect thread can both make.
        self._calls_lock = threading.Lock()
        self._hello = hello
        self._write_host = write_host
        self._start = start or (lambda: start_app.start_app(endpoint_dir))
        self._reconnect_wait = reconnect_wait
        self._reconnect_poll = reconnect_poll
        self._lock = threading.Lock()
        self._host_lock = threading.Lock()
        self._closed = threading.Event()
        self._channel = None
        # Each waiting call by request id, in the order they are sent again.
        self._pending: dict[Any, _WaitingCall] = {}
        # Each forwarded request other than a call the app has not answered, by id; a drop answers these. Guarded by
        # _lock.
        self._waiting_requests: dict[Any, dict[str, Any]] = {}
        # True from the moment a call is held with no channel until the held calls are sent again or answered. Guarded
        # by _lock.
        self._reconnecting = False
        # The time.monotonic() of the last channel drop. Guarded by _lock.
        self._last_drop = float("-inf")
        self._initialize: dict[str, Any] | None = None
        self._initialized: dict[str, Any] | None = None
        self._refusal: str | None = None
        self._start_failure: str | None = None

    @property
    def connected(self) -> bool:
        return self._channel is not None

    def connect_if_running(self) -> bool:
        """Connects when the app is already listening; never starts it."""
        return self._connect(launch=False)

    def handle_line(self, line: bytes) -> None:
        """Takes one line the host sent: forwards it to the app, or answers it when no app took it."""
        try:
            message = json.loads(line)
        except ValueError as exc:
            _log(f"malformed JSON-RPC line from the host: {exc}")
            return
        if not isinstance(message, dict):
            _log("a JSON-RPC message from the host was not an object")
            return
        self._remember(message)
        if message.get("method") == "tools/call":
            with self._lock:
                is_held = self._reconnecting or time.monotonic() < self._reconnect_deadline()
                needs_the_app = self._channel is None and not is_held
            if needs_the_app and not self._connect(launch=True):
                self._answer_alone(message)
                return
        if not self._forward(message, line):
            self._answer_alone(message)

    def close(self) -> None:
        self._closed.set()
        with self._lock:
            self._pending.clear()
        self._close_channel()

    def _close_channel(self) -> None:
        with self._lock:
            channel, self._channel = self._channel, None
        if channel is not None:
            channel.close()

    def _remember(self, message: dict[str, Any]) -> None:
        method = message.get("method")
        if method == "initialize" and "id" in message:
            self._initialize = message
        elif method == "notifications/initialized":
            self._initialized = message
        elif method == "notifications/cancelled":
            params = message.get("params")
            request_id = params.get("requestId") if isinstance(params, dict) else None
            with self._lock:
                self._pending.pop(request_id, None)
                self._waiting_requests.pop(request_id, None)

    def _connect(self, launch: bool) -> bool:
        """Opens the app's channel; with `launch`, outside offline mode, starts the app first when nothing answers. On
        False, either `_refusal` or (after a launch) `_start_failure` holds why."""
        self._refusal = None
        self._start_failure = None
        path = endpoint.channel_path(self._endpoint_dir)
        if path is not None and self._open(path):
            return True
        may_start = launch and self._offline_calls is None
        if not may_start or self._refusal is not None:
            return False
        started = self._start()
        if not started.ready:
            self._start_failure = started.message
            return False
        path = endpoint.channel_path(self._endpoint_dir)
        if path is not None and self._open(path):
            return True
        if self._refusal is None:
            self._start_failure = "the app opened its channel but did not answer the relay's hello"
        return False

    def _open(self, path: str) -> bool:
        """Says hello on a new channel and replays the handshake; on success, reads it and tells the host the tool
        list changed."""
        try:
            channel = endpoint.open_channel(path)
        except OSError:
            return False
        try:
            early = _say_hello(channel, self._hello)
            channel.hello_done()
            self._replay(channel)
        except RelayRefused as exc:
            channel.close()
            self._refusal = str(exc)
            return False
        except (OSError, ValueError) as exc:
            channel.close()
            _log(f"the app did not take the hello: {exc}")
            return False
        with self._lock:
            self._channel = channel
        threading.Thread(target=self._read_app, args=(channel, early), daemon=True).start()
        self._tools_changed()
        return True

    def _replay(self, channel) -> None:
        """Sends the host's handshake again, so the app serves this host as if it had been there from the start."""
        if self._initialize is not None:
            channel.write(_line({**self._initialize, "id": REPLAY_ID}))
        if self._initialized is not None:
            channel.write(_line(self._initialized))

    def _forward(self, message: dict[str, Any], line: bytes) -> bool:
        """Sends the host's line to the app; False when no app took it, so the relay answers it. With no channel, or
        while a reconnect runs, nothing goes to the app: a call joins the waiting calls, starting the reconnect when
        none runs, and anything else is the relay's to answer."""
        is_request = "method" in message and "id" in message
        is_call = is_request and message["method"] == "tools/call"
        starts_reconnect = False
        with self._lock:
            if is_call:
                self._pending[message["id"]] = _WaitingCall(_tool_name(message), line)
            if self._reconnecting:
                return is_call
            channel = self._channel
            if channel is None:
                starts_reconnect = is_call
                self._reconnecting = is_call
            else:
                if is_request and not is_call:
                    self._waiting_requests[message["id"]] = message
                try:
                    channel.write(line + b"\n")
                except OSError:
                    pass
                else:
                    return True
        if starts_reconnect:
            threading.Thread(target=self._reconnect, daemon=True).start()
        elif channel is not None:
            # The app left under the write: a drop holds a call and answers any other request, and nothing else needs
            # an answer. The drop may be the reader's, which got here first.
            self._drop(channel)
            return is_request
        return is_call

    def _read_app(self, channel, buffer: bytes) -> None:
        while True:
            while b"\n" in buffer:
                line, buffer = buffer.split(b"\n", 1)
                self._from_app(channel, line)
            chunk = channel.read()
            if not chunk:
                break
            buffer += chunk
        self._drop(channel)

    def _from_app(self, channel, line: bytes) -> None:
        """Sends the host a line the app sent on `channel`, unless that channel was dropped: a call that waited on it
        is held and gets its answer later, and _drop answered any other request."""
        if not line.strip():
            return
        try:
            message = json.loads(line)
        except ValueError:
            message = None
        is_answer = isinstance(message, dict) and "method" not in message
        if is_answer and message.get("id") == REPLAY_ID:
            return
        with self._lock:
            if self._channel is not channel:
                return
            if is_answer:
                self._pending.pop(message.get("id"), None)
                self._waiting_requests.pop(message.get("id"), None)
        self._send_host(line + b"\n")

    def _drop(self, channel) -> None:
        """Forgets a channel that closed and stamps the drop, answers every request other than a call still waiting on
        it as with no app, and tells the host the tool list changed, once per channel since only the first caller finds
        it current. When that leaves calls waiting and no reconnect runs, starts the one that owns them, last, so the
        notice of the drop goes ahead of the notice of the next open."""
        with self._lock:
            if self._channel is not channel:
                return
            self._channel = None
            self._last_drop = time.monotonic()
            waiting_requests = list(self._waiting_requests.values())
            self._waiting_requests.clear()
            starts_reconnect = bool(self._pending) and not self._reconnecting
            if starts_reconnect:
                self._reconnecting = True
        channel.close()
        for request in waiting_requests:
            self._answer_alone(request)
        self._tools_changed()
        if starts_reconnect:
            threading.Thread(target=self._reconnect, daemon=True).start()

    def _reconnect(self) -> None:
        """Holds the waiting calls until an app takes them again, the relay answers them, or none is left to hold."""
        while self._reach_app():
            if self._closed.is_set():
                # A _connect inside the start when close() ran sets its channel after close() cleared it.
                self._close_channel()
                return
            if self._send_waiting_calls():
                return

    def _reach_app(self) -> bool:
        """Polls the channel until `reconnect_wait` seconds after the last drop, then starts the app once (in offline
        mode, tries the channel once more). True when connected; False when the reconnect is over, because no call
        waits or (having failed the waiting calls) no app came back."""
        with self._lock:
            deadline = self._reconnect_deadline()
        while time.monotonic() < deadline:
            self._closed.wait(self._reconnect_poll)
            if not self._calls_still_wait():
                return False
            if self._connect(launch=False):
                return True
            if self._refusal is not None:
                self._fail_waiting_calls()
                return False
        if not self._calls_still_wait():
            return False
        if self._connect(launch=True):
            return True
        self._fail_waiting_calls()
        return False

    def _reconnect_deadline(self) -> float:
        """When the wait after the last drop ends, on time.monotonic()'s clock. The caller holds _lock."""
        return self._last_drop + self._reconnect_wait

    def _calls_still_wait(self) -> bool:
        """False once close() ran, or once every waiting call was cancelled, which ends the reconnect."""
        if self._closed.is_set():
            return False
        with self._lock:
            if self._pending:
                return True
            self._reconnecting = False
            return False

    def _send_waiting_calls(self) -> bool:
        """Writes every waiting call to the new channel, which ends the reconnect; False when that channel has gone,
        so the reconnect goes on."""
        with self._lock:
            channel = self._channel
            if channel is None:
                return False
            try:
                for call in self._pending.values():
                    channel.write(call.line + b"\n")
            except OSError:
                pass
            else:
                self._reconnecting = False
                return True
        self._drop(channel)
        return False

    def _fail_waiting_calls(self) -> None:
        """Ends the reconnect with no app: answers each waiting call with the app's refusal, else in offline mode its
        offline answer, else the app-gone answer."""
        refusal = self._refusal
        with self._lock:
            waiting = list(self._pending.items())
            self._pending.clear()
            self._reconnecting = False
        for request_id, call in waiting:
            if refusal is not None:
                self._send_host(_refused_answer(request_id, refusal, call.tool))
            elif self._offline_calls is not None:
                self._answer_offline(request_id, json.loads(call.line))
            else:
                app_gone = _tool_error(request_id, _words(call.tool).app_gone)
                self._send_host(_denied_or(app_gone, request_id, call.tool, APP_CLOSED))

    def _tools_changed(self) -> None:
        """Tells a host that has initialized to fetch the tool list again; a host that has not has listed no tools yet,
        and after close() the host has gone."""
        if self._initialized is not None and not self._closed.is_set():
            self._send_host(_line({"jsonrpc": "2.0", "method": "notifications/tools/list_changed"}))

    def _answer_alone(self, message: dict[str, Any]) -> None:
        # A notification, or the host's answer to an app that has gone, needs no reply.
        if "id" not in message or "method" not in message:
            return
        request_id, method = message["id"], message["method"]
        if method == "initialize":
            params = message.get("params") if isinstance(message.get("params"), dict) else {}
            version = params.get("protocolVersion") or DEFAULT_PROTOCOL_VERSION
            self._send_host(_response(request_id, {"protocolVersion": version,
                                                   "capabilities": {"tools": {"listChanged": True}},
                                                   "serverInfo": SERVER_INFO}))
        elif method == "ping":
            self._send_host(_response(request_id, {}))
        elif method == "tools/list":
            self._send_host(_response(request_id, self._tools_list()))
        elif method == "tools/call" and self._refusal is not None:
            self._send_host(_refused_answer(request_id, self._refusal, _tool_name(message)))
        elif method == "tools/call" and self._offline_calls is not None:
            self._answer_offline(request_id, message)
        elif method == "tools/call":
            tool = _tool_name(message)
            payload = not_started(self._start_failure, tool)
            self._send_host(_denied_or(_payload_result(request_id, payload), request_id, tool, payload["summary"]))
        else:
            self._send_host(_error(request_id, -32601, f"Method not found: {method!r}"))

    def _tools_list(self) -> dict[str, Any]:
        try:
            tools = json.loads((self._endpoint_dir / "tools.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return BUILT_IN_TOOLS
        is_tool_list = isinstance(tools, dict) and isinstance(tools.get("tools"), list)
        return tools if is_tool_list else BUILT_IN_TOOLS

    def _answer_offline(self, request_id, message: dict[str, Any]) -> None:
        """Answers a tools/call no app took, in offline mode: the table's result for its tool, unchanged, else the
        did-not-run tool error; logs the call to the calls file first, so a host that exits on the answer leaves it
        there."""
        tool = _tool_name(message)
        if tool is None:
            self._send_host(_tool_error(request_id, OFFLINE_NO_TOOL))
            return
        entry = self._offline_entry(tool)
        if entry is not None:
            answer, replay = _response(request_id, entry["result"]), entry["replay"]
        else:
            left_out = _tool_error(request_id, OFFLINE_LEFT_OUT.format(tool=tool))
            answer, replay = _denied_or(left_out, request_id, tool, APP_IS_CLOSED), False
        self._log_offline_call(tool, message["params"], replay)
        self._send_host(answer)

    def _offline_entry(self, tool: str) -> dict[str, Any] | None:
        """The offline table's entry for `tool`, read from the file each time; None when the table is missing or
        unreadable, leaves the tool out, or holds a malformed entry for it."""
        try:
            table = json.loads((self._endpoint_dir / OFFLINE_TABLE).read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None
        tools = table.get("tools") if isinstance(table, dict) else None
        entry = tools.get(tool) if isinstance(tools, dict) else None
        if not isinstance(entry, dict):
            return None
        result = entry.get("result")
        has_content_list = isinstance(result, dict) and isinstance(result.get("content"), list)
        has_replay_flag = isinstance(entry.get("replay"), bool)
        return entry if has_content_list and has_replay_flag else None

    def _log_offline_call(self, tool: str, params: dict[str, Any], replay: bool) -> None:
        """Appends the call's line to this session's calls file, opening it by name each time, since the app claims
        the file by renaming it. A failure is logged, never raised: the call still gets its answer."""
        session_id = self._hello["session_id"]
        if session_id is None:
            _log(f"no session id, so the offline answer to {tool} is not logged for the app to replay")
            return
        arguments = params.get("arguments")
        meta = params.get("_meta")
        tool_use_id = meta.get("claudecode/toolUseId") if isinstance(meta, dict) else None
        line = json.dumps({"tool": tool, "arguments": arguments if isinstance(arguments, dict) else {},
                           "toolUseId": tool_use_id if isinstance(tool_use_id, str) else None,
                           "at": int(time.time() * 1000), "replay": replay}) + "\n"
        try:
            with self._calls_lock:
                self._offline_calls.mkdir(parents=True, exist_ok=True)
                with open(self._offline_calls / f"{session_id}.jsonl", "ab") as calls_file:
                    calls_file.write(line.encode("utf-8"))
        except OSError as exc:
            _log(f"could not log the offline answer to {tool}: {exc}")

    def _send_host(self, data: bytes) -> None:
        with self._host_lock:
            self._write_host(data)


def _say_hello(channel, hello: dict[str, Any]) -> bytes:
    """Sends the hello line and reads the app's reply; returns the bytes the app sent after it."""
    channel.write(_line(hello))
    buffer = b""
    while b"\n" not in buffer:
        chunk = channel.read()
        if not chunk:
            raise OSError("the app closed the channel before answering the hello")
        buffer += chunk
    reply_line, rest = buffer.split(b"\n", 1)
    reply = json.loads(reply_line)
    if not isinstance(reply, dict):
        raise ValueError(f"the hello reply was not an object: {reply!r}")
    if not reply.get("ok"):
        raise RelayRefused(str(reply.get("error", "no reason given")))
    return rest


def _line(message: dict[str, Any]) -> bytes:
    return (json.dumps(message) + "\n").encode("utf-8")


def _response(request_id, result: dict[str, Any]) -> bytes:
    return _line({"jsonrpc": "2.0", "id": request_id, "result": result})


def _error(request_id, code: int, message: str) -> bytes:
    return _line({"jsonrpc": "2.0", "id": request_id, "error": {"code": code, "message": message}})


def _tool_error(request_id, text: str) -> bytes:
    return _response(request_id, {"content": [{"type": "text", "text": text}], "isError": True})


def _payload_result(request_id, payload: dict[str, Any]) -> bytes:
    return _response(request_id, {"content": [{"type": "text", "text": json.dumps(payload, indent=2)}],
                                  "structuredContent": payload})


def _refused_answer(request_id, reason: str, tool: str | None) -> bytes:
    return _denied_or(_tool_error(request_id, _refused_text(reason, tool)), request_id, tool,
                      REFUSED.format(reason=reason))


def _denied_or(form_answer: bytes, request_id, tool: str | None, why: str) -> bytes:
    """`form_answer`, except for a permission_prompt call: Claude Code reads its decision only from the text of a result
    whose content opens with text, so that call gets one text block holding a deny and nothing else."""
    if tool != PERMISSION_TOOL:
        return form_answer
    decision = {"behavior": "deny", "message": f"{why}. The user was not asked, so this tool call did not run."}
    return _response(request_id, {"content": [{"type": "text", "text": json.dumps(decision)}]})


def _log(message: str) -> None:
    print(f"auri relay: {message}", file=sys.stderr, flush=True)


def main() -> int:
    relay = Relay(start_app.endpoint_dir(os.environ), hello_from_env(os.environ, codex_session_id()), write_stdout,
                  offline_calls=offline_calls_dir(os.environ))
    relay.connect_if_running()
    for line in sys.stdin.buffer:
        line = line.rstrip(b"\r\n")
        if line.strip():
            relay.handle_line(line)
    relay.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
