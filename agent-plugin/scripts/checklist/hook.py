"""The task-list hook for app sessions: `hook.py edit` denies an edit until the session has sent a task list,
`hook.py stop` reminds the agent at a turn end while items are open, and `hook.py compact` shows the workflow step and
the list again after a compaction. It asks the app's `workflow.checklist` hook handler over the relay's hook protocol,
prints one JSON line or nothing, and always exits 0; a session with no app row, a subagent, and a session whose
app is away or does not answer within HOOK_DEADLINE_SECONDS get nothing. relay/README.md § The relay holds the wire. Standard library only.
"""

from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "relay"))

import hook_client  # noqa: E402
from hook_client import HOOK_DEADLINE_SECONDS  # noqa: E402

CHECKLIST_HOOK = "workflow.checklist"
MODES = ("edit", "stop", "compact")
# Claude Code's cap on one hook's additionalContext.
CONTEXT_CAP = 10_000

CHECKLIST_DENIAL = (
    "This app session has sent no task list yet. Before any edit, send it with the auri server's "
    "set_workflow_checklist tool: every step of the work in hand as concrete items, the whole list. Then make this "
    "edit again."
)
CHECKLIST_REMINDER = (
    "auri: this turn is ending with {open} open {noun} on this session's task list. If an item finished, send the list "
    "again with set_workflow_checklist, each finished item done. If the work waits on the user or a later turn, leave "
    "the list as it is and end the turn."
)
COMPACT_STEP = "auri: this session's workflow step before the compaction: {step}."
COMPACT_LIST_HEADER = "auri: this session's task list before the compaction:"
COMPACT_LIST_FOOTER = "Send set_workflow_checklist again when the list no longer matches the work in hand."
COMPACT_STEP_FOOTER = (
    "Report the step and checklist that match the work in hand now, with set_workflow_step and set_workflow_checklist, "
    "in the same message as the next call."
)
COMPACT_LIST_CUT = "…"
COMPACT_NONE = (
    "auri: this session has sent no task list yet. Send it with set_workflow_checklist before your first edit."
)


def decide(mode: str, hook_input: dict, env, reply: dict | None) -> dict | None:
    """The hook output for `mode` given the app's `reply`, or None when this call prints nothing: no app row, a
    subagent, a repeated stop, a SessionStart other than a compaction, or no well-formed reply."""
    if not is_gated(mode, hook_input, env) or not _is_checklist_reply(reply):
        return None
    if mode == "edit":
        return None if reply["reported"] else _deny(CHECKLIST_DENIAL)
    if mode == "stop":
        if not (reply["reported"] and reply["open"] > 0):
            return None
        noun = "item" if reply["open"] == 1 else "items"
        return _context("Stop", CHECKLIST_REMINDER.format(open=reply["open"], noun=noun))
    return _context("SessionStart", compact_text(reply))


def is_gated(mode: str, hook_input: dict, env) -> bool:
    """Whether this call asks the app at all: an app session's main agent, on a first stop or a compaction."""
    is_app_session = bool(env.get("WIGLEY_SESSION_ROW"))
    agent_id = hook_input.get("agent_id")
    is_subagent = isinstance(agent_id, str) and bool(agent_id)
    is_repeated_stop = mode == "stop" and hook_input.get("stop_hook_active") is True
    is_other_session_start = mode == "compact" and hook_input.get("source") != "compact"
    return is_app_session and not is_subagent and not is_repeated_stop and not is_other_session_start


def compact_text(reply: dict) -> str:
    """The compaction reminder for a well-formed `reply`: the step line when the session is on a reportable step,
    then the task list, or COMPACT_NONE when none was sent."""
    step = reply.get("step")
    opening = [COMPACT_STEP.format(step=step)] if step is not None else []
    if not reply["reported"]:
        footer = [] if step is None else [COMPACT_STEP_FOOTER]
        return "\n".join([*opening, COMPACT_NONE, *footer])
    return compact_list(reply["items"], opening, COMPACT_LIST_FOOTER if step is None else COMPACT_STEP_FOOTER)


def compact_list(items: list[dict], opening: list[str], footer: str) -> str:
    """The `opening` lines, the list of `items` and `footer`, within CONTEXT_CAP: items dropped from the end, with one
    COMPACT_LIST_CUT line before the footer, when the whole text would pass it."""
    lines = [f"- [{'x' if item['done'] else ' '}] {item['text']}" for item in items]
    whole = "\n".join([*opening, COMPACT_LIST_HEADER, *lines, footer])
    if len(whole) <= CONTEXT_CAP:
        return whole
    kept = [*opening, COMPACT_LIST_HEADER]
    length = len("\n".join(kept)) + 1 + len(COMPACT_LIST_CUT) + 1 + len(footer)
    for line in lines:
        if length + len(line) + 1 > CONTEXT_CAP:
            break
        kept.append(line)
        length += len(line) + 1
    return "\n".join([*kept, COMPACT_LIST_CUT, footer])


def main(argv: list[str], stdin, stdout, env) -> int:
    """Runs the hook for `argv[0]` (`edit`, `stop` or `compact`) on the JSON input in `stdin` (text or bytes); always
    returns 0, an exception reported on stderr only."""
    deadline = time.monotonic() + HOOK_DEADLINE_SECONDS
    try:
        output = _hook_output(argv, stdin, env, deadline)
    except Exception as error:
        print(f"checklist hook: {error!r}", file=sys.stderr)
        return 0
    if output is not None:
        stdout.write(json.dumps(output) + "\n")
    return 0


def _hook_output(argv: list[str], stdin, env, deadline: float) -> dict | None:
    mode = argv[0] if argv else None
    if mode not in MODES:
        return None
    try:
        hook_input = json.loads(stdin.read())
    except ValueError:
        return None
    if not isinstance(hook_input, dict) or not is_gated(mode, hook_input, env):
        return None
    channel = hook_client.app_channel(env)
    if channel is None:
        return None
    hello = hook_client.session_hello(CHECKLIST_HOOK, hook_input, env)
    reply = hook_client.ask_app_reply(channel, hello, {"mode": mode}, deadline)
    return decide(mode, hook_input, env, reply)


def _is_checklist_reply(reply) -> bool:
    """Whether `reply` holds a bool `reported`, an int `open`, a list of items each with a str `text` and a bool
    `done`, and a `step` that is a str or None (an app from before `step` sends none)."""
    if not isinstance(reply, dict):
        return False
    open_count = reply.get("open")
    items = reply.get("items")
    is_open_count = isinstance(open_count, int) and not isinstance(open_count, bool)
    is_item_list = isinstance(items, list) and all(_is_item(item) for item in items)
    is_step = reply.get("step") is None or isinstance(reply.get("step"), str)
    return isinstance(reply.get("reported"), bool) and is_open_count and is_item_list and is_step


def _is_item(item) -> bool:
    return isinstance(item, dict) and isinstance(item.get("text"), str) and isinstance(item.get("done"), bool)


def _deny(reason: str) -> dict:
    return {"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny",
                                   "permissionDecisionReason": reason}}


def _context(event: str, text: str) -> dict:
    return {"hookSpecificOutput": {"hookEventName": event, "additionalContext": text}}


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:], sys.stdin.buffer, sys.stdout, os.environ))
