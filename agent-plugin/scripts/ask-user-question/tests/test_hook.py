"""hook.py: an app session's AskUserQuestion call is denied toward a form; any other session's passes."""

import io
import json
import unittest

import hook

DENIAL = ("AskUserQuestion gets no answer in an app session. Ask through a form instead: load the auri "
          "server's ask_round tool (ToolSearch \"select:mcp__plugin_auri_auri__ask_round\") and send every open "
          "question in one call, each with its context, numbered choices, the recommended number and why. The "
          "auri:forms skill holds the format.")
HOOK_INPUT = json.dumps({"session_id": "session-1", "cwd": "/w", "hook_event_name": "PreToolUse",
                         "tool_name": "AskUserQuestion", "tool_input": {"questions": []}})


class MainTests(unittest.TestCase):
    def test_main(self):
        deny_line = json.dumps({"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny",
                                                       "permissionDecisionReason": DENIAL}}) + "\n"
        rows = [
            ("app session", {"WIGLEY_SESSION_ROW": "row-7"}, deny_line),
            ("terminal session", {}, ""),
            ("empty row", {"WIGLEY_SESSION_ROW": ""}, ""),
        ]
        for name, env, expected in rows:
            with self.subTest(name):
                stdout = io.StringIO()
                self.assertEqual(hook.main(io.StringIO(HOOK_INPUT), stdout, env), 0)
                self.assertEqual(stdout.getvalue(), expected)


if __name__ == "__main__":
    unittest.main()
