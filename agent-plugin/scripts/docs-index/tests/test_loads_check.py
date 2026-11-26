"""check_points and missing_loads over session transcripts each test writes in
its own temp folder, against a launch list the test builds."""

import json
import os
import shutil
import tempfile
import unittest
from pathlib import Path

from loads_check import check_points, missing_loads
from model import Entry

BOUNDARY = {"type": "system", "subtype": "compact_boundary", "content": "Conversation compacted"}


def _entry(path, kind="instructions"):
    return Entry(id=str(path), kind=kind, source="global", repo=None, root=None, plugin=None, path=str(path),
                 line=None, title=Path(path).name, meta={})


def _instructions(*paths):
    return {"type": "attachment",
            "attachment": {"type": "instructions", "files": [{"path": str(path), "type": "Project"} for path in paths]}}


def _cwd(folder):
    return {"type": "user", "cwd": str(folder), "message": {"role": "user", "content": "go"}}


def _write_rows(path, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(json.dumps(row, separators=(",", ":")) + "\n" for row in rows), encoding="utf-8")


class MissingLoadsTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(os.path.realpath(tmp.name))
        self.folder = self.root / "dev" / "app"
        self.agents_md = self.folder / "AGENTS.md"
        self.user_md = self.root / "home" / ".claude" / "CLAUDE.md"
        self.hook = self.root / "home" / ".claude" / "settings.json"
        for path in (self.agents_md, self.user_md, self.hook, self.folder / "sub" / "AGENTS.md"):
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("# Doc\n", encoding="utf-8")
        self.link = self.root / "links" / "AGENTS.md"
        self.link.parent.mkdir()
        self.link.symlink_to(self.agents_md)
        self.transcript = self.root / "projects" / "-dev-app" / "s1.jsonl"
        self.subagents = self.transcript.with_suffix("") / "subagents"

    def test_missing_loads(self):
        a, u, folder = self.agents_md, self.user_md, self.folder
        main_ok = [_cwd(folder), _instructions(a, u)]
        cases = [
            # (case, main rows, {subagent path: rows}, {meta path: text}, [(missing path, where)])
            ("all present", main_ok, {}, {}, []),
            ("main lacks A", [_cwd(folder), _instructions(u)], {}, {}, [(a, "main")]),
            ("subagent lacks A", main_ok, {"agent-a1.jsonl": [_instructions(u)]}, {}, [(a, "subagent:a1")]),
            ("Explore lacks A", main_ok, {"agent-a2.jsonl": [_instructions(u)]},
             {"agent-a2.meta.json": json.dumps({"agentType": "Explore"})}, []),
            ("subagent with no row", main_ok, {"agent-a3.jsonl": [_cwd(folder)]}, {}, []),
            ("second compaction lacks A",
             [*main_ok, BOUNDARY, _instructions(a, u), BOUNDARY, _instructions(u)], {}, {}, [(a, "compact:2")]),
            ("boundary with no row after", [*main_ok, BOUNDARY], {}, {}, []),
            ("row names a link to A", [_cwd(folder), _instructions(self.link, u)], {}, {}, []),
            ("subagent in a subfolder", main_ok, {"agent-a4.jsonl": [_cwd(folder / "sub"), _instructions(a, u)]},
             {}, []),
            ("subagent outside the folder", main_ok,
             {"agent-a5.jsonl": [_cwd(self.root / "elsewhere"), _instructions(a, u)]}, {}, []),
            ("unloaded kind", main_ok, {}, {}, []),
            ("journal left out", main_ok, {"journal.jsonl": [_instructions(u)]}, {}, []),
            ("meta unreadable", main_ok, {"agent-a6.jsonl": [_instructions(u)]}, {"agent-a6.meta.json": "not json"},
             [(a, "subagent:a6")]),
            ("meta missing", main_ok, {"agent-a7.jsonl": [_instructions(u)]}, {}, [(a, "subagent:a7")]),
            ("nested workflow subagent", main_ok, {"workflows/run-1/agent-a8.jsonl": [_instructions(u)]}, {},
             [(a, "subagent:a8")]),
        ]
        launch = [_entry(a), _entry(u)]
        # Only this row's launch list holds a hook entry, which no transcript row loads and no row reports missing.
        launch_extras = {"unloaded kind": [_entry(self.hook, kind="hook")]}

        for case, main_rows, subagents, metas, expected in cases:
            with self.subTest(case):
                self._write_session(main_rows, subagents, metas)

                missing = missing_loads(check_points(self.transcript), launch + launch_extras.get(case, []))

                self.assertEqual(missing, [{"id": str(path), "path": str(path), "where": where}
                                           for path, where in expected])

    def _write_session(self, main_rows, subagents, metas):
        """A fresh transcript of main_rows, with each subagent transcript and meta file beside it."""
        shutil.rmtree(self.subagents, ignore_errors=True)
        _write_rows(self.transcript, main_rows)
        for name, rows in subagents.items():
            _write_rows(self.subagents / name, rows)
        for name, text in metas.items():
            (self.subagents / name).write_text(text, encoding="utf-8")


if __name__ == "__main__":
    unittest.main()
