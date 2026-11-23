"""nearest_repo_root and repo_roots_holding on folders each test builds in its own temp folder."""

import tempfile
import unittest
from pathlib import Path

from rules import nearest_repo_root, repo_roots_holding


class NearestRepoRootTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)

    def test_finds_a_submodule_git_file_two_levels_up(self):
        submodule = self.root / "sub"
        folder = submodule / "a" / "b"
        folder.mkdir(parents=True)
        (submodule / ".git").write_text("gitdir: ../.git/modules/sub\n", encoding="utf-8")

        self.assertEqual(nearest_repo_root(folder), submodule)

    def test_returns_none_without_a_git_marker(self):
        folder = self.root / "a" / "b"
        folder.mkdir(parents=True)

        self.assertIsNone(nearest_repo_root(folder))

    def test_repo_roots_holding_lists_the_innermost_root_first(self):
        outer = self.root / "outer"
        inner = outer / "inner"
        folder = inner / "a"
        folder.mkdir(parents=True)
        (outer / ".git").mkdir()
        (inner / ".git").write_text("gitdir: ../.git/modules/inner\n", encoding="utf-8")

        self.assertEqual(repo_roots_holding(folder), [inner, outer])


if __name__ == "__main__":
    unittest.main()
