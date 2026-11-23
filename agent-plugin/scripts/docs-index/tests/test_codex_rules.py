"""CodexRules on a temp home and temp repos each test builds, with entries
constructed directly from the real paths of the files the test writes."""

import io
import tempfile
import unittest
from contextlib import redirect_stderr
from datetime import datetime, timezone
from pathlib import Path

from codex_rules import CodexRules
from environment import Environment
from model import Entry, Installed, Location, Owner

FIXED_NOW = datetime(2026, 1, 2, 3, 4, 5, tzinfo=timezone.utc)


class CodexRulesTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name).resolve()
        self.home = self.root / "home"
        self.home.mkdir()
        self.repo = self.root / "dev" / "r"
        (self.repo / ".git").mkdir(parents=True)
        self.rules = CodexRules(Environment(home=self.home, now=lambda: FIXED_NOW))

    def _write(self, path, text):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
        return path

    def _codex_config(self, text):
        self._write(self.home / ".codex" / "config.toml", text)

    def _entry(self, path, kind="instructions", source="repo", meta=None, root=None, walked=()):
        """An entry at path, owned by root (the repo by default); walked holds
        (linked path, Owner of the walk) pairs."""
        return Entry(id=str(path), kind=kind, source=source, repo="r", root=str(root or self.repo), plugin=None,
                     path=str(path), line=None, title=path.name, meta=meta or {},
                     walked=tuple(Location(str(linked), owner) for linked, owner in walked))

    def _codex_plugin_skill(self, plugin):
        return self._write(self.home / ".codex" / "plugins" / "cache" / "m" / plugin / "1.0.0" / "skills" / "k"
                           / "SKILL.md", "---\nname: k\n---\n")

    def test_override_wins_its_folder_and_the_root_agents_md_still_loads(self):
        root_agents = self._write(self.repo / "AGENTS.md", "root\n")
        override = self._write(self.repo / "sub" / "AGENTS.override.md", "override\n")
        sub_agents = self._write(self.repo / "sub" / "AGENTS.md", "sub\n")
        entries = [self._entry(root_agents), self._entry(override), self._entry(sub_agents)]

        states = self.rules.states(self.repo / "sub", entries)

        self.assertEqual(states[str(root_agents)].state, "launch")
        self.assertEqual(states[str(override)].state, "launch")
        self.assertEqual(states[str(sub_agents)].state, "not-loaded")

    def test_a_doc_after_the_byte_cap_is_reached_is_not_loaded(self):
        self._codex_config("project_doc_max_bytes = 10\n")
        first = self._write(self.repo / "AGENTS.md", "8 bytes\n")
        second = self._write(self.repo / "a" / "AGENTS.md", "8 bytes\n")
        third = self._write(self.repo / "a" / "b" / "AGENTS.md", "8 bytes\n")
        entries = [self._entry(first), self._entry(second), self._entry(third)]

        states = self.rules.states(self.repo / "a" / "b", entries)

        self.assertEqual(states[str(first)].state, "launch")
        self.assertEqual(states[str(second)].state, "launch")
        self.assertEqual(states[str(third)].state, "not-loaded")
        self.assertEqual(states[str(third)].reason, "past project_doc_max_bytes")

    def test_claude_md_is_a_claude_file(self):
        claude_md = self._write(self.repo / "CLAUDE.md", "claude\n")

        states = self.rules.states(self.repo, [self._entry(claude_md)])

        self.assertEqual(states[str(claude_md)].state, "not-loaded")
        self.assertEqual(states[str(claude_md)].reason, "Claude Code file")

    def test_claude_md_named_as_a_fallback_launches_without_agents_files(self):
        self._codex_config('project_doc_fallback_filenames = ["CLAUDE.md"]\n')
        claude_md = self._write(self.repo / "CLAUDE.md", "claude\n")

        states = self.rules.states(self.repo, [self._entry(claude_md)])

        self.assertEqual(states[str(claude_md)].state, "launch")

    def test_whitespace_only_global_override_falls_through_to_global_agents_md(self):
        override = self._write(self.home / ".codex" / "AGENTS.override.md", " \n\t\n")
        agents = self._write(self.home / ".codex" / "AGENTS.md", "global\n")
        entries = [self._entry(override, source="global"), self._entry(agents, source="global")]

        states = self.rules.states(self.repo, entries)

        self.assertEqual(states[str(agents)].state, "launch")
        self.assertEqual(states[str(override)].state, "not-loaded")

    def test_a_blank_project_override_wins_its_folder_and_loads_nothing(self):
        override = self._write(self.repo / "AGENTS.override.md", "\n")
        agents = self._write(self.repo / "AGENTS.md", "root\n")
        entries = [self._entry(override), self._entry(agents)]

        states = self.rules.states(self.repo, entries)

        self.assertEqual(states[str(override)].state, "not-loaded")
        self.assertEqual(states[str(agents)].state, "not-loaded")
        self.assertIn("AGENTS.override.md wins", states[str(agents)].reason)

    def test_a_fallback_name_holding_a_slash_is_no_candidate(self):
        self._codex_config('project_doc_fallback_filenames = ["docs/GUIDE.md"]\n')
        guide = self._write(self.repo / "docs" / "GUIDE.md", "guide\n")

        states = self.rules.states(self.repo, [self._entry(guide)])

        self.assertEqual(states[str(guide)].state, "not-loaded")

    def test_a_user_skill_linked_into_agents_skills_is_listed(self):
        clone_skill = self._write(self.root / "dotfiles" / "skills" / "s" / "SKILL.md", "---\nname: s\n---\n")
        linked = self.home / ".agents" / "skills" / "s" / "SKILL.md"
        entry = self._entry(clone_skill, kind="skill", source="global", meta={"name": "s"},
                            walked=[(linked, Owner("global"))])

        states = self.rules.states(self.repo, [entry])

        self.assertEqual(states[str(clone_skill)].state, "listed")

    def test_skills_of_enabled_and_disabled_codex_plugins(self):
        self._codex_config('[plugins."on@m"]\nenabled = true\n[plugins."off@m"]\nenabled = false\n')
        on_skill = self._codex_plugin_skill("on")
        off_skill = self._codex_plugin_skill("off")
        entries = [self._entry(skill, kind="skill", source="plugin", meta={"name": "k"}, root=skill.parents[2])
                   for skill in (on_skill, off_skill)]

        states = self.rules.states(self.repo, entries)

        self.assertEqual(states[str(on_skill)].state, "listed")
        self.assertEqual(states[str(off_skill)].state, "not-loaded")
        self.assertIn("off@m", states[str(off_skill)].reason)

    def test_a_disabled_codex_plugins_skill_linked_from_user_agents_skills_is_listed_as_a_user_skill(self):
        self._codex_config('[plugins."off@m"]\nenabled = false\n')
        skill = self._codex_plugin_skill("off")
        linked = self.home / ".agents" / "skills" / "k" / "SKILL.md"
        entry = self._entry(skill, kind="skill", source="plugin", meta={"name": "k"}, root=skill.parents[2],
                            walked=[(linked, Owner("global"))])

        states = self.rules.states(self.repo, [entry])

        self.assertEqual(states[str(skill)].state, "listed")
        self.assertIn(".agents/skills", states[str(skill)].reason)

    def test_skills_config_disables_a_repo_skill_by_its_skill_md_path(self):
        skill = self._write(self.repo / ".agents" / "skills" / "s" / "SKILL.md", "---\nname: s\n---\n")
        self._codex_config(f'[[skills.config]]\npath = "{skill}"\nenabled = false\n')
        entry = self._entry(skill, kind="skill", meta={"name": "s"})

        states = self.rules.states(self.repo, [entry])

        self.assertEqual(states[str(skill)].state, "not-loaded")
        self.assertIn("skills.config", states[str(skill)].reason)

    def test_empty_global_override_falls_through_to_global_agents_md(self):
        override = self._write(self.home / ".codex" / "AGENTS.override.md", "")
        agents = self._write(self.home / ".codex" / "AGENTS.md", "global\n")
        entries = [self._entry(override, source="global"), self._entry(agents, source="global")]

        states = self.rules.states(self.repo, entries)

        self.assertEqual(states[str(agents)].state, "launch")
        self.assertEqual(states[str(override)].state, "not-loaded")

    def test_repo_skill_without_implicit_invocation_is_on_demand(self):
        skill = self._write(self.repo / ".agents" / "skills" / "s" / "SKILL.md", "---\nname: s\n---\n")
        entry = self._entry(skill, kind="skill", meta={"name": "s", "implicitInvocation": False})

        states = self.rules.states(self.repo, [entry])

        self.assertEqual(states[str(skill)].state, "on-demand")

    def test_skills_config_path_with_tilde_disables_a_skill_under_the_home(self):
        skill = self._write(self.home / ".agents" / "skills" / "s" / "SKILL.md", "---\nname: s\n---\n")
        self._codex_config('[[skills.config]]\npath = "~/.agents/skills/s"\nenabled = false\n')
        entry = self._entry(skill, kind="skill", source="global", meta={"name": "s"})

        states = self.rules.states(self.repo, [entry])

        self.assertEqual(states[str(skill)].state, "not-loaded")

    def test_config_values_of_the_wrong_shape_take_their_defaults(self):
        self._codex_config('project_doc_max_bytes = "32k"\nproject_doc_fallback_filenames = "CLAUDE.md"\n'
                           'skills = "none"\n')
        agents = self._write(self.repo / "AGENTS.md", "root\n")
        claude_md = self._write(self.repo / "CLAUDE.md", "claude\n")
        entries = [self._entry(agents), self._entry(claude_md)]

        with redirect_stderr(io.StringIO()) as err:
            states = self.rules.states(self.repo, entries)

        self.assertEqual(states[str(agents)].state, "launch")
        self.assertEqual(states[str(claude_md)].reason, "Claude Code file")
        for key in ("project_doc_max_bytes", "project_doc_fallback_filenames", "skills"):
            self.assertIn(key, err.getvalue())

    def test_user_skill_is_listed_from_a_folder_outside_any_repo(self):
        skill = self._write(self.home / ".agents" / "skills" / "s" / "SKILL.md", "---\nname: s\n---\n")
        outside = self.root / "loose"
        outside.mkdir()
        entry = self._entry(skill, kind="skill", source="global", meta={"name": "s"})

        states = self.rules.states(outside, [entry])

        self.assertEqual(states[str(skill)].state, "listed")

    def test_a_codex_plugin_skill_file_is_not_loaded_on_a_pointer(self):
        install = self.home / ".codex" / "plugins" / "cache" / "m" / "p" / "1.0.0"
        skill_file = self._write(install / "skills" / "k" / "ref.md", "# ref\n")
        entry = self._entry(skill_file, kind="skill-file", source="plugin", root=install)

        state = self.rules.states(self.repo, [entry])[str(skill_file)]

        self.assertEqual((state.state, state.reason), ("not-loaded", "agents read skill files on a pointer"))

    def _merged_clone_skill(self):
        """A marketplace clone's skill whose copy sits in Codex install p@m."""
        installed_skill = self._codex_plugin_skill("p")
        install = installed_skill.parents[2]
        clone_skill = self._write(self.root / "clone" / "plugins" / "p" / "skills" / "k" / "SKILL.md",
                                  "---\nname: k\n---\n")
        copy = Installed(Location(str(installed_skill), Owner("plugin", root=str(install), plugin="p@m")),
                         "codex", "1.0.0")
        return Entry(id=str(clone_skill), kind="skill", source="repo", repo="clone", root=str(self.root / "clone"),
                     plugin="p@m", path=str(clone_skill), line=None, title=clone_skill.name, meta={"name": "k"},
                     installed=(copy,)), installed_skill

    def test_a_merged_clone_skill_is_listed_through_its_enabled_codex_install(self):
        self._codex_config('[plugins."p@m"]\nenabled = true\n')
        entry, _ = self._merged_clone_skill()

        state = self.rules.states(self.repo, [entry])[entry.id]

        self.assertEqual((state.state, state.reason), ("listed", "skill of enabled plugin p@m"))

    def test_skills_config_disables_a_merged_skill_by_its_installed_path(self):
        entry, installed_skill = self._merged_clone_skill()
        self._codex_config(f'[plugins."p@m"]\nenabled = true\n'
                           f'[[skills.config]]\npath = "{installed_skill.as_posix()}"\nenabled = false\n')

        state = self.rules.states(self.repo, [entry])[entry.id]

        self.assertEqual(state.state, "not-loaded")

    def test_a_file_in_a_claude_config_dir_is_a_claude_file(self):
        personal = self.home / ".claude-personal"
        rule = self._write(personal / "rules" / "r.md", "# rule\n")
        entry = Entry(id=str(rule), kind="rule", source="global", repo=None, root=None, plugin=None,
                      path=str(rule), line=None, title=rule.name, meta={})
        rules = CodexRules(Environment(home=self.home, now=lambda: FIXED_NOW, claude_config_dirs=(personal,)))

        state = rules.states(self.repo, [entry])[str(rule)]

        self.assertEqual((state.state, state.reason), ("not-loaded", "Claude Code file"))


if __name__ == "__main__":
    unittest.main()
