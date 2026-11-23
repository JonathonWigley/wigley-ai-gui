"""Environment reads every machine setting under its home. Every test builds
a temp home holding only the files it states, with a fixed clock."""

import io
import json
import os
import subprocess
import tempfile
import unittest
from contextlib import redirect_stderr
from datetime import datetime, timezone
from pathlib import Path
from unittest import mock

from environment import Environment, repo_slug

FIXED_NOW = datetime(2026, 1, 2, 3, 4, 5, tzinfo=timezone.utc)


class EnvironmentTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        self.home = self.root / "home"
        self.home.mkdir()
        self.env = Environment(home=self.home, now=lambda: FIXED_NOW)

    def _write_json(self, path, data):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data), encoding="utf-8")

    def _git(self, repo, *args):
        subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True)

    def test_project_local_settings_disable_a_plugin_the_user_enabled(self):
        project = self.root / "project"
        self._write_json(self.home / ".claude" / "settings.json",
                         {"enabledPlugins": {"a@m": True, "b@m": True}})
        self._write_json(project / ".claude" / "settings.local.json", {"enabledPlugins": {"a@m": False}})

        enabled = self.env.enabled_claude_plugins(project)

        self.assertNotIn("a@m", enabled)
        self.assertIn("b@m", enabled)

    def test_instruction_files_mode_defaults_when_unset(self):
        self._write_json(self.home / ".claude" / "settings.json", {})

        self.assertEqual(self.env.instruction_files_mode(), "claude-md-or-agents-md")

    def test_instruction_files_mode_reads_the_agents_md_plugin_option(self):
        self._write_json(self.home / ".claude" / "settings.json", {"pluginConfigs": {
            "cc-plugin-agents-md@builtin": {"options": {"instructionFiles": "claude-md-and-agents-md"}},
        }})

        self.assertEqual(self.env.instruction_files_mode(), "claude-md-and-agents-md")

    def test_claude_plugin_installs_skip_a_missing_install_path(self):
        present = self.root / "cache" / "m" / "a" / "1.0.0"
        present.mkdir(parents=True)
        missing = self.root / "cache" / "m" / "b" / "1.0.0"
        self._write_json(self.home / ".claude" / "plugins" / "installed_plugins.json", {"plugins": {
            "a@m": [{"scope": "project", "projectPath": "/p", "installPath": str(present), "version": "1.0.0"}],
            "b@m": [{"scope": "user", "installPath": str(missing), "version": "1.0.0"}],
        }})

        installs = self.env.claude_plugin_installs(self.home / ".claude")

        self.assertEqual([install.key for install in installs], ["a@m"])
        self.assertEqual(installs[0].install_path, present)
        self.assertEqual(installs[0].project_path, Path("/p"))
        self.assertEqual(installs[0].scope, "project")
        self.assertIsNone(installs[0].enabled)

    def test_instruction_files_mode_of_the_wrong_shape_defaults_naming_the_key(self):
        self._write_json(self.home / ".claude" / "settings.json", {"pluginConfigs": {
            "cc-plugin-agents-md@builtin": {"options": {"instructionFiles": 3}},
        }})

        with redirect_stderr(io.StringIO()) as err:
            mode = self.env.instruction_files_mode()

        self.assertEqual(mode, "claude-md-or-agents-md")
        self.assertIn("instructionFiles", err.getvalue())

    def test_claude_install_records_of_the_wrong_shape_are_skipped_naming_the_file(self):
        present = self.root / "cache" / "m" / "a" / "1.0.0"
        present.mkdir(parents=True)
        installed = self.home / ".claude" / "plugins" / "installed_plugins.json"
        self._write_json(installed, {"plugins": {
            "a@m": [{"installPath": str(present)}, {"scope": "user"}, "not a record"],
            "b@m": {"installPath": str(present)},
        }})

        with redirect_stderr(io.StringIO()) as err:
            installs = self.env.claude_plugin_installs(self.home / ".claude")

        self.assertEqual([install.key for install in installs], ["a@m"])
        self.assertEqual(err.getvalue().count(str(installed)), 3)

    def test_codex_plugin_entry_of_the_wrong_shape_reads_as_not_enabled(self):
        self._codex_versions("1.0.0")
        (self.home / ".codex" / "config.toml").write_text('[plugins]\n"wigley@market" = "on"\n', encoding="utf-8")

        with redirect_stderr(io.StringIO()) as err:
            installs = self.env.codex_plugin_installs()

        self.assertEqual([i.enabled for i in installs], [False])
        self.assertIn("wigley@market", err.getvalue())

    def _codex_versions(self, *names):
        for name in names:
            (self.home / ".codex" / "plugins" / "cache" / "market" / "wigley" / name).mkdir(parents=True)

    def test_codex_install_is_the_numerically_highest_version(self):
        self._codex_versions("0.2.0", "0.10.0")

        installs = self.env.codex_plugin_installs()

        self.assertEqual([(i.key, i.version) for i in installs], [("wigley@market", "0.10.0")])

    def test_codex_local_version_outranks_numbered_versions(self):
        self._codex_versions("0.2.0", "local")

        installs = self.env.codex_plugin_installs()

        self.assertEqual([i.version for i in installs], ["local"])

    def test_codex_install_enabled_comes_from_config_toml(self):
        self._codex_versions("1.0.0")
        (self.home / ".codex" / "config.toml").write_text(
            '[plugins."wigley@market"]\nenabled = true\n', encoding="utf-8")

        installs = self.env.codex_plugin_installs()

        self.assertEqual([i.enabled for i in installs], [True])

    def test_origin_name_is_the_remote_repo_name(self):
        repo = self.root / "checkout"
        repo.mkdir()
        self._git(repo, "init")
        self._git(repo, "remote", "add", "origin", "git@github-personal:o/repo-name.git")

        self.assertEqual(self.env.origin_name(repo), "repo-name")

    def test_origin_name_without_a_remote_is_the_folder_name(self):
        repo = self.root / "checkout"
        repo.mkdir()
        self._git(repo, "init")

        self.assertEqual(self.env.origin_name(repo), "checkout")

    def test_origin_url_is_the_remote_url(self):
        with_remote, without_remote = self.root / "a", self.root / "b"
        for repo in (with_remote, without_remote):
            repo.mkdir()
            self._git(repo, "init")
        self._git(with_remote, "remote", "add", "origin", "git@h:o/r.git")

        self.assertEqual(self.env.origin_url(with_remote), "git@h:o/r.git")
        self.assertIsNone(self.env.origin_url(without_remote))

    def test_repo_slug_of_each_url_shape(self):
        urls = (
            "git@github-personal:JonathonWigley/wigley-ai-marketplace.git",
            "ssh://git@github.com/jonathonwigley/wigley-ai-marketplace.git",
            "https://github.com/JonathonWigley/wigley-ai-marketplace",
            "JonathonWigley/wigley-ai-marketplace",
        )
        for url in urls:
            with self.subTest(url=url):
                self.assertEqual(repo_slug(url), "jonathonwigley/wigley-ai-marketplace")
        self.assertIsNone(repo_slug("mkt"))

    def test_claude_marketplace_urls_read_a_git_url_and_a_github_repo(self):
        self._write_json(self.home / ".claude" / "plugins" / "known_marketplaces.json", {
            "a": {"source": {"source": "git", "url": "git@h:O/R.git"}},
            "b": {"source": {"source": "github", "repo": "o/r2"}},
            "c": {"source": {"source": "directory", "path": "/x"}},
        })

        urls = self.env.claude_marketplace_urls(self.home / ".claude")

        self.assertEqual(urls, {"a": "git@h:O/R.git", "b": "o/r2"})

    def test_claude_marketplace_urls_of_the_wrong_shape_are_skipped_naming_the_file(self):
        self._write_json(self.home / ".claude" / "plugins" / "known_marketplaces.json", {"a": "git@h:o/r.git"})

        with redirect_stderr(io.StringIO()) as err:
            urls = self.env.claude_marketplace_urls(self.home / ".claude")

        self.assertEqual(urls, {})
        lines = err.getvalue().splitlines()
        self.assertEqual(len(lines), 1)
        self.assertIn("known_marketplaces.json", lines[0])

    def test_codex_marketplace_urls_read_each_source(self):
        config = self.home / ".codex" / "config.toml"
        config.parent.mkdir(parents=True)
        config.write_text('[marketplaces.m]\nsource = "https://github.com/o/r"\n\n[marketplaces.n]\nsource = 3\n',
                          encoding="utf-8")

        with redirect_stderr(io.StringIO()):
            urls = self.env.codex_marketplace_urls()

        self.assertEqual(urls, {"m": "https://github.com/o/r"})


    def _two_folder_env(self, *config_dirs):
        return Environment(home=self.home, now=lambda: FIXED_NOW, claude_config_dirs=config_dirs)

    def test_claude_config_dirs_default_to_the_home_claude_folder(self):
        self.assertEqual(self.env.claude_config_dirs, (self.home / ".claude",))

    def test_settings_and_mode_come_from_the_judged_config_dir(self):
        personal, claude = self.home / ".claude-personal", self.home / ".claude"
        self._write_json(personal / "settings.json", {
            "enabledPlugins": {"a@m": True},
            "pluginConfigs": {"cc-plugin-agents-md@builtin": {"options": {"instructionFiles": "claude-md"}}},
        })
        self._write_json(claude / "settings.json", {"enabledPlugins": {"b@m": True}})
        env = self._two_folder_env(personal, claude)

        self.assertEqual(env.claude_settings_files(None), [personal / "settings.json"])
        self.assertEqual(env.enabled_claude_plugins(None), {"a@m"})
        self.assertEqual(env.instruction_files_mode(), "claude-md")

    def test_claude_plugin_installs_read_the_given_config_dir(self):
        personal, claude = self.home / ".claude-personal", self.home / ".claude"
        install = self.root / "cache" / "m" / "a" / "1.0.0"
        install.mkdir(parents=True)
        self._write_json(personal / "plugins" / "installed_plugins.json", {"plugins": {
            "a@m": [{"scope": "user", "installPath": str(install), "version": "1.0.0"}],
        }})
        env = self._two_folder_env(personal, claude)

        self.assertEqual([i.key for i in env.claude_plugin_installs(personal)], ["a@m"])
        self.assertEqual(env.claude_plugin_installs(claude), [])

    def test_judged_by_puts_the_folder_first_and_keeps_the_rest(self):
        personal, claude = self.home / ".claude-personal", self.home / ".claude"
        judged = self._two_folder_env(claude, personal).judged_by(personal)

        self.assertEqual(judged.claude_config_dirs, (personal, claude))
        self.assertEqual(judged.home, self.home)

    def test_locate_finds_a_path_as_written_walked_or_real(self):
        personal, claude = self.home / ".claude-personal", self.home / ".claude"
        real_personal = self.root / "dotclaude"
        real_personal.mkdir()
        personal.symlink_to(real_personal)
        locate = self._two_folder_env(claude, personal).locate_in_claude_config_dirs

        self.assertEqual(locate(claude / "rules" / "r.md"), (claude, Path("rules/r.md")))
        self.assertEqual(locate(Path(os.path.realpath(self.home)) / ".claude" / "CLAUDE.md"),
                         (claude, Path("CLAUDE.md")))
        self.assertEqual(locate(Path(os.path.realpath(real_personal)) / "CLAUDE.md"), (personal, Path("CLAUDE.md")))
        self.assertEqual(locate(personal / "CLAUDE.md"), (personal, Path("CLAUDE.md")))
        self.assertIsNone(locate(self.home / "notes.md"))

    def test_locate_finds_home_claude_after_the_configured_folders_when_unconfigured(self):
        personal, claude = self.home / ".claude-personal", self.home / ".claude"
        locate = Environment(home=self.home, now=lambda: FIXED_NOW,
                             claude_config_dirs=(personal,)).locate_in_claude_config_dirs

        self.assertEqual(locate(claude / "CLAUDE.md"), (claude, Path("CLAUDE.md")))
        self.assertEqual(locate(personal / "CLAUDE.md"), (personal, Path("CLAUDE.md")))

    def test_locate_resolves_each_config_folder_once_across_calls(self):
        personal, claude = self.home / ".claude-personal", self.home / ".claude"
        locate = self._two_folder_env(personal, claude).locate_in_claude_config_dirs
        with mock.patch("os.path.realpath", wraps=os.path.realpath) as realpath:
            locate(self.home / "notes.md")
            calls_after_first = realpath.call_count
            locate(self.home / "other.md")
            locate(claude / "CLAUDE.md")

        self.assertEqual(realpath.call_count, calls_after_first)


if __name__ == "__main__":
    unittest.main()
