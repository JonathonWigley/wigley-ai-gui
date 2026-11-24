"""The client side of a relay hook call, shared by the `auri` hook scripts: the hook hello, the app's channel, and one
request answered by one reply line within a deadline. README.md § The relay (Hook calls) holds the wire. Standard
library only.
"""

from __future__ import annotations

import json
import time

import endpoint
import start_app

HOOK_DEADLINE_SECONDS = 3.0


def app_channel(env) -> str | None:
    """The channel the app's endpoint file names, or None when there is no readable endpoint file."""
    return endpoint.channel_path(start_app.endpoint_dir(env))


def session_hello(hook: str, hook_input: dict, env) -> dict:
    """The hook hello for the session `hook_input` and `env` describe, asking the handler named `hook`."""
    session_id = hook_input.get("session_id")
    return {
        "protocol": endpoint.HOOK_PROTOCOL,
        "session_id": session_id if isinstance(session_id, str) else None,
        "project_dir": env.get("CLAUDE_PROJECT_DIR") or hook_input.get("cwd"),
        "harness": "claude",
        "config_dir": env.get("CLAUDE_CONFIG_DIR") or None,
        "row_id": env.get("WIGLEY_SESSION_ROW") or None,
        "hook": hook,
    }


def ask_app_reply(channel: str, hello: dict, request: dict, deadline: float) -> dict | None:
    """Sends `hello` and `request` on `channel` and returns the `reply` object of the app's `{"ok": true, "reply":
    {...}}` line; None when the app refuses, the channel fails, or the line is not complete by `deadline` (a
    time.monotonic() value)."""
    time_left = deadline - time.monotonic()
    if time_left <= 0:
        return None
    try:
        connection = endpoint.open_channel(channel, timeout=time_left)
    except OSError:
        return None
    try:
        for message in (hello, request):
            if not _set_time_left(connection, deadline):
                return None
            connection.write(json.dumps(message).encode() + b"\n")
        line = _read_line(connection, deadline)
    except OSError:
        return None
    finally:
        connection.close()
    return None if line is None else _reply_object(line)


def _set_time_left(connection, deadline: float) -> bool:
    """Bounds the channel's next call by the time left; False when none is left."""
    time_left = deadline - time.monotonic()
    if time_left <= 0:
        return False
    connection.set_timeout(time_left)
    return True


def _read_line(connection, deadline: float) -> bytes | None:
    """The first line the app sends, without its newline; None when the channel closes or `deadline` passes first."""
    received = b""
    while b"\n" not in received:
        if not _set_time_left(connection, deadline):
            return None
        chunk = connection.read()
        if not chunk:
            return None
        received += chunk
    return received.split(b"\n", 1)[0]


def _reply_object(line: bytes) -> dict | None:
    try:
        answer = json.loads(line)
    except ValueError:
        return None
    is_answered = isinstance(answer, dict) and answer.get("ok") is True and isinstance(answer.get("reply"), dict)
    return answer["reply"] if is_answered else None
