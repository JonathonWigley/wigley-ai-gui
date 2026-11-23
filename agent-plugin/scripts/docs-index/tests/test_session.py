"""read_session and session_context on transcripts each test writes into
a Claude config folder's projects/<slug>/ in its own temp home, ~/.claude
unless the test names another."""

import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

from environment import Environment
from model import Entry
from session import SessionNotFound, read_session, session_context

SESSION_ID = "3f1c2a7e-session"


def _entry(path, kind, source="repo", repo="app", root=None, plugin=None, title=None, meta=None):
    return Entry(
        id=str(path), kind=kind, source=source, repo=repo, root=root, plugin=plugin,
        path=str(path), line=None, title=title or Path(path).name, meta=meta or {},
    )


class SessionTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.home = Path(tmp.name).resolve()
        self.env = Environment(home=self.home, now=lambda: datetime(2026, 10, 19, tzinfo=timezone.utc))
        self.repo = self.home / "dev" / "app"
        self.repo.mkdir(parents=True)

    def _write_transcript(self, lines, config_dir=None):
        folder = (config_dir or self.home / ".claude") / "projects" / "-dev-app"
        folder.mkdir(parents=True, exist_ok=True)
        (folder / f"{SESSION_ID}.jsonl").write_text("\n".join(lines) + "\n", encoding="utf-8")

    @staticmethod
    def _attachment(attachment):
        return json.dumps({"type": "attachment", "attachment": attachment})

    def test_records_launch_on_demand_and_listed_entries_from_the_transcript(self):
        a_md, b_md, c_md = (self.repo / "A.md", self.repo / "sub" / "B.md", self.repo / "deep" / "C.md")
        c_md.parent.mkdir()
        c_md.write_text("# Deep notes\n", encoding="utf-8")
        self._write_transcript([
            json.dumps({"type": "user", "cwd": str(self.repo)}),
            self._attachment({"type": "instructions", "files": [{"path": str(a_md)}]}),
            self._attachment({"type": "instructions", "files": [{"path": str(b_md)}]}),
            self._attachment({"type": "nested_memory", "path": str(c_md)}),
            self._attachment({"type": "skill_listing", "names": ["wigley:feature", "docs"]}),
            self._attachment({"type": "agent_listing_delta", "addedTypes": ["wigley:haiku"]}),
        ])
        plugin_root = str(self.home / "cache" / "wigley")
        entries = [
            _entry(a_md, "instructions", root=str(self.repo)),
            _entry(b_md, "instructions", root=str(self.repo)),
            _entry(Path(plugin_root) / "skills" / "feature" / "SKILL.md", "skill", source="plugin", repo=None,
                   root=plugin_root, plugin="wigley@wigley-ai-marketplace", title="feature",
                   meta={"name": "feature"}),
            _entry(self.repo / ".claude" / "skills" / "docs" / "SKILL.md", "skill", root=str(self.repo),
                   title="docs", meta={"name": "docs"}),
            _entry(Path(plugin_root) / "agents" / "haiku.md", "subagent", source="plugin", repo=None,
                   root=plugin_root, plugin="wigley@wigley-ai-marketplace", title="haiku",
                   meta={"name": "haiku"}),
            _entry(self.repo / ".claude" / "rules" / "style.md", "rule", root=str(self.repo)),
        ]

        context, new_entries = session_context(self.env, read_session(self.env, SESSION_ID), entries, entries)

        states = {entry_id: by_harness["claude"].state for entry_id, by_harness in context.states.items()}
        self.assertEqual(states[str(a_md)], "launch")
        self.assertEqual(states[str(b_md)], "on-demand")
        self.assertEqual(states[str(c_md)], "on-demand")
        self.assertEqual(states[entries[2].id], "listed")
        self.assertEqual(states[entries[3].id], "listed")
        self.assertEqual(states[entries[4].id], "listed")
        self.assertEqual(states[entries[5].id], "not-loaded")
        self.assertEqual(context.folder, str(self.repo))
        self.assertEqual(context.session_id, SESSION_ID)
        self.assertEqual([entry.id for entry in new_entries], [str(c_md)])
        self.assertEqual(new_entries[0].kind, "instructions")
        self.assertEqual((new_entries[0].source, new_entries[0].root), ("repo", str(self.repo)))
        self.assertEqual(new_entries[0].title, "Deep notes")

    def test_leaves_hook_entries_out_of_the_context(self):
        self._write_transcript([json.dumps({"type": "user", "cwd": str(self.repo)})])
        hook = Entry(
            id=f"{self.repo}/.claude/settings.json#hook:PreToolUse:0", kind="hook", source="repo", repo="app",
            root=str(self.repo), plugin=None, path=f"{self.repo}/.claude/settings.json", line=None,
            title="PreToolUse", meta={},
        )

        context, _ = session_context(self.env, read_session(self.env, SESSION_ID), [hook], [hook])

        self.assertNotIn(hook.id, context.states)

    def test_command_matches_the_listing_by_its_file_name(self):
        self._write_transcript([
            json.dumps({"type": "user", "cwd": str(self.repo)}),
            self._attachment({"type": "skill_listing", "names": ["init", "wigley:ship"]}),
        ])
        plugin_root = str(self.home / "cache" / "wigley")
        repo_command = _entry(self.repo / ".claude" / "commands" / "init.md", "command", root=str(self.repo),
                              title="Initialise the project")
        plugin_command = _entry(Path(plugin_root) / "commands" / "ship.md", "command", source="plugin", repo=None,
                                root=plugin_root, plugin="wigley@wigley-ai-marketplace", title="Ship it")
        entries = [repo_command, plugin_command]

        context, _ = session_context(self.env, read_session(self.env, SESSION_ID), entries, entries)

        self.assertEqual(context.states[repo_command.id]["claude"].state, "listed")
        self.assertEqual(context.states[plugin_command.id]["claude"].state, "listed")

    def test_states_only_the_reaching_entries_and_the_loaded_files(self):
        loaded = self.repo / "deep" / "C.md"
        self._write_transcript([
            json.dumps({"type": "user", "cwd": str(self.repo)}),
            self._attachment({"type": "nested_memory", "path": str(loaded)}),
        ])
        reaching = _entry(self.repo / "AGENTS.md", "instructions", root=str(self.repo))
        elsewhere = _entry(self.home / "dev" / "other" / "AGENTS.md", "instructions", repo="other",
                           root=str(self.home / "dev" / "other"))

        context, _ = session_context(self.env, read_session(self.env, SESSION_ID), [reaching, elsewhere], [reaching])

        self.assertEqual(set(context.states), {reaching.id, str(loaded)})

    def test_states_a_loaded_entry_outside_the_reaching_entries(self):
        other = self.home / "dev" / "other"
        loaded = _entry(other / "AGENTS.md", "instructions", repo="other", root=str(other))
        self._write_transcript([
            json.dumps({"type": "user", "cwd": str(self.repo)}),
            self._attachment({"type": "nested_memory", "path": loaded.path}),
        ])

        context, new_entries = session_context(self.env, read_session(self.env, SESSION_ID), [loaded], [])

        self.assertEqual(context.states[loaded.id]["claude"].state, "on-demand")
        self.assertEqual(new_entries, [])

    def test_folder_is_the_real_path_of_the_cwd(self):
        link = self.home / "link-to-app"
        link.symlink_to(self.repo)
        self._write_transcript([json.dumps({"type": "user", "cwd": str(link)})])

        self.assertEqual(read_session(self.env, SESSION_ID).folder, self.repo)

    def test_read_session_names_its_transcript(self):
        self._write_transcript([json.dumps({"type": "user", "cwd": str(self.repo)})])

        self.assertEqual(read_session(self.env, SESSION_ID).transcript,
                         self.home / ".claude" / "projects" / "-dev-app" / f"{SESSION_ID}.jsonl")

    def test_unknown_session_id_raises_naming_the_id(self):
        self._write_transcript([json.dumps({"type": "user", "cwd": str(self.repo)})])

        with self.assertRaises(SessionNotFound) as raised:
            read_session(self.env, "no-such-session")

        self.assertIn("no-such-session", str(raised.exception))

    def test_transcript_without_a_cwd_raises_naming_the_id(self):
        self._write_transcript([self._attachment({"type": "nested_memory", "path": str(self.repo / "A.md")})])

        with self.assertRaises(SessionNotFound) as raised:
            read_session(self.env, SESSION_ID)

        self.assertIn(SESSION_ID, str(raised.exception))

    def test_skips_a_malformed_line_between_valid_rows(self):
        a_md = self.repo / "A.md"
        self._write_transcript([
            '{"type": "user", "cwd": ',
            json.dumps({"type": "user", "cwd": str(self.repo)}),
            "not json at all",
            self._attachment({"type": "instructions", "files": [{"path": str(a_md)}]}),
        ])
        entry = _entry(a_md, "instructions", root=str(self.repo))

        context, _ = session_context(self.env, read_session(self.env, SESSION_ID), [entry], [entry])

        self.assertEqual(context.folder, str(self.repo))
        self.assertEqual(context.states[entry.id]["claude"].state, "launch")


    def _two_folder_env(self, *config_dirs):
        return Environment(home=self.home, now=lambda: datetime(2026, 10, 19, tzinfo=timezone.utc),
                           claude_config_dirs=config_dirs)

    def test_finds_the_transcript_in_a_later_config_dir(self):
        personal, claude = self.home / ".claude-personal", self.home / ".claude"
        self._write_transcript([json.dumps({"type": "user", "cwd": str(self.repo)})], config_dir=personal)

        session = read_session(self._two_folder_env(claude, personal), SESSION_ID)

        self.assertEqual(session.config_dir, personal)
        self.assertEqual(session.folder, self.repo)

    def test_the_first_config_dir_holding_the_transcript_wins(self):
        personal, claude = self.home / ".claude-personal", self.home / ".claude"
        for config_dir in (claude, personal):
            self._write_transcript([json.dumps({"type": "user", "cwd": str(self.repo)})], config_dir=config_dir)

        session = read_session(self._two_folder_env(claude, personal), SESSION_ID)

        self.assertEqual(session.config_dir, claude)

    def test_unknown_session_names_every_projects_folder(self):
        personal, claude = self.home / ".claude-personal", self.home / ".claude"

        with self.assertRaises(SessionNotFound) as raised:
            read_session(self._two_folder_env(claude, personal), SESSION_ID)

        self.assertIn(str(claude / "projects"), str(raised.exception))
        self.assertIn(str(personal / "projects"), str(raised.exception))

    def test_a_synced_skill_matches_its_listing_in_the_judged_config_dir(self):
        personal, claude = self.home / ".claude-personal", self.home / ".claude"
        self._write_transcript([
            json.dumps({"type": "user", "cwd": str(self.repo)}),
            self._attachment({"type": "skill_listing", "names": ["anthropic-skills:x"]}),
        ], config_dir=personal)
        skill = _entry(personal / "skills" / "synced" / "b" / "x" / "SKILL.md", "skill", source="global",
                       repo=None, meta={"name": "x"})
        env = self._two_folder_env(personal, claude)

        context, _ = session_context(env, read_session(env, SESSION_ID), [skill], [skill])

        self.assertEqual(context.states[skill.id]["claude"].state, "listed")

    def _cache_path(self, tail, config_dir=None):
        return f"{config_dir or self.home / '.claude'}/plugins/cache/{tail}"

    def _windows_cache_path_transcript(self):
        cache = str(self.home / ".claude").replace("/", "\\") + "\\plugins\\cache\\wigley-ai-marketplace\\wigley"
        self._write_transcript([json.dumps({
            "type": "user", "cwd": str(self.repo),
            "message": f"Base directory for this skill: {cache}\\1.9.1\\skills\\feature",
        })])

    def test_loaded_plugins_read_a_json_escaped_windows_cache_path(self):
        self._windows_cache_path_transcript()

        session = read_session(self.env, SESSION_ID)

        self.assertEqual(session.loaded_plugins, {"wigley@wigley-ai-marketplace": "1.9.1"})

    def test_loaded_plugins_read_a_slash_path_and_keep_the_last_version(self):
        self._write_transcript([
            json.dumps({"type": "user", "cwd": str(self.repo), "message": self._cache_path("m/p/1.0.0/skills/k/SKILL.md")}),
            json.dumps({"type": "user", "message": self._cache_path("m/q/2.0.0")}),
            json.dumps({"type": "user", "message": self._cache_path("m/p/1.1.0/agents/a.md")}),
        ])

        session = read_session(self.env, SESSION_ID)

        self.assertEqual(session.loaded_plugins, {"p@m": "1.1.0", "q@m": "2.0.0"})

    def test_loaded_plugins_match_a_later_config_dir(self):
        claude, personal = self.home / ".claude", self.home / ".claude-personal"
        self._write_transcript([
            json.dumps({"type": "user", "cwd": str(self.repo), "message": self._cache_path("m/p/3.0.0/x", personal)}),
        ])

        session = read_session(self._two_folder_env(claude, personal), SESSION_ID)

        self.assertEqual(session.loaded_plugins, {"p@m": "3.0.0"})

    def test_loaded_plugins_skip_a_cache_path_with_no_version(self):
        self._write_transcript([json.dumps({"type": "user", "cwd": str(self.repo), "message": self._cache_path("m/p")})])

        session = read_session(self.env, SESSION_ID)

        self.assertEqual(session.loaded_plugins, {})

    def test_loaded_plugins_end_a_version_on_a_letter_or_digit(self):
        self._write_transcript([
            json.dumps({"type": "user", "cwd": str(self.repo), "message": f"see {self._cache_path('m/p/1.9.1')}."}),
        ])

        session = read_session(self.env, SESSION_ID)

        self.assertEqual(session.loaded_plugins, {"p@m": "1.9.1"})

    def test_loaded_plugins_scan_a_line_that_is_not_json(self):
        self._write_transcript([
            json.dumps({"type": "user", "cwd": str(self.repo)}),
            f"not json {self._cache_path('m/p/1.0.0/x')}",
            self._attachment({"type": "skill_listing", "names": ["docs"]}),
        ])

        session = read_session(self.env, SESSION_ID)

        self.assertEqual(session.loaded_plugins, {"p@m": "1.0.0"})

    def test_session_context_carries_loaded_plugins(self):
        self._windows_cache_path_transcript()

        context, _ = session_context(self.env, read_session(self.env, SESSION_ID), [], [])

        self.assertEqual(context.to_json()["loadedPlugins"], {"wigley@wigley-ai-marketplace": "1.9.1"})

        self._write_transcript([json.dumps({"type": "user", "cwd": str(self.repo)})])

        context, _ = session_context(self.env, read_session(self.env, SESSION_ID), [], [])

        self.assertEqual(context.to_json()["loadedPlugins"], {})

    def test_a_clone_plugin_skill_matches_only_its_plugin_listing_name(self):
        skill = _entry(self.repo / "plugins" / "wigley" / "skills" / "feature" / "SKILL.md", "skill",
                       root=str(self.repo), plugin="wigley@m", meta={"name": "feature"})
        expected = {"feature": ("not-loaded", "not in this session's transcript"),
                    "wigley:feature": ("listed", "in the session's skill listing")}
        for listed_name, (state, reason) in expected.items():
            with self.subTest(listed_name=listed_name):
                self._write_transcript([
                    json.dumps({"type": "user", "cwd": str(self.repo)}),
                    self._attachment({"type": "skill_listing", "names": [listed_name]}),
                ])

                context, _ = session_context(self.env, read_session(self.env, SESSION_ID), [skill], [skill])

                self.assertEqual((context.states[skill.id]["claude"].state, context.states[skill.id]["claude"].reason),
                                 (state, reason))


if __name__ == "__main__":
    unittest.main()
