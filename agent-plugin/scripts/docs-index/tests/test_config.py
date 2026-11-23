"""load_config on a temp home: the defaults it writes when the file is
absent, and the "~" expansion of what an existing file holds."""

import io
import json
import tempfile
import unittest
from contextlib import redirect_stderr
from datetime import datetime, timezone
from pathlib import Path
from unittest import mock

from config import expand_home, home_relative, load_config
from environment import Environment

FIXED_NOW = datetime(2026, 1, 2, 3, 4, 5, tzinfo=timezone.utc)


class LoadConfigTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.home = Path(tmp.name) / "home"
        self.home.mkdir()
        self.env = Environment(home=self.home, now=lambda: FIXED_NOW)
        self.config_path = self.home / ".agents" / "wigley-docs" / "config.json"

    def test_absent_config_is_written_with_no_roots_naming_the_file_to_add_them_to(self):
        with redirect_stderr(io.StringIO()) as err:
            config = load_config(self.env)

        written = json.loads(self.config_path.read_text(encoding="utf-8"))
        self.assertEqual(written["roots"], [])
        self.assertEqual(config.roots, [])
        self.assertIn(f"roots in {self.config_path}", err.getvalue())

    def test_a_failed_defaults_write_raises_and_leaves_no_temp_file(self):
        with mock.patch("os.replace", side_effect=OSError("disk full")):
            with self.assertRaises(OSError):
                load_config(self.env)

        self.assertFalse(self.config_path.exists())
        self.assertEqual(list(self.config_path.parent.glob("*.tmp")), [])

    def test_existing_roots_resolve_under_home(self):
        self.config_path.parent.mkdir(parents=True)
        self.config_path.write_text(json.dumps({"roots": ["~/dev"]}), encoding="utf-8")

        with redirect_stderr(io.StringIO()) as err:
            config = load_config(self.env)

        self.assertEqual(config.roots, [self.home / "dev"])
        self.assertEqual(err.getvalue(), "")

    def test_existing_ignore_glob_has_its_leading_tilde_expanded(self):
        self.config_path.parent.mkdir(parents=True)
        self.config_path.write_text(json.dumps({"ignore": ["~/dev/old/*"]}), encoding="utf-8")

        config = load_config(self.env)

        self.assertEqual(config.ignore, [f"{self.home}/dev/old/*"])

    def test_expand_home_leaves_another_users_tilde_as_written(self):
        self.assertEqual(expand_home("~", self.home), str(self.home))
        self.assertEqual(expand_home("~other/dev", self.home), "~other/dev")

    def test_keys_of_the_wrong_shape_take_their_defaults_naming_each_key(self):
        self.config_path.parent.mkdir(parents=True)
        self.config_path.write_text(json.dumps({"roots": "~/dev", "ignore": [1]}), encoding="utf-8")

        with redirect_stderr(io.StringIO()) as err:
            config = load_config(self.env)

        self.assertEqual(config.roots, [])
        self.assertEqual(config.ignore, [])
        for key in ("roots", "ignore"):
            self.assertIn(key, err.getvalue())

    def test_features_home_key_is_ignored(self):
        self.config_path.parent.mkdir(parents=True)
        self.config_path.write_text(json.dumps({"roots": ["~/dev"], "featuresHome": "~/wigley-features"}),
                                    encoding="utf-8")

        with redirect_stderr(io.StringIO()) as err:
            config = load_config(self.env)

        self.assertEqual(config.roots, [self.home / "dev"])
        self.assertFalse(hasattr(config, "features_home"))
        self.assertEqual(err.getvalue(), "")


    def test_absent_config_is_written_with_the_claude_config_dirs_default(self):
        config = load_config(self.env)

        written = json.loads(self.config_path.read_text(encoding="utf-8"))
        self.assertEqual(written["claudeConfigDirs"], ["~/.claude"])
        self.assertEqual(config.claude_config_dirs, (self.home / ".claude",))

    def test_claude_config_dirs_expand_their_tilde_in_order_once_each(self):
        self.config_path.parent.mkdir(parents=True)
        self.config_path.write_text(json.dumps(
            {"claudeConfigDirs": ["~/.claude-personal", "~/.claude", "~/.claude-personal"]}), encoding="utf-8")

        config = load_config(self.env)

        self.assertEqual(config.claude_config_dirs, (self.home / ".claude-personal", self.home / ".claude"))

    def test_claude_config_dirs_of_the_wrong_shape_or_empty_take_the_default_with_one_line(self):
        self.config_path.parent.mkdir(parents=True)
        for value in ("~/.claude", [1], []):
            with self.subTest(value=value):
                self.config_path.write_text(json.dumps({"roots": ["~/dev"], "claudeConfigDirs": value}),
                                            encoding="utf-8")

                with redirect_stderr(io.StringIO()) as err:
                    config = load_config(self.env)

                self.assertEqual(config.claude_config_dirs, (self.home / ".claude",))
                self.assertIn("claudeConfigDirs", err.getvalue())
                self.assertEqual(err.getvalue().count("\n"), 1)

    def test_home_relative_writes_the_home_as_a_tilde(self):
        self.assertEqual(home_relative(self.home / ".claude-personal", self.home), "~/.claude-personal")
        self.assertEqual(home_relative(Path("/etc/claude"), self.home), "/etc/claude")


if __name__ == "__main__":
    unittest.main()
