"""ClaudeRules on homes and repos each test builds in its own temp folder,
with entries built directly rather than through discovery."""

import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

from claude_rules import ClaudeRules
from environment import Environment
from model import Entry, Installed, Location, Owner

FIXED_NOW = datetime(2026, 1, 2, 3, 4, 5, tzinfo=timezone.utc)


def _entry(path, kind, source="repo", root=None, plugin=None, meta=None, walked=(), installed=()):
    """An entry at path; walked holds (linked path, Owner of the walk) pairs."""
    return Entry(id=str(path), kind=kind, source=source, repo=None, root=str(root) if root else None,
                 plugin=plugin, path=str(path), line=None, title=path.name, meta=meta or {},
                 walked=tuple(Location(str(linked), owner) for linked, owner in walked), installed=tuple(installed))


class ClaudeRulesTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name).resolve()
        self.home = self.root / "home"
        self.home.mkdir()
        self.rules = ClaudeRules(Environment(home=self.home, now=lambda: FIXED_NOW))

    def _write(self, path, text="# doc\n"):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
        return path

    def _write_json(self, path, data):
        return self._write(path, json.dumps(data))

    def _repo(self, name):
        repo = self.root / name
        (repo / ".git").mkdir(parents=True)
        return repo

    def test_agents_md_is_shadowed_by_a_dot_claude_claude_md(self):
        repo = self._repo("r")
        agents = self._write(repo / "AGENTS.md")
        self._write(repo / ".claude" / "CLAUDE.md")

        states = self.rules.states(repo, [_entry(agents, "instructions")])

        self.assertEqual(states[str(agents)].state, "shadowed")
        self.assertIn(str(repo / ".claude" / "CLAUDE.md"), states[str(agents)].reason)

    def test_agents_md_launches_beside_claude_md_when_both_are_read(self):
        repo = self._repo("r")
        agents = self._write(repo / "AGENTS.md")
        self._write(repo / ".claude" / "CLAUDE.md")
        self._write_json(self.home / ".claude" / "settings.json", {"pluginConfigs": {
            "cc-plugin-agents-md@builtin": {"options": {"instructionFiles": "claude-md-and-agents-md"}},
        }})

        states = self.rules.states(repo, [_entry(agents, "instructions")])

        self.assertEqual(states[str(agents)].state, "launch")

    def test_agents_md_launches_in_the_folder_and_loads_on_demand_below_it(self):
        repo = self._repo("r")
        top = self._write(repo / "AGENTS.md")
        nested = self._write(repo / "sub" / "AGENTS.md")

        states = self.rules.states(repo, [_entry(top, "instructions"), _entry(nested, "instructions")])

        self.assertEqual(states[str(top)].state, "launch")
        self.assertEqual(states[str(nested)].state, "on-demand")
        self.assertIn(str(repo / "sub"), states[str(nested)].reason)

    def test_a_file_imported_by_the_user_claude_md_launches(self):
        user_file = self._write(self.home / ".claude" / "CLAUDE.md")
        imported = self._write(self.home / "wigley-agents" / "AGENTS.md")
        folder = self.root / "scratch"
        folder.mkdir()
        entries = [
            _entry(user_file, "instructions", source="global", meta={"imports": [str(imported)]}),
            _entry(imported, "instructions", source="global", meta={"imports": []}),
        ]

        states = self.rules.states(folder, entries)

        self.assertEqual(states[str(user_file)].state, "launch")
        self.assertEqual(states[str(imported)].state, "launch")
        self.assertIn(str(user_file), states[str(imported)].reason)

    def test_an_agents_skill_without_a_claude_skills_link_is_not_loaded(self):
        repo = self._repo("r")
        skill = self._write(repo / ".agents" / "skills" / "s" / "SKILL.md")

        states = self.rules.states(repo, [_entry(skill, "skill")])

        self.assertEqual(states[str(skill)].state, "not-loaded")
        self.assertIn(".agents/skills", states[str(skill)].reason)

    def test_an_agents_skill_is_listed_through_a_claude_skills_link(self):
        repo = self._repo("r")
        skill = self._write(repo / ".agents" / "skills" / "s" / "SKILL.md")
        linked = repo / ".claude" / "skills" / "s" / "SKILL.md"

        states = self.rules.states(repo, [_entry(skill, "skill", walked=[(linked, Owner("repo", root=str(repo)))])])

        self.assertEqual(states[str(skill)].state, "listed")

    def test_a_user_claude_md_linked_from_a_dotfiles_clone_launches_with_its_import(self):
        dotfiles = self._write(self.root / "dotfiles" / "CLAUDE.md")
        imported = self._write(self.root / "dotfiles" / "shared.md")
        folder = self.root / "scratch"
        folder.mkdir()
        entries = [
            _entry(dotfiles, "instructions", source="global", meta={"imports": [str(imported)]},
                   walked=[(self.home / ".claude" / "CLAUDE.md", Owner("global"))]),
            _entry(imported, "instructions", source="global", meta={"imports": []}),
        ]

        states = self.rules.states(folder, entries)

        self.assertEqual(states[str(dotfiles)].state, "launch")
        self.assertEqual(states[str(imported)].state, "launch")

    def test_subagents_and_commands_are_listed_in_the_user_and_repo_claude_folders(self):
        repo = self._repo("r")
        user_agent = self._write(self.home / ".claude" / "agents" / "a.md")
        repo_command = self._write(repo / ".claude" / "commands" / "git" / "commit.md")
        other_agent = self._write(self.root / "elsewhere" / ".claude" / "agents" / "b.md")
        entries = [_entry(user_agent, "subagent", source="global"), _entry(repo_command, "command"),
                   _entry(other_agent, "subagent")]

        states = self.rules.states(repo, entries)

        self.assertEqual(states[str(user_agent)].state, "listed")
        self.assertEqual(states[str(repo_command)].state, "listed")
        self.assertEqual(states[str(other_agent)].state, "not-loaded")

    def test_hooks_launch_from_the_folders_settings_files_and_an_enabled_plugin(self):
        repo = self._repo("r")
        other = self._repo("o")
        user_settings = self._write_json(self.home / ".claude" / "settings.json", {"enabledPlugins": {"p@m": True}})
        local_settings = self._write_json(repo / ".claude" / "settings.local.json", {})
        other_settings = self._write_json(other / ".claude" / "settings.json", {})
        install = self.root / "cache" / "m" / "p" / "1.0.0"
        plugin_hooks = self._write_json(install / "hooks" / "hooks.json", {})
        self._write_json(self.home / ".claude" / "plugins" / "installed_plugins.json", {"plugins": {
            "p@m": [{"scope": "user", "installPath": str(install), "version": "1.0.0"}],
        }})
        entries = [
            _entry(user_settings, "hook", source="global"),
            _entry(local_settings, "hook"),
            _entry(other_settings, "hook"),
            _entry(plugin_hooks, "hook", source="plugin", root=install, plugin="p@m"),
        ]

        states = self.rules.states(repo, entries)

        self.assertEqual(states[str(user_settings)].state, "launch")
        self.assertEqual(states[str(local_settings)].state, "launch")
        self.assertEqual(states[str(other_settings)].state, "not-loaded")
        self.assertEqual(states[str(plugin_hooks)].state, "launch")

    def test_a_rule_with_paths_loads_on_demand_and_one_without_launches(self):
        repo = self._repo("r")
        scoped = self._write(repo / ".claude" / "rules" / "scoped.md")
        unscoped = self._write(repo / ".claude" / "rules" / "unscoped.md")
        entries = [_entry(scoped, "rule", meta={"paths": ["src/**"]}), _entry(unscoped, "rule", meta={"paths": []})]

        states = self.rules.states(repo, entries)

        self.assertEqual(states[str(scoped)].state, "on-demand")
        self.assertEqual(states[str(unscoped)].state, "launch")
        self.assertIn("paths", states[str(unscoped)].reason)

    def test_a_disabled_plugins_hooks_are_not_loaded(self):
        repo = self._repo("r")
        self._write_json(self.home / ".claude" / "settings.json", {"enabledPlugins": {"p@m": False}})
        install = self.root / "cache" / "m" / "p" / "1.0.0"
        plugin_hooks = self._write_json(install / "hooks" / "hooks.json", {})
        self._write_json(self.home / ".claude" / "plugins" / "installed_plugins.json", {"plugins": {
            "p@m": [{"scope": "user", "installPath": str(install), "version": "1.0.0"}],
        }})

        states = self.rules.states(repo, [_entry(plugin_hooks, "hook", source="plugin", root=install, plugin="p@m")])

        self.assertEqual(states[str(plugin_hooks)].state, "not-loaded")

    def test_a_project_scoped_plugin_is_listed_only_in_its_project(self):
        repo_a = self._repo("a")
        repo_b = self._repo("b")
        install = self.root / "cache" / "m" / "p" / "1.0.0"
        skill = self._write(install / "skills" / "s" / "SKILL.md")
        self._write_json(self.home / ".claude" / "plugins" / "installed_plugins.json", {"plugins": {
            "p@m": [{"scope": "project", "projectPath": str(repo_a), "installPath": str(install), "version": "1.0.0"}],
        }})
        self._write_json(repo_a / ".claude" / "settings.json", {"enabledPlugins": {"p@m": True}})
        entries = [_entry(skill, "skill", source="plugin", root=install, plugin="p@m")]

        in_a = self.rules.states(repo_a, entries)
        in_b = self.rules.states(repo_b, entries)

        self.assertEqual(in_a[str(skill)].state, "listed")
        self.assertEqual(in_b[str(skill)].state, "not-loaded")
        self.assertIn("p@m", in_b[str(skill)].reason)

    def test_a_skill_file_is_not_loaded_on_a_pointer(self):
        repo = self._repo("r")
        repo_file = self._write(repo / ".claude" / "skills" / "s" / "ref.md")
        user_file = self._write(self.home / ".claude" / "skills" / "s" / "ref.md")
        entries = [_entry(repo_file, "skill-file"), _entry(user_file, "skill-file", source="global")]

        states = self.rules.states(repo, entries)

        for path in (repo_file, user_file):
            with self.subTest(path=path):
                self.assertEqual((states[str(path)].state, states[str(path)].reason),
                                 ("not-loaded", "agents read skill files on a pointer"))

    def test_a_skill_file_an_import_reaches_takes_its_importers_state(self):
        user_claude_md = self._write(self.home / ".claude" / "CLAUDE.md")
        skill_file = self._write(self.home / ".claude" / "skills" / "s" / "ref.md")
        entries = [
            _entry(user_claude_md, "instructions", source="global", meta={"imports": [str(skill_file)]}),
            _entry(skill_file, "skill-file", source="global"),
        ]

        states = self.rules.states(self._repo("r"), entries)

        self.assertEqual((states[str(skill_file)].state, states[str(skill_file)].reason),
                         ("launch", f"imported by {user_claude_md}"))

    def _merged_clone_skill(self, enabled):
        """A marketplace clone's skill whose copy sits in install p@m, enabled or not in the user settings."""
        install = self.root / "cache" / "m" / "p" / "1.0.0"
        installed_skill = self._write(install / "skills" / "k" / "SKILL.md")
        self._write_json(self.home / ".claude" / "plugins" / "installed_plugins.json", {"plugins": {
            "p@m": [{"scope": "user", "installPath": str(install), "version": "1.0.0"}],
        }})
        self._write_json(self.home / ".claude" / "settings.json", {"enabledPlugins": {"p@m": enabled}})
        clone_skill = self._write(self.root / "clone" / "plugins" / "p" / "skills" / "k" / "SKILL.md")
        copy = Installed(Location(str(installed_skill), Owner("plugin", root=str(install), plugin="p@m")),
                         "claude", "1.0.0")
        return _entry(clone_skill, "skill", plugin="p@m", installed=[copy])

    def test_a_merged_clone_skill_is_listed_through_its_enabled_install(self):
        entry = self._merged_clone_skill(enabled=True)

        state = self.rules.states(self._repo("r"), [entry])[entry.id]

        self.assertEqual((state.state, state.reason), ("listed", "skill of enabled plugin p@m"))

    def test_a_merged_clone_skill_of_a_disabled_install_is_not_loaded(self):
        entry = self._merged_clone_skill(enabled=False)

        state = self.rules.states(self._repo("r"), [entry])[entry.id]

        self.assertEqual(state.state, "not-loaded")

    def _personal_first_rules(self):
        """ClaudeRules over ~/.claude-personal then ~/.claude, so ~/.claude-personal is judged."""
        config_dirs = (self.home / ".claude-personal", self.home / ".claude")
        return ClaudeRules(Environment(home=self.home, now=lambda: FIXED_NOW, claude_config_dirs=config_dirs))

    def test_files_of_the_judged_config_dir_load_as_user_files(self):
        personal = self.home / ".claude-personal"
        skill = self._write(personal / "skills" / "s" / "SKILL.md")
        expected = {
            self._write(personal / "CLAUDE.md"): ("instructions", "launch",
                                                  "user instructions file ~/.claude-personal/CLAUDE.md"),
            self._write(personal / "rules" / "r.md"): ("rule", "launch", "rule in ~/.claude-personal/rules without paths:"),
            skill: ("skill", "listed", f"user skill in {personal / 'skills' / 's'}"),
            self._write(personal / "agents" / "a.md"): ("subagent", "listed", "user file in ~/.claude-personal/agents"),
            self._write(personal / "commands" / "c.md"): ("command", "listed",
                                                          "user file in ~/.claude-personal/commands"),
        }
        entries = [_entry(path, kind, source="global") for path, (kind, _, _) in expected.items()]

        states = self._personal_first_rules().states(self._repo("r"), entries)

        for path, (_, state, reason) in expected.items():
            with self.subTest(path=path):
                self.assertEqual((states[str(path)].state, states[str(path)].reason), (state, reason))

    def test_files_of_another_config_dir_are_not_loaded(self):
        claude = self.home / ".claude"
        files = {
            self._write(claude / "CLAUDE.md"): "instructions",
            self._write(claude / "rules" / "r.md"): "rule",
            self._write(claude / "skills" / "s" / "SKILL.md"): "skill",
        }
        entries = [_entry(path, kind, source="global") for path, kind in files.items()]

        states = self._personal_first_rules().states(self._repo("r"), entries)

        for path in files:
            with self.subTest(path=path):
                self.assertEqual((states[str(path)].state, states[str(path)].reason), (
                    "not-loaded", "in Claude config folder ~/.claude; states are judged against ~/.claude-personal"))

    def test_another_config_dirs_claude_md_shadows_no_agents_md(self):
        self._write(self.home / ".claude" / "CLAUDE.md")
        repo = self.home / "dev" / "r"
        (repo / ".git").mkdir(parents=True)
        agents = self._write(repo / "AGENTS.md")

        states = self._personal_first_rules().states(repo, [_entry(agents, "instructions")])

        self.assertEqual(states[str(agents)].state, "launch")

    def test_an_unconfigured_home_claude_md_is_a_user_file_of_another_config_dir(self):
        claude_md = self._write(self.home / ".claude" / "CLAUDE.md")
        repo = self.home / "dev" / "r"
        (repo / ".git").mkdir(parents=True)
        agents = self._write(repo / "AGENTS.md")
        env = Environment(home=self.home, now=lambda: FIXED_NOW, claude_config_dirs=(self.home / ".claude-personal",))

        states = ClaudeRules(env).states(repo, [_entry(agents, "instructions"),
                                                _entry(claude_md, "instructions", source="global")])

        self.assertEqual(states[str(agents)].state, "launch")
        self.assertEqual((states[str(claude_md)].state, states[str(claude_md)].reason), (
            "not-loaded", "in Claude config folder ~/.claude; states are judged against ~/.claude-personal"))

    def test_hooks_and_plugins_come_from_the_judged_config_dir(self):
        personal, claude = self.home / ".claude-personal", self.home / ".claude"
        personal_settings = self._write_json(personal / "settings.json", {"enabledPlugins": {"p@m": True}})
        claude_settings = self._write_json(claude / "settings.json", {})
        install = claude / "plugins" / "cache" / "m" / "p" / "1.0.0"
        plugin_hooks = self._write_json(install / "hooks" / "hooks.json", {})
        plugin_skill = self._write(install / "skills" / "k" / "SKILL.md")
        self._write_json(personal / "plugins" / "installed_plugins.json", {"plugins": {
            "p@m": [{"scope": "user", "installPath": str(install), "version": "1.0.0"}],
        }})
        entries = [
            _entry(personal_settings, "hook", source="global"),
            _entry(claude_settings, "hook", source="global"),
            _entry(plugin_hooks, "hook", source="plugin", root=install, plugin="p@m"),
            _entry(plugin_skill, "skill", source="plugin", root=install, plugin="p@m"),
        ]

        states = self._personal_first_rules().states(self._repo("r"), entries)

        self.assertEqual(states[str(personal_settings)].state, "launch")
        self.assertEqual((states[str(claude_settings)].state, states[str(claude_settings)].reason), (
            "not-loaded", "in Claude config folder ~/.claude; states are judged against ~/.claude-personal"))
        self.assertEqual(states[str(plugin_hooks)].state, "launch")
        self.assertEqual((states[str(plugin_skill)].state, states[str(plugin_skill)].reason),
                         ("listed", "skill of enabled plugin p@m"))


if __name__ == "__main__":
    unittest.main()
