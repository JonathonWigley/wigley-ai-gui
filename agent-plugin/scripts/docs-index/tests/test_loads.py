"""read_loads, LoadTimes, the machine and session scans and last_loaded on
transcripts each test writes in its own temp home."""

import json
import os
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest import mock

import loads
from environment import Environment
from loads import LOADS_PATH_PARTS, LoadTimes, last_loaded, machine_load_times, read_loads, session_load_times
from model import Entry, Installed, Location, Owner

FIXED_NOW = datetime(2026, 10, 26, tzinfo=timezone.utc)


def _time(n):
    return f"2026-10-01T00:00:0{n}.000Z"


def _read_row(path, timestamp):
    return {"type": "assistant", "timestamp": timestamp,
            "message": {"content": [{"type": "tool_use", "name": "Read", "input": {"file_path": str(path)}}]}}


def _tool_row(name, tool_input, timestamp):
    return {"type": "assistant", "timestamp": timestamp,
            "message": {"content": [{"type": "tool_use", "name": name, "input": tool_input}]}}


def _attachment_row(attachment, timestamp):
    return {"type": "attachment", "timestamp": timestamp, "attachment": attachment}


def _user_row(content, timestamp):
    return {"type": "user", "timestamp": timestamp, "message": {"role": "user", "content": content}}


def _write_rows(transcript, *rows, mode="a"):
    transcript.parent.mkdir(parents=True, exist_ok=True)
    with transcript.open(mode, encoding="utf-8") as file:
        for row in rows:
            file.write(json.dumps(row, separators=(",", ":")) + "\n")


def _refusing_read(refused):
    """A read_loads stand-in that raises PermissionError for refused and reads every other transcript."""
    real_read = loads.read_loads

    def read(transcript, offset=0):
        if transcript == refused:
            raise PermissionError(f"refused: {transcript}")
        return real_read(transcript, offset)
    return read


def _entry(path, kind, source="repo", root=None, plugin=None, meta=None, walked=(), installed=()):
    """An entry at path; walked holds (linked path, Owner of the walk) pairs."""
    return Entry(id=str(path), kind=kind, source=source, repo=None, root=str(root) if root else None,
                 plugin=plugin, path=str(path), line=None, title=Path(path).name, meta=meta or {},
                 walked=tuple(Location(str(linked), owner) for linked, owner in walked), installed=tuple(installed))


class _TempHomeTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.home = Path(os.path.realpath(tmp.name))
        self.env = Environment(home=self.home, now=lambda: FIXED_NOW,
                               claude_config_dirs=(self.home / ".claude", self.home / ".claude-personal"))
        self.cache_path = self.home.joinpath(*LOADS_PATH_PARTS)

    def _path(self, name):
        return str(self.home / name)

    def _read_cache(self):
        return json.loads(self.cache_path.read_text(encoding="utf-8"))


class ReadLoadsTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.home = Path(os.path.realpath(tmp.name))
        self.transcript = self.home / "session.jsonl"

    def _append(self, *rows):
        with self.transcript.open("a", encoding="utf-8") as file:
            for row in rows:
                file.write(json.dumps(row, separators=(",", ":")) + "\n")

    def _path(self, name):
        return str(self.home / name)

    def test_each_load_row_counts_at_its_timestamp(self):
        skill_k = self.home / "skills" / "k"
        skill_r = self.home / "skills" / "r"
        self._append(
            _attachment_row({"type": "instructions", "files": [{"path": self._path("a.md")},
                                                               {"path": self._path("b.md")}]}, _time(0)),
            _attachment_row({"type": "nested_memory", "path": self._path("c.md")}, _time(1)),
            _attachment_row({"type": "file", "filename": self._path("d.md")}, _time(2)),
            _attachment_row({"type": "compact_file_reference", "filename": self._path("e.md")}, _time(3)),
            _user_row([{"type": "text", "text": f"Base directory for this skill: {skill_k}\n\nbody"}], _time(4)),
            _attachment_row({"type": "invoked_skills", "skills": [
                {"name": "wigley:r", "path": "plugin:wigley:r",
                 "content": f"Base directory for this skill: {skill_r}\n\nbody"}]}, _time(5)),
            _read_row(self._path("f.md"), _time(6)),
            _tool_row("Agent", {"subagent_type": "wigley:haiku"}, _time(7)),
            _tool_row("Task", {"subagent_type": "scout"}, _time(8)),
            _user_row("<command-message>wigley:make</command-message>\n<command-name>/wigley:make</command-name>\n"
                      "<command-args></command-args>", _time(9)),
        )

        loads, _ = read_loads(self.transcript)

        self.assertEqual(loads.paths, {
            self._path("a.md"): _time(0),
            self._path("b.md"): _time(0),
            self._path("c.md"): _time(1),
            self._path("d.md"): _time(2),
            self._path("e.md"): _time(3),
            str(skill_k / "SKILL.md"): _time(4),
            str(skill_r / "SKILL.md"): _time(5),
            self._path("f.md"): _time(6),
        })
        self.assertEqual(loads.names, {
            "subagent:wigley:haiku": _time(7),
            "subagent:scout": _time(8),
            "command:wigley:make": _time(9),
        })

    def test_rows_that_are_not_loads_add_nothing(self):
        self._append(
            _attachment_row({"type": "edited_text_file", "filename": self._path("a.md")}, _time(0)),
            _attachment_row({"type": "skill_mention", "name": "wigley:make"}, _time(1)),
            _attachment_row({"type": "dynamic_skill", "path": self._path("skills/k")}, _time(2)),
            _attachment_row({"type": "skill_listing", "content": "- wigley:make"}, _time(3)),
            _attachment_row({"type": "agent_listing_delta", "content": "- scout"}, _time(4)),
            _tool_row("Skill", {"skill": "wigley:make"}, _time(5)),
            _user_row([{"type": "tool_result",
                        "content": f"Base directory for this skill: {self.home / 'skills' / 'k'}"}], _time(6)),
            {"type": "api-request-shape", "timestamp": _time(7), "shape": "<command-name>/x</command-name>"},
        )

        loads, _ = read_loads(self.transcript)

        self.assertEqual(loads.paths, {})
        self.assertEqual(loads.names, {})

    def test_a_non_load_attachment_row_is_never_parsed(self):
        self._append(
            _attachment_row({"type": "skill_listing", "content": "- wigley:make"}, _time(0)),
            _read_row(self._path("f.md"), _time(1)),
        )

        with mock.patch.object(loads.json, "loads", wraps=json.loads) as parse:
            read, _ = read_loads(self.transcript)

        self.assertEqual(parse.call_count, 1)
        self.assertEqual(read.paths, {self._path("f.md"): _time(1)})

    def test_a_row_with_no_timestamp_is_skipped(self):
        read = _read_row(self._path("f.md"), "unused")
        no_timestamp = {"type": "assistant", "message": read["message"]}
        self._append(
            {"type": "api-request-blob", "message": read["message"]},
            no_timestamp,
            {**no_timestamp, "timestamp": "2026-10-26"},
        )

        loads, _ = read_loads(self.transcript)

        self.assertEqual(loads.paths, {})

    def test_the_later_time_of_two_loads_is_kept(self):
        self._append(
            _read_row(self._path("f.md"), "2026-10-26T21:01:32.174Z"),
            _read_row(self._path("f.md"), "2026-10-26T09:00:00-13:00"),
            _read_row(self._path("f.md"), "2026-10-26T08:00:00.000Z"),
        )

        loads, _ = read_loads(self.transcript)

        self.assertEqual(loads.paths[self._path("f.md")], "2026-10-26T09:00:00-13:00")

    def test_merge_keeps_the_later_time_per_key(self):
        held = LoadTimes(paths={"/x": "2026-10-02T00:00:00Z", "/y": "2026-10-02T00:00:00Z"},
                         names={"command:a": "2026-10-01T00:00:00Z"})
        other = LoadTimes(paths={"/x": "2026-10-03T00:00:00Z", "/y": "2026-10-01T00:00:00Z",
                                 "/z": "2026-10-01T00:00:00Z"}, names={})

        held.merge(other)

        self.assertEqual(held.paths, {"/x": "2026-10-03T00:00:00Z", "/y": "2026-10-02T00:00:00Z",
                                      "/z": "2026-10-01T00:00:00Z"})
        self.assertEqual(held.names, {"command:a": "2026-10-01T00:00:00Z"})

    def test_a_line_that_is_not_json_is_skipped(self):
        self._append(_read_row(self._path("a.md"), _time(0)))
        with self.transcript.open("a", encoding="utf-8") as file:
            file.write('not json "name":"Read"\n')
        self._append(_read_row(self._path("b.md"), _time(1)))

        loads, _ = read_loads(self.transcript)

        self.assertEqual(loads.paths, {self._path("a.md"): _time(0), self._path("b.md"): _time(1)})

    def test_resume_reads_only_appended_lines_and_stops_before_a_partial_line(self):
        self._append(_read_row(self._path("a.md"), _time(0)), _read_row(self._path("b.md"), _time(1)))
        _, offset = read_loads(self.transcript)
        self.assertEqual(offset, self.transcript.stat().st_size)

        self._append(_read_row(self._path("c.md"), _time(2)))
        size_before_partial = self.transcript.stat().st_size
        with self.transcript.open("a", encoding="utf-8") as file:
            file.write(json.dumps(_read_row(self._path("d.md"), _time(3)), separators=(",", ":")))
        loads, new_offset = read_loads(self.transcript, offset)
        self.assertEqual(loads.paths, {self._path("c.md"): _time(2)})
        self.assertEqual(new_offset, size_before_partial)

        with self.transcript.open("a", encoding="utf-8") as file:
            file.write("\n")
        loads, _ = read_loads(self.transcript, new_offset)
        self.assertEqual(loads.paths, {self._path("d.md"): _time(3)})

    def test_a_path_is_stored_under_its_real_path(self):
        (self.home / "real").mkdir()
        (self.home / "real" / "x.md").write_text("# x\n", encoding="utf-8")
        (self.home / "link").symlink_to(self.home / "real")
        self._append(_read_row(self.home / "link" / "x.md", _time(0)))

        loads, _ = read_loads(self.transcript)

        self.assertEqual(loads.paths, {str(self.home / "real" / "x.md"): _time(0)})

    def test_a_relative_path_is_skipped(self):
        self._append(_read_row("x.md", _time(0)))

        loads, _ = read_loads(self.transcript)

        self.assertEqual(loads.paths, {})


class MachineLoadTimesTests(_TempHomeTests):
    def setUp(self):
        super().setUp()
        self.s1 = self.home / ".claude" / "projects" / "-dev-a" / "s1.jsonl"

    def test_reads_main_and_subagent_transcripts_and_skips_journal(self):
        personal_s2 = self.home / ".claude-personal" / "projects" / "-dev-b" / "s2"
        workflow = personal_s2 / "subagents" / "workflows" / "wf_1"
        _write_rows(self.s1, _read_row(self._path("a.md"), _time(0)))
        _write_rows(personal_s2 / "subagents" / "agent-x.jsonl", _read_row(self._path("b.md"), _time(1)))
        _write_rows(workflow / "agent-y.jsonl", _read_row(self._path("c.md"), _time(2)))
        _write_rows(workflow / "journal.jsonl", _read_row(self._path("d.md"), _time(3)))

        times = machine_load_times(self.env)

        self.assertEqual(times.paths, {self._path("a.md"): _time(0), self._path("b.md"): _time(1),
                                       self._path("c.md"): _time(2)})

    def test_writes_the_cache_with_offsets_and_times(self):
        _write_rows(self.s1, _read_row(self._path("a.md"), _time(0)),
                    _tool_row("Agent", {"subagent_type": "scout"}, _time(1)))

        machine_load_times(self.env)

        self.assertEqual(self._read_cache(), {"version": 1, "transcripts": {str(self.s1): self.s1.stat().st_size},
                                              "paths": {self._path("a.md"): _time(0)},
                                              "names": {"subagent:scout": _time(1)}})

    def test_a_second_run_reads_only_appended_rows(self):
        _write_rows(self.s1, _read_row(self._path("a.md"), _time(0)))
        machine_load_times(self.env)
        size1 = self.s1.stat().st_size
        _write_rows(self.s1, _read_row(self._path("b.md"), _time(1)))

        with mock.patch("loads.read_loads", wraps=loads.read_loads) as reader:
            times = machine_load_times(self.env)

        reader.assert_called_once_with(self.s1, size1)
        self.assertEqual(times.paths, {self._path("a.md"): _time(0), self._path("b.md"): _time(1)})

    def test_a_transcript_shorter_than_its_offset_is_read_from_the_start(self):
        _write_rows(self.s1, _read_row(self._path("a.md"), _time(0)), _read_row(self._path("b.md"), _time(1)))
        machine_load_times(self.env)
        _write_rows(self.s1, _read_row(self._path("z.md"), _time(2)), mode="w")

        with mock.patch("loads.read_loads", wraps=loads.read_loads) as reader:
            times = machine_load_times(self.env)

        reader.assert_called_once_with(self.s1, 0)
        self.assertEqual(times.paths[self._path("z.md")], _time(2))
        self.assertEqual(self._read_cache()["transcripts"], {str(self.s1): self.s1.stat().st_size})

    def test_an_absent_or_corrupt_cache_is_rebuilt(self):
        _write_rows(self.s1, _read_row(self._path("a.md"), _time(0)))
        size = self.s1.stat().st_size
        caches = {
            "none": None,
            "not json": "not json",
            "version 2": json.dumps({"version": 2, "transcripts": {str(self.s1): size}, "paths": {}, "names": {}}),
            "string offset": json.dumps({"version": 1, "transcripts": {str(self.s1): "12"}, "paths": {},
                                         "names": {}}),
            "time with no offset": json.dumps({"version": 1, "transcripts": {str(self.s1): size},
                                               "paths": {self._path("a.md"): "2026-10-01T00:00:00"}, "names": {}}),
        }
        for label, text in caches.items():
            with self.subTest(label):
                self.cache_path.unlink(missing_ok=True)
                if text is not None:
                    self.cache_path.parent.mkdir(parents=True, exist_ok=True)
                    self.cache_path.write_text(text, encoding="utf-8")

                times = machine_load_times(self.env)

                self.assertEqual(times.paths, {self._path("a.md"): _time(0)})
                self.assertEqual(self._read_cache()["version"], 1)

    def test_times_of_a_transcript_gone_from_disk_are_kept(self):
        gone = self.home / ".claude" / "projects" / "-dev-a" / "gone.jsonl"
        self.cache_path.parent.mkdir(parents=True)
        self.cache_path.write_text(json.dumps({"version": 1, "transcripts": {str(gone): 10},
                                               "paths": {"/x": "2026-10-01T00:00:00Z"}, "names": {}}),
                                   encoding="utf-8")

        times = machine_load_times(self.env)

        self.assertEqual(times.paths, {"/x": "2026-10-01T00:00:00Z"})
        self.assertEqual(self._read_cache()["transcripts"], {})

    def test_a_transcript_that_cannot_be_read_is_skipped(self):
        refused = self.home / ".claude" / "projects" / "-dev-a" / "refused.jsonl"
        _write_rows(self.s1, _read_row(self._path("a.md"), _time(0)))
        _write_rows(refused, _read_row(self._path("b.md"), _time(1)))

        with mock.patch("loads.read_loads", side_effect=_refusing_read(refused)):
            times = machine_load_times(self.env)

        self.assertEqual(times.paths, {self._path("a.md"): _time(0)})
        self.assertEqual(self._read_cache()["transcripts"], {str(self.s1): self.s1.stat().st_size})

    def test_a_failed_cache_write_raises_and_leaves_no_temp_file(self):
        _write_rows(self.s1, _read_row(self._path("a.md"), _time(0)))

        with mock.patch("os.replace", side_effect=OSError("disk full")):
            with self.assertRaises(OSError):
                machine_load_times(self.env)

        self.assertFalse(self.cache_path.exists())
        self.assertEqual(list(self.cache_path.parent.glob("*.tmp")), [])


class SessionLoadTimesTests(_TempHomeTests):
    def test_reads_its_transcript_and_its_subagents_only(self):
        project = self.home / ".claude" / "projects" / "-dev-a"
        s1 = project / "s1.jsonl"
        _write_rows(s1, _read_row(self._path("a.md"), _time(0)))
        _write_rows(project / "s1" / "subagents" / "agent-x.jsonl", _read_row(self._path("b.md"), _time(1)))
        _write_rows(project / "s1" / "subagents" / "workflows" / "wf_1" / "journal.jsonl",
                    _read_row(self._path("c.md"), _time(2)))
        _write_rows(project / "s2.jsonl", _read_row(self._path("d.md"), _time(3)))

        times = session_load_times(s1)

        self.assertEqual(times.paths, {self._path("a.md"): _time(0), self._path("b.md"): _time(1)})
        self.assertFalse(self.cache_path.exists())

    def test_a_subagent_transcript_that_cannot_be_read_is_skipped(self):
        project = self.home / ".claude" / "projects" / "-dev-a"
        s1 = project / "s1.jsonl"
        refused = project / "s1" / "subagents" / "agent-x.jsonl"
        _write_rows(s1, _read_row(self._path("a.md"), _time(0)))
        _write_rows(refused, _read_row(self._path("b.md"), _time(1)))

        with mock.patch("loads.read_loads", side_effect=_refusing_read(refused)):
            times = session_load_times(s1)

        self.assertEqual(times.paths, {self._path("a.md"): _time(0)})


class LastLoadedTests(_TempHomeTests):
    def test_a_load_through_a_symlink_matches_the_real_path(self):
        agents_md = self.home / "dev" / "app" / "AGENTS.md"
        agents_md.parent.mkdir(parents=True)
        agents_md.write_text("# Agents\n", encoding="utf-8")
        link = self.home / ".claude" / "CLAUDE.md"
        link.parent.mkdir()
        link.symlink_to(agents_md)
        transcript = self.home / "session.jsonl"
        _write_rows(transcript, _read_row(link, _time(0)))
        times, _ = read_loads(transcript)
        entry = _entry(agents_md, "instructions", walked=((link, Owner("global")),))

        self.assertEqual(last_loaded(self.env, entry, times), _time(0))

    def test_an_installed_copy_gives_its_time_when_it_is_later(self):
        clone_skill = self.home / "dev" / "m" / "plugins" / "p" / "skills" / "k" / "SKILL.md"
        install = self.home / ".claude" / "plugins" / "cache" / "m" / "p" / "1.0.0"
        installed_skill = install / "skills" / "k" / "SKILL.md"
        for path in (clone_skill, installed_skill):
            path.parent.mkdir(parents=True)
            path.write_text("# k\n", encoding="utf-8")
        installed = Installed(Location(str(installed_skill), Owner("plugin", root=str(install), plugin="p@m")),
                              "claude", "1.0.0")
        entry = _entry(clone_skill, "skill", root=self.home / "dev" / "m", plugin="p@m", installed=(installed,))
        times = LoadTimes(paths={str(clone_skill): "2026-10-01T00:00:00Z",
                                 str(installed_skill): "2026-10-02T00:00:00Z"})

        self.assertEqual(last_loaded(self.env, entry, times), "2026-10-02T00:00:00Z")

    def test_a_subagent_and_a_command_match_by_listing_name(self):
        cache = self.home / "cache" / "wigley"
        subagent = _entry(cache / "agents" / "haiku.md", "subagent", source="plugin", root=cache,
                          plugin="wigley@m", meta={"name": "haiku"})
        command = _entry(self.home / ".claude" / "commands" / "sub" / "make.md", "command", source="global")
        plugin_command = _entry(cache / "commands" / "ship.md", "command", source="plugin", root=cache,
                                plugin="wigley@m")
        plain_subagent = _entry(self.home / ".claude" / "agents" / "haiku.md", "subagent", source="global",
                                meta={"name": "haiku"})
        times = LoadTimes(names={"subagent:wigley:haiku": _time(1), "command:make": _time(2),
                                 "command:wigley:ship": _time(3)})

        self.assertEqual(last_loaded(self.env, subagent, times), _time(1))
        self.assertEqual(last_loaded(self.env, command, times), _time(2))
        self.assertEqual(last_loaded(self.env, plugin_command, times), _time(3))
        self.assertIsNone(last_loaded(self.env, plain_subagent, times))

    def test_a_hook_or_plugin_has_no_time_though_its_file_was_read(self):
        settings = self.home / ".claude" / "settings.json"
        install = self.home / ".claude" / "plugins" / "cache" / "m" / "p" / "1.0.0"
        times = LoadTimes(paths={str(settings): _time(0), str(install): _time(1)})

        self.assertIsNone(last_loaded(self.env, _entry(settings, "hook", source="global"), times))
        self.assertIsNone(last_loaded(self.env, _entry(install, "plugin", source="plugin", root=install,
                                                       plugin="p@m"), times))

    def test_an_entry_with_no_load_is_none(self):
        self.assertIsNone(last_loaded(self.env, _entry(self.home / "a.md", "instructions"), LoadTimes()))

    def test_an_item_takes_its_files_time(self):
        followups = self.home / "f.md"
        item = Entry(id=f"{followups}#L10", kind="followup", source="features", repo=None, root=None, plugin=None,
                     path=str(followups), line=10, title="item", meta={})

        self.assertEqual(last_loaded(self.env, item, LoadTimes(paths={str(followups): _time(0)})), _time(0))


if __name__ == "__main__":
    unittest.main()
