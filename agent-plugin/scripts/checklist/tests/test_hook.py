"""hook.py: the output each mode prints for the app's reply, the calls that print nothing, the compaction list cut at
Claude Code's cap, a main that always exits 0, and the hello and request a fake app receives."""

import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import hook

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "relay" / "tests"))

from fake_hook_app import FakeHookApp  # noqa: E402

TEST_DEADLINE_SECONDS = 0.5
ROW_ENV = {"WIGLEY_SESSION_ROW": "row-7"}

DENIAL = ("This app session has sent no task list yet. Before any edit, send it with the auri server's "
          "set_workflow_checklist tool: every step of the work in hand as concrete items, the whole list. Then make "
          "this edit again.")
REMINDER_TWO_OPEN = ("auri: this turn is ending with 2 open items on this session's task list. If an item finished, "
                     "send the list again with set_workflow_checklist, each finished item done. If the work waits on "
                     "the user or a later turn, leave the list as it is and end the turn.")
COMPACT_LIST = ("auri: this session's task list before the compaction:\n"
                "- [x] Read the relay\n"
                "- [ ] Write the hook\n"
                "- [ ] Run the tests\n"
                "Send set_workflow_checklist again when the list no longer matches the work in hand.")
COMPACT_NONE = ("auri: this session has sent no task list yet. Send it with set_workflow_checklist before your first "
                "edit.")
STEP_LINE = "auri: this session's workflow step before the compaction: cold_read.\n"
STEP_FOOTER = ("Report the step and checklist that match the work in hand now, with set_workflow_step and "
               "set_workflow_checklist, in the same message as the next call.")
COMPACT_STEP_LIST = STEP_LINE + COMPACT_LIST.rsplit("\n", 1)[0] + "\n" + STEP_FOOTER

ITEMS = [{"text": "Read the relay", "done": True}, {"text": "Write the hook", "done": False, "running": True},
         {"text": "Run the tests", "done": False}]
REMINDER_ONE_OPEN = REMINDER_TWO_OPEN.replace("2 open items", "1 open item")
REPORTED = {"reported": True, "open": 2, "items": ITEMS, "step": None}
REPORTED_ON_STEP = {**REPORTED, "step": "cold_read"}
REPORTED_ONE_OPEN = {"reported": True, "open": 1, "items": ITEMS[:2]}
NOT_REPORTED = {"reported": False, "open": 0, "items": [], "step": None}
REPORTED_ALL_DONE = {"reported": True, "open": 0, "items": [{"text": "Read the relay", "done": True}]}

EDIT_INPUT = {"session_id": "session-1", "cwd": "/w", "hook_event_name": "PreToolUse", "tool_name": "Edit",
              "tool_input": {"file_path": "/w/a.ts"}}
STOP_INPUT = {"session_id": "session-1", "cwd": "/w", "hook_event_name": "Stop", "stop_hook_active": False}
COMPACT_INPUT = {"session_id": "session-1", "cwd": "/w", "hook_event_name": "SessionStart", "source": "compact"}
INPUTS = {"edit": EDIT_INPUT, "stop": STOP_INPUT, "compact": COMPACT_INPUT}


def deny(reason):
    return {"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny",
                                   "permissionDecisionReason": reason}}


def context(event, text):
    return {"hookSpecificOutput": {"hookEventName": event, "additionalContext": text}}


class DecideTests(unittest.TestCase):
    def test_decide(self):
        rows = [
            ("edit, no list sent", "edit", EDIT_INPUT, ROW_ENV, NOT_REPORTED, deny(DENIAL)),
            ("edit, list sent", "edit", EDIT_INPUT, ROW_ENV, REPORTED, None),
            ("stop, 2 open", "stop", STOP_INPUT, ROW_ENV, REPORTED, context("Stop", REMINDER_TWO_OPEN)),
            ("stop, 1 open", "stop", STOP_INPUT, ROW_ENV, REPORTED_ONE_OPEN, context("Stop", REMINDER_ONE_OPEN)),
            ("stop, all done", "stop", STOP_INPUT, ROW_ENV, REPORTED_ALL_DONE, None),
            ("stop, no list sent", "stop", STOP_INPUT, ROW_ENV, NOT_REPORTED, None),
            ("compact, list sent", "compact", COMPACT_INPUT, ROW_ENV, REPORTED, context("SessionStart", COMPACT_LIST)),
            ("compact, no list sent", "compact", COMPACT_INPUT, ROW_ENV, NOT_REPORTED,
             context("SessionStart", COMPACT_NONE)),
            ("compact, list sent on a step", "compact", COMPACT_INPUT, ROW_ENV, REPORTED_ON_STEP,
             context("SessionStart", COMPACT_STEP_LIST)),
            ("compact, no list sent on a step", "compact", COMPACT_INPUT, ROW_ENV,
             {**NOT_REPORTED, "step": "cold_read"},
             context("SessionStart", STEP_LINE + COMPACT_NONE + "\n" + STEP_FOOTER)),
            ("compact, a reply with no step", "compact", COMPACT_INPUT, ROW_ENV,
             {key: value for key, value in REPORTED.items() if key != "step"}, context("SessionStart", COMPACT_LIST)),
            ("step not a string", "compact", COMPACT_INPUT, ROW_ENV, {**REPORTED, "step": 3}, None),
            ("no row env", "edit", EDIT_INPUT, {}, NOT_REPORTED, None),
            ("empty row env", "edit", EDIT_INPUT, {"WIGLEY_SESSION_ROW": ""}, NOT_REPORTED, None),
            ("a subagent", "edit", {**EDIT_INPUT, "agent_id": "agent-1"}, ROW_ENV, NOT_REPORTED, None),
            ("stop_hook_active", "stop", {**STOP_INPUT, "stop_hook_active": True}, ROW_ENV, REPORTED, None),
            ("source startup", "compact", {**COMPACT_INPUT, "source": "startup"}, ROW_ENV, NOT_REPORTED, None),
            ("reply None", "edit", EDIT_INPUT, ROW_ENV, None, None),
            ("reported a string", "edit", EDIT_INPUT, ROW_ENV, {**NOT_REPORTED, "reported": "false"}, None),
            ("items not a list", "compact", COMPACT_INPUT, ROW_ENV, {**REPORTED, "items": "Read the relay"}, None),
            ("an item with no text", "compact", COMPACT_INPUT, ROW_ENV, {**REPORTED, "items": [{"done": True}]},
             None),
        ]
        for name, mode, hook_input, env, reply, expected in rows:
            with self.subTest(name):
                self.assertEqual(hook.decide(mode, hook_input, env, reply), expected)

    def test_compact_list_cut_at_cap(self):
        items = [{"text": f"item {index:015d}", "done": index % 2 == 0} for index in range(900)]
        text = hook.compact_text({"reported": True, "open": 450, "items": items, "step": "cold_read"})
        self.assertLessEqual(len(text), 10_000)
        list_start = STEP_LINE + "auri: this session's task list before the compaction:\n- [x] item "
        self.assertTrue(text.startswith(list_start))
        self.assertEqual(text.splitlines()[-2:], ["…", STEP_FOOTER])


class MainTests(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.dir = Path(folder.name)
        self.env = {**ROW_ENV, "WIGLEY_AI_GUI_ENDPOINT_DIR": str(self.dir)}

    def start_app(self, name: str, answer: dict) -> FakeHookApp:
        channel = str(self.dir / f"{name}.sock")
        app = FakeHookApp(channel, "answer", answer)
        self.addCleanup(app.stop)
        endpoint = {"protocol": 1, "channel": channel, "launch": {"command": ["npm", "start"], "cwd": "/app"}}
        (self.dir / "endpoint.json").write_text(json.dumps(endpoint), encoding="utf-8")
        return app

    def run_main(self, mode: str, stdin_text: str, env: dict) -> tuple[int, str]:
        stdout = io.StringIO()
        with mock.patch("sys.stderr", io.StringIO()), \
                mock.patch.object(hook, "HOOK_DEADLINE_SECONDS", TEST_DEADLINE_SECONDS):
            code = hook.main([mode], io.StringIO(stdin_text), stdout, env)
        return code, stdout.getvalue()

    def test_main_against_a_fake_app(self):
        rows = [
            ("edit", NOT_REPORTED, json.dumps(deny(DENIAL)) + "\n"),
            ("stop", REPORTED, json.dumps(context("Stop", REMINDER_TWO_OPEN)) + "\n"),
            ("compact", REPORTED_ON_STEP, json.dumps(context("SessionStart", COMPACT_STEP_LIST)) + "\n"),
        ]
        for mode, reply, expected in rows:
            with self.subTest(mode):
                app = self.start_app(mode, {"ok": True, "reply": reply})
                self.assertEqual(self.run_main(mode, json.dumps(INPUTS[mode]), self.env), (0, expected))
                hello, request = app.next_received()
                self.assertEqual((hello["hook"], hello["row_id"]), ("workflow.checklist", "row-7"))
                self.assertEqual(request, {"mode": mode})

    def test_main_exits_zero(self):
        self.start_app("app", {"ok": True, "reply": NOT_REPORTED})

        def raising_decide(mode, hook_input, env, reply):
            raise RuntimeError("decide exploded")

        away_env = {**ROW_ENV, "WIGLEY_AI_GUI_ENDPOINT_DIR": str(self.dir / "gone")}
        rows = [
            ("stdin not JSON", "not json", self.env, None),
            ("stdin not an object", "[]", self.env, None),
            ("an exception in decide", json.dumps(EDIT_INPUT), self.env, raising_decide),
            ("no app endpoint", json.dumps(EDIT_INPUT), away_env, None),
        ]
        for name, stdin_text, env, decide in rows:
            with self.subTest(name), mock.patch.object(hook, "decide", decide or hook.decide):
                self.assertEqual(self.run_main("edit", stdin_text, env), (0, ""))


if __name__ == "__main__":
    unittest.main()
