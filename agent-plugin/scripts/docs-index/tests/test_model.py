"""The index document's shape, built from entries the test constructs."""

import unittest

from model import KINDS, Context, DocHeading, DocLink, Entry, Installed, Location, Owner, State, document


def _entry(entry_id: str, kind: str = "instructions", walked: tuple[Location, ...] = (), **fields) -> Entry:
    return Entry(**{"id": entry_id, "kind": kind, "source": "repo", "repo": "r", "root": "/r", "plugin": None,
                    "path": entry_id, "line": None, "title": "T", "meta": {}, "walked": walked, **fields})


def _installed(path: str, harness: str, version: str) -> Installed:
    install_root = path.rsplit("/", 1)[0]
    return Installed(Location(path, Owner("plugin", root=install_root, plugin="p@m")), harness, version)


class DocumentTests(unittest.TestCase):
    def test_document_sorts_entries_by_id_and_carries_the_schema_version(self):
        context = Context(folder="/r", session_id=None,
                          states={"/r/b.md": {"claude": State("launch", "in the folder")}})

        doc = document([_entry("/r/b.md"), _entry("/r/a.md")], [context], "2026-10-19T14:02:11Z")

        self.assertEqual(doc["schemaVersion"], 5)
        self.assertEqual([entry["id"] for entry in doc["entries"]], ["/r/a.md", "/r/b.md"])
        self.assertEqual(doc["contexts"][0]["sessionId"], None)
        self.assertEqual(doc["contexts"][0]["states"]["/r/b.md"]["claude"],
                         {"state": "launch", "reason": "in the folder"})


class EntryTests(unittest.TestCase):
    def test_unknown_kind_raises_naming_the_value(self):
        with self.assertRaisesRegex(ValueError, "'rules'"):
            _entry("/r/a.md", kind="rules")

    def test_to_json_lists_walked_paths_in_order(self):
        walk_owner = Owner(source="repo", repo="w", root="/w")
        entry = _entry("/r/a.md", walked=(Location("/w/second.md", walk_owner), Location("/w/first.md", walk_owner)))

        self.assertEqual(entry.to_json()["walked"], ["/w/second.md", "/w/first.md"])

    def test_to_json_walked_empty_without_links(self):
        self.assertEqual(_entry("/r/a.md").to_json()["walked"], [])

    def test_to_json_emits_owner_after_source_defaulting_to_mine(self):
        emitted = _entry("/r/a.md").to_json()

        self.assertEqual(list(emitted), ["id", "kind", "source", "owner", "repo", "root", "plugin", "path", "line",
                                         "title", "meta", "walked", "lastLoaded", "headings", "links"])
        self.assertEqual(emitted["owner"], "mine")

    def test_to_json_emits_last_loaded_defaulting_to_null(self):
        self.assertIsNone(_entry("/r/a.md").to_json()["lastLoaded"])
        self.assertEqual(_entry("/r/a.md", last_loaded="2026-10-26T21:01:32.174Z").to_json()["lastLoaded"],
                         "2026-10-26T21:01:32.174Z")

    def test_entry_emits_headings_and_links(self):
        with_fields = _entry("/r/a.md", headings=(DocHeading(2, "Own", 3),),
                             links=(DocLink("section", "§ Own", "/r/a.md", 5, 3),))
        rows = [
            (_entry("/r/a.md"), [], []),
            (with_fields,
             [{"level": 2, "text": "Own", "line": 3}],
             [{"form": "section", "raw": "§ Own", "target": "/r/a.md", "line": 5, "targetLine": 3}]),
        ]
        for entry, headings, links in rows:
            with self.subTest(headings=headings):
                self.assertEqual(entry.to_json()["headings"], headings)
                self.assertEqual(entry.to_json()["links"], links)

    def test_doc_link_refuses_an_unknown_form(self):
        with self.assertRaisesRegex(ValueError, "'wiki'"):
            DocLink("wiki", "§ Own", "/r/a.md", 5, 3)

    def test_to_json_emits_a_third_party_owner(self):
        self.assertEqual(_entry("/r/a.md", ownership="third-party").to_json()["owner"], "third-party")

    def test_unknown_ownership_raises_naming_the_value(self):
        with self.assertRaisesRegex(ValueError, "'theirs'"):
            _entry("/r/a.md", ownership="theirs")

    def test_skill_file_is_a_kind(self):
        _entry("/r/s/ref.md", kind="skill-file")

        self.assertEqual(KINDS.index("skill-file"), KINDS.index("skill") + 1)


class InstalledTests(unittest.TestCase):
    def _entry_walked_and_installed(self) -> Entry:
        walked = Location("/w/a.md", Owner("repo", "w", "/w"))
        installed = Installed(Location("/c/p/1.0.0/a.md", Owner("plugin", root="/c/p/1.0.0", plugin="p@m")),
                              "claude", "1.0.0")
        return _entry("/r/a.md", walked=(walked,), installed=(installed,))

    def test_locations_hold_the_real_path_then_walked_then_installed(self):
        entry = self._entry_walked_and_installed()

        self.assertEqual([location.path for location in entry.locations], ["/r/a.md", "/w/a.md", "/c/p/1.0.0/a.md"])
        self.assertEqual(entry.locations[2].owner, Owner("plugin", root="/c/p/1.0.0", plugin="p@m"))

    def test_to_json_keeps_installed_paths_out_of_walked(self):
        self.assertEqual(self._entry_walked_and_installed().to_json()["walked"], ["/w/a.md"])

    def test_a_clone_plugin_file_emits_meta_installed_in_install_order(self):
        entry = _entry("/r/k/SKILL.md", kind="skill", plugin="p@m", meta={"name": "k"},
                       installed=(_installed("/c/claude/k/SKILL.md", "claude", "1.0.0"),
                                  _installed("/c/codex/k/SKILL.md", "codex", "0.9.0")))

        self.assertEqual(entry.to_json()["meta"], {"name": "k", "installed": [
            {"harness": "claude", "version": "1.0.0", "path": "/c/claude/k/SKILL.md"},
            {"harness": "codex", "version": "0.9.0", "path": "/c/codex/k/SKILL.md"},
        ]})
        self.assertEqual(entry.meta, {"name": "k"})

    def test_a_clone_plugin_file_not_installed_emits_an_empty_installed_list(self):
        self.assertEqual(_entry("/r/a.md", plugin="p@m").to_json()["meta"]["installed"], [])

    def test_a_repo_file_outside_a_plugin_has_no_installed_meta(self):
        self.assertNotIn("installed", _entry("/r/a.md").to_json()["meta"])

    def test_installed_with_an_unknown_harness_raises(self):
        with self.assertRaisesRegex(ValueError, "'cursor'"):
            Installed(Location("/x", Owner("plugin")), "cursor", "1")


class ContextTests(unittest.TestCase):
    def test_context_emits_loaded_plugins_before_states(self):
        emitted = Context("/r", "s", {}, {"p@m": "1.9.1"}).to_json()

        self.assertEqual(list(emitted), ["folder", "sessionId", "loadedPlugins", "states"])
        self.assertEqual(emitted["loadedPlugins"], {"p@m": "1.9.1"})
        self.assertEqual(Context("/r", None, {}).to_json()["loadedPlugins"], {})


if __name__ == "__main__":
    unittest.main()
