"""The AskUserQuestion hook for app sessions: denies the call and points the agent at a form, which the app
answers and AskUserQuestion does not. A session with no app row (`WIGLEY_SESSION_ROW`) keeps the tool and gets nothing.
It ignores its input and always exits 0. Standard library only.
"""

from __future__ import annotations

import json
import os
import sys

DENIAL = (
    "AskUserQuestion gets no answer in an app session. Ask through a form instead: load the auri server's "
    "ask_round tool (ToolSearch \"select:mcp__plugin_auri_auri__ask_round\") and send every open question in one call, "
    "each with its context, numbered choices, the recommended number and why. The auri:forms skill holds the format."
)


def main(stdin, stdout, env) -> int:
    """Prints the deny line for an app session and nothing otherwise; always returns 0."""
    stdin.read()
    if env.get("WIGLEY_SESSION_ROW"):
        output = {"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny",
                                         "permissionDecisionReason": DENIAL}}
        stdout.write(json.dumps(output) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.stdin.buffer, sys.stdout, os.environ))
