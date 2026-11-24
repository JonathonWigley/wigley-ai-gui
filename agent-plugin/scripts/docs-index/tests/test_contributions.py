"""load_contributions over files the test writes in a temp home."""

import io
import json
import tempfile
import unittest
from contextlib import redirect_stderr
from pathlib import Path

from contributions import Contributions, FeaturesHomes, GlobalFolder, load_contributions


class LoadContributionsTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.home = Path(tmp.name) / "home"
        self.home.mkdir()
        self.path = Path(tmp.name) / "contributions.json"

    def _load(self, data):
        self.path.write_text(json.dumps(data), encoding="utf-8")
        with redirect_stderr(io.StringIO()) as err:
            contributions = load_contributions(self.path, self.home)
        return contributions, err.getvalue()

    def _features(self, homes):
        return {"homes": homes, "file": "followups.md", "areaFolder": "followups"}

    def test_none_path_gives_empty(self):
        with redirect_stderr(io.StringIO()) as err:
            contributions = load_contributions(None, self.home)

        self.assertEqual(contributions, Contributions())
        self.assertEqual(err.getvalue(), "")

    def test_missing_file_gives_empty_with_one_stderr_line(self):
        with redirect_stderr(io.StringIO()) as err:
            contributions = load_contributions(self.path, self.home)

        self.assertEqual(contributions, Contributions())
        self.assertEqual(err.getvalue().count("\n"), 1)
        self.assertIn(f"docs index: ignoring contributions file {self.path}: ", err.getvalue())

    def test_templates_split_into_in_repo_parts_and_out_of_repo_folders(self):
        homes = ["{repo}/docs/features", "~/wigley-features/{name}", "{repo}/notes", "/srv/homes/{name}"]

        contributions, err = self._load({"version": 1, "features": self._features(homes)})

        self.assertEqual(contributions.features, FeaturesHomes(
            in_repo_parts=(("docs", "features"), ("notes",)),
            out_of_repo_folders=(self.home / "wigley-features", Path("/srv/homes")),
            file="followups.md", area_folder="followups"))
        self.assertEqual(err, "")

    def test_bad_template_dropped_with_stderr_line(self):
        rows = ["docs/features", "{repo}/../x", "{repo}/{name}", "wigley-features/{name}", "~/x/{name}/y"]
        for template in rows:
            with self.subTest(template=template):
                contributions, err = self._load(
                    {"version": 1, "features": self._features(["{repo}/docs/features", template])})

                self.assertEqual((contributions.features.in_repo_parts, contributions.features.out_of_repo_folders),
                                 ((("docs", "features"),), ()))
                self.assertEqual(err.count("\n"), 1)
                self.assertIn(f'features.homes[1]: "{template}" is neither', err)

    def test_tilde_paths_expand_against_env_home(self):
        contributions, _ = self._load({
            "version": 1,
            "globalFolders": [{"path": "~/agents", "referenceFiles": ["decisions.md"], "subfolders": ["wiki"]}],
            "linkPrefixes": {"x:": "x@m"},
            "features": self._features(["~/homes/{name}"]),
        })

        self.assertEqual(contributions.global_folders, [
            GlobalFolder(path=self.home / "agents", reference_files=("decisions.md",), subfolders=("wiki",))])
        self.assertEqual(contributions.features.out_of_repo_folders, (self.home / "homes",))
        self.assertEqual(contributions.link_prefixes, {"x:": "x@m"})


if __name__ == "__main__":
    unittest.main()
