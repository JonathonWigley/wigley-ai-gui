"""with_doc_fields over Entry values the test builds on real temp files;
nothing on the real machine is read."""

import os
import tempfile
import unittest
from pathlib import Path

from doc_fields import with_doc_fields
from model import Entry

WIGLEY_KEY = "wigley@wigley-ai-marketplace"
USER_LINK_PREFIXES = {"wigley:": WIGLEY_KEY}


class DocFieldsTestCase(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.base = Path(os.path.realpath(tmp.name))
        self.home = self.base / "home"
        self.repo = self.base / "repo"
        self.home.mkdir()

    def _case_folder(self, name):
        folder = self.base / "cases" / name
        folder.mkdir(parents=True)
        return folder

    def _write(self, path, text="# Doc\n"):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
        return path

    def _make_repo(self, path):
        (path / ".git").mkdir(parents=True)
        return path

    def _entry(self, path, kind="instructions", source="repo", repo="r", root=None, plugin=None, line=None,
               ownership="mine"):
        suffix = f"#L{line}" if line is not None else ""
        return Entry(id=f"{path}{suffix}", kind=kind, source=source, repo=repo, root=str(root) if root else None,
                     plugin=plugin, path=str(path), line=line, title="T", meta={}, ownership=ownership)

    def _fields_of(self, source_entry, others=(), link_prefixes=USER_LINK_PREFIXES):
        finished = with_doc_fields([source_entry, *others], self.home, link_prefixes)
        return finished[0]


class ReferenceTests(DocFieldsTestCase):
    def _reference_tree(self, repo):
        """A source's targets, each on disk and listed. Returns the entries by short name."""
        decisions = self._write(self.home / "wigley-agents" / "decisions.md",
                                "# Decisions\n\n## Asking\n\n### The agent decides\n")
        paths = {
            "decisions": decisions,
            "agents": self._write(repo / "AGENTS.md", "# A\n\n## Running and testing\n"),
            "design": self._write(repo / "docs" / "usage" / "design.md", "# D\n\n## The right bar\n"),
            "readme": self._write(repo / "sub" / "README.md", "# R\n\n## Hooks\n"),
            "terminal": self._write(repo / "sub" / "Terminal.md", "# T\n\n## Plugin reload\n"),
            "other": self._write(repo / "sub" / "other.md", "# O\n\n\n## Some heading\n"),
            "spaced": self._write(repo / "sub" / "my doc.md", "# S\n"),
            "absolute": self._write(self.base / "abs" / "other.md", "# Abs\n"),
            "skill": self._write(repo / "plugins" / "wigley" / "skills" / "writing-tests" / "SKILL.md",
                                 "---\nname: writing-tests\n---\n\n## One test per behaviour\n"),
        }
        entries = [self._entry(paths[name]) for name in paths if name != "skill"]
        entries.append(self._entry(paths["skill"], kind="skill", plugin=WIGLEY_KEY, root=repo))
        return paths, entries

    def test_references_give_these_links(self):
        rows = [
            ("(§ Mode change).", "section", "§ Mode change", "source", "Mode change"),
            ("(`~/wigley-agents/decisions.md` § Asking › The agent decides).", "section",
             "`~/wigley-agents/decisions.md` § Asking › The agent decides", "decisions", 5),
            ("`docs/usage/design.md` § The right bar — 10", "section", "`docs/usage/design.md` § The right bar",
             "design", 3),
            ("(`AGENTS.md` § Running and testing)", "section", "`AGENTS.md` § Running and testing", "agents", 3),
            ("per `wigley:writing-tests` § One test per behaviour: a row", "section",
             "`wigley:writing-tests` § One test per behaviour", "skill", 5),
            ("(README § Hooks: hooks fail open;", "section", "README § Hooks", "readme", 3),
            ("`Terminal.md` § Plugin reload).", "section", "`Terminal.md` § Plugin reload", "terminal", 3),
            ("`other.md` §\n  Some heading, more", "section", "`other.md` §\n  Some heading", "other", 4),
            ("> see `other.md` § Some\n> heading.", "section", "`other.md` § Some\n> heading", "other", 4),
            ("§ `Code` name now", "section", "§ `Code` name", "source", "Code name"),
            ("[t](other.md)", "markdown", "[t](other.md)", "other", None),
            ("[t](other.md#some-heading)", "markdown", "[t](other.md#some-heading)", "other", 4),
            ("[t](other.md#nope)", "markdown", "[t](other.md#nope)", "other", None),
            ("[t](#mode-change)", "markdown", "[t](#mode-change)", "source", "Mode change"),
            ("[t](~/wigley-agents/decisions.md)", "markdown", "[t](~/wigley-agents/decisions.md)", "decisions", None),
            ("[t](my%20doc.md)", "markdown", "[t](my%20doc.md)", "spaced", None),
            ("[t](<ABS>/abs/other.md)", "markdown", "[t](<ABS>/abs/other.md)", "absolute", None),
            ("[t](wigley:writing-tests)", "markdown", "[t](wigley:writing-tests)", "skill", None),
            ("[`other.md` § Some\nheading](other.md#some-heading)", "markdown",
             "[`other.md` § Some\nheading](other.md#some-heading)", "other", 4),
            ("`other.md`  § Some heading", "section", "`other.md`  § Some heading", "other", 4),
            ('[a](other.md  "t")', "markdown", '[a](other.md  "t")', "other", None),
        ]
        repo = self._make_repo(self.repo)
        paths, target_entries = self._reference_tree(repo)
        header = "# Source\n\n## Mode change\n\n## `Code` name\n\n"
        heading_lines = {"Mode change": 3, "Code name": 5}
        source = repo / "sub" / "source.md"
        paths["source"] = source
        for text, form, raw, target, target_line in rows:
            with self.subTest(text=text):
                text = text.replace("<ABS>", str(self.base))
                raw = raw.replace("<ABS>", str(self.base))
                self._write(source, header + text + "\n")

                entry = self._fields_of(self._entry(source), target_entries)

                expected_line = heading_lines.get(target_line, target_line)
                self.assertEqual([link.to_json() for link in entry.links],
                                 [{"form": form, "raw": raw, "target": str(paths[target]), "line": 7,
                                   "targetLine": expected_line}])

    def test_references_give_no_link(self):
        rows = [
            "`other.md` § 2)",
            "§ Nope",
            "`decisions.md` § Asking › Nope",
            "`missing.md` § Own",
            "`other.md` § Own",
            "`wigley:none` § Own",
            "01 § Own",
            "OtherDoc § Own",
            "`§ Own`",
            "`other.md § Own`",
            "`[t](other.md)`",
            "![i](other.md)",
            "[t](https://example.com/a.md)",
            "[t](wiki:all)",
            "[t](missing.md)",
            "[t](#nope)",
            "[t][ref]",
            "```\n§ Own\n```",
            "§\n\nOwn",
            "`other.md`\n\n§ Far",
            "[a\n\nb](other.md)",
            "[a](\n\nother.md)",
            "[a](other.md\n\n)",
            '[a](other.md "t\n\nu")',
            "[x](a%00b.md)",
            "[x](/a%00b.md)",
            "[x](~/a%00b.md)",
        ]
        repo = self._make_repo(self.repo)
        other = self._write(repo / "other.md", "# O\n\n## 2. Interview impact\n\n## Far\n")
        decisions = self._write(self.home / "wigley-agents" / "decisions.md", "## Asking\n")
        source = repo / "source.md"
        for text in rows:
            with self.subTest(text=text):
                self._write(source, f"## Own\n\n{text}\n")

                entry = self._fields_of(self._entry(source), [self._entry(other), self._entry(decisions)])

                self.assertEqual(entry.links, ())

    def test_references_come_back_in_source_order_with_duplicates(self):
        repo = self._make_repo(self.repo)
        other = self._write(repo / "other.md", "## Far\n")
        source = self._write(repo / "source.md", "## Own\n\n§ Own, [t](other.md), `other.md` § Far, § Own\n")

        entry = self._fields_of(self._entry(source), [self._entry(other)])

        self.assertEqual([link.raw for link in entry.links], ["§ Own", "[t](other.md)", "`other.md` § Far", "§ Own"])

    def test_a_bare_blocker_counts_only_in_its_own_paragraph(self):
        source = self._write(self._make_repo(self.repo) / "source.md", "## Own\n\nEnds on 01\n\n§ Own\n")

        entry = self._fields_of(self._entry(source))

        self.assertEqual([(link.raw, link.line) for link in entry.links], [("§ Own", 5)])

    def test_lines_count_line_feeds_alone_and_a_line_break_reads_as_a_line_feed(self):
        rows = [
            ("lone carriage return", "## A\rB\n\n## Far\n\n§ Far\n", [("A\rB", 1), ("Far", 3)], ("§ Far", 5, 3)),
            ("crlf", "## A\r\n\r\n## Far\r\n\r\n§ Far\r\n", [("A", 1), ("Far", 3)], ("§ Far", 5, 3)),
            ("wrapped crlf", "## Far away\r\n\r\n§ Far\r\n  away, more\r\n", [("Far away", 1)],
             ("§ Far\n  away", 3, 1)),
        ]
        source = self._make_repo(self.repo) / "source.md"
        for name, text, headings, link in rows:
            with self.subTest(row=name):
                source.write_bytes(text.encode("utf-8"))

                entry = self._fields_of(self._entry(source))

                self.assertEqual([(heading.text, heading.line) for heading in entry.headings], headings)
                self.assertEqual([(found.raw, found.line, found.target_line) for found in entry.links], [link])


class TargetRuleTests(DocFieldsTestCase):
    def _target_of(self, source_entry, others, token):
        self._write(Path(source_entry.path), f"`{token}` § Topic\n")
        links = self._fields_of(source_entry, others).links
        return links[0].target if links else None

    def test_a_bare_file_takes_the_nearest_clear_target(self):
        def folder_over_root(base):
            repo = self._make_repo(base / "repo")
            near = self._write(repo / "sub" / "a.md", "## Topic\n")
            root_copy = self._write(repo / "a.md", "## Topic\n")
            return self._entry(repo / "sub" / "x.md"), [self._entry(root_copy), self._entry(near)], "a.md", near

        def root_over_other_repo(base):
            repo = self._make_repo(base / "repo")
            at_root = self._write(repo / "a.md", "## Topic\n")
            elsewhere = self._write(self._make_repo(base / "two") / "a.md", "## Topic\n")
            return self._entry(repo / "sub" / "x.md"), [self._entry(elsewhere), self._entry(at_root)], "a.md", at_root

        def one_mine_elsewhere(base):
            repo = self._make_repo(base / "repo")
            elsewhere = self._write(self._make_repo(base / "two") / "a.md", "## Topic\n")
            return self._entry(repo / "x.md"), [self._entry(elsewhere)], "a.md", elsewhere

        def two_mine_elsewhere(base):
            repo = self._make_repo(base / "repo")
            one = self._write(self._make_repo(base / "two") / "a.md", "## Topic\n")
            two = self._write(self._make_repo(base / "three") / "a.md", "## Topic\n")
            return self._entry(repo / "x.md"), [self._entry(one), self._entry(two)], "a.md", None

        def mine_and_third_party(base):
            repo = self._make_repo(base / "repo")
            mine = self._write(self._make_repo(base / "two") / "a.md", "## Topic\n")
            theirs = self._write(self._make_repo(base / "three") / "a.md", "## Topic\n")
            others = [self._entry(mine), self._entry(theirs, ownership="third-party")]
            return self._entry(repo / "x.md"), others, "a.md", mine

        def two_roots_from_no_repo(base):
            one = self._write(self._make_repo(base / "two") / "AGENTS.md", "## Topic\n")
            two = self._write(self._make_repo(base / "three") / "AGENTS.md", "## Topic\n")
            source = self._entry(base / "loose" / "x.md", source="global", repo=None)
            return source, [self._entry(one), self._entry(two)], "AGENTS.md", None

        def readme_elsewhere(base):
            repo = self._make_repo(base / "repo")
            elsewhere = self._write(self._make_repo(base / "two") / "README.md", "## Topic\n")
            return self._entry(repo / "x.md"), [self._entry(elsewhere)], "README", None

        def one_clone_of_the_home(base):
            clone = self._make_repo(base / "clone")
            agents = self._write(clone / "AGENTS.md", "## Topic\n")
            source = self._entry(base / "features" / "r" / "f" / "x.md", source="features",
                                 root=base / "features" / "r")
            return source, [self._entry(agents, root=clone)], "AGENTS.md", agents

        def two_clones_of_the_home(base):
            one = self._make_repo(base / "clone")
            two = self._make_repo(base / "clone-2")
            first = self._write(one / "AGENTS.md", "## Topic\n")
            second = self._write(two / "AGENTS.md", "## Topic\n")
            source = self._entry(base / "features" / "r" / "f" / "x.md", source="features",
                                 root=base / "features" / "r")
            return source, [self._entry(first, root=one), self._entry(second, root=two)], "AGENTS.md", None

        rows = [folder_over_root, root_over_other_repo, one_mine_elsewhere, two_mine_elsewhere, mine_and_third_party,
                two_roots_from_no_repo, readme_elsewhere, one_clone_of_the_home, two_clones_of_the_home]
        for build_row in rows:
            with self.subTest(row=build_row.__name__):
                source, others, token, expected = build_row(self._case_folder(build_row.__name__))

                target = self._target_of(source, others, token)

                self.assertEqual(target, str(expected) if expected else None)

    def test_a_skill_pointer_prefers_the_clone_over_the_install(self):
        def clone_skill(base):
            path = self._write(base / "clone" / "skills" / "s" / "SKILL.md", "## Topic\n")
            return path, self._entry(path, kind="skill", plugin=WIGLEY_KEY, root=base / "clone")

        def install_skill(base):
            path = self._write(base / "cache" / "skills" / "s" / "SKILL.md", "## Topic\n")
            return path, self._entry(path, kind="skill", source="plugin", repo=None, plugin=WIGLEY_KEY)

        def clone_and_install(base):
            path, clone = clone_skill(base)
            return path, [install_skill(base)[1], clone]

        def install_only(base):
            path, install = install_skill(base)
            return path, [install]

        def other_plugin_only(base):
            path = self._write(base / "clone" / "skills" / "s" / "SKILL.md", "## Topic\n")
            return None, [self._entry(path, kind="skill", plugin="other@m", root=base / "clone")]

        def heading_in_a_sibling_only(base):
            path = self._write(base / "clone" / "skills" / "s" / "SKILL.md", "## Elsewhere\n")
            sibling = self._write(base / "clone" / "skills" / "s" / "ref.md", "## Topic\n")
            return None, [self._entry(path, kind="skill", plugin=WIGLEY_KEY, root=base / "clone"),
                          self._entry(sibling, kind="skill-file", plugin=WIGLEY_KEY, root=base / "clone")]

        rows = [clone_and_install, install_only, other_plugin_only, heading_in_a_sibling_only]
        for build_row in rows:
            with self.subTest(row=build_row.__name__):
                base = self._case_folder(build_row.__name__)
                expected, others = build_row(base)
                source = self._entry(self._make_repo(base / "repo") / "x.md")

                target = self._target_of(source, others, "wigley:s")

                self.assertEqual(target, str(expected) if expected else None)

    def test_prefix_matches_the_exact_plugin_key(self):
        base = self._case_folder("exact_key")
        path = self._write(base / "clone" / "skills" / "s" / "SKILL.md", "## Topic\n")
        others = [self._entry(path, kind="skill", plugin="wigley@other", root=base / "clone")]
        source = self._entry(self._make_repo(base / "repo") / "x.md")

        self.assertIsNone(self._target_of(source, others, "wigley:s"))

    def test_two_prefixes_resolve_to_their_own_plugins(self):
        base = self._case_folder("two_prefixes")
        skills = {key: self._write(base / key / "skills" / "x" / "SKILL.md", "## Part\n") for key in ("a", "b")}
        others = [self._entry(skills[key], kind="skill", plugin=f"{key}@m", root=base / key) for key in skills]
        source_path = self._make_repo(base / "repo") / "x.md"
        rows = [("a:x § Part\n", "a"), ("`b:x` § Part\n", "b"), ("[t](a:x)\n", "a"), ("[t](b:x#part)\n", "b")]
        for text, key in rows:
            with self.subTest(text=text):
                self._write(source_path, text)

                links = self._fields_of(self._entry(source_path), others, {"a:": "a@m", "b:": "b@m"}).links

                self.assertEqual([link.target for link in links], [str(skills[key])])

    def test_a_link_into_a_follow_up_file_resolves_on_its_path(self):
        repo = self._make_repo(self.repo)
        followups = self._write(repo / "followups.md", "# F\n\n## Topic\n")
        source = self._write(repo / "x.md", "`followups.md` § Topic\n")
        item = self._entry(followups, kind="followup", source="features", line=3)

        entry = self._fields_of(self._entry(source), [item])

        self.assertEqual([link.to_json() for link in entry.links],
                         [{"form": "section", "raw": "`followups.md` § Topic", "target": str(followups), "line": 1,
                           "targetLine": 3}])


class EntryFieldsTests(DocFieldsTestCase):
    def test_each_entry_carries_the_fields_its_body_allows(self):
        repo = self._make_repo(self.repo)
        doc = "## Own\n\n§ Own\n"
        mine_target = self._write(repo / "target.md", "## Far\n")
        settings = self._write(repo / "settings.json", "## Own\n\n§ Own\n")
        script = self._write(repo / "a.py", doc)
        third_party_doc = self._write(repo / "theirs.md", "## Own\n\n`target.md` § Far\n")
        main_page = self._write(repo / "Main.md",
                                "# Top\n\n##### Deep\n\n## `Code` name\n\n[t](wigley:writing-tests)\n")
        skill = self._write(repo / "skills" / "writing-tests" / "SKILL.md", "---\nname: x\n---\n\n## Own\n\n§ Own\n")
        skill_entry = self._entry(skill, kind="skill", plugin=WIGLEY_KEY, root=repo)
        rows = [
            ("mine skill-file", self._entry(self._write(repo / "a.md", doc), kind="skill-file"), 1, 1),
            ("third-party skill", self._entry(skill, kind="skill", ownership="third-party"), 1, 0),
            ("third-party doc", self._entry(third_party_doc, ownership="third-party"), 1, 0),
            ("hook", self._entry(settings, kind="hook"), 0, 0),
            ("plugin", self._entry(repo, kind="plugin"), 0, 0),
            ("script", self._entry(script, kind="skill-file"), 0, 0),
            ("follow-up", self._entry(self._write(repo / "items.md", doc), kind="followup", line=3), 0, 0),
            ("gone", self._entry(repo / "gone.md"), 0, 0),
            ("reference", self._entry(main_page, kind="reference", source="global", repo=None), 3, 1),
        ]
        for name, entry, heading_count, link_count in rows:
            with self.subTest(entry=name):
                finished = self._fields_of(entry, [self._entry(mine_target), skill_entry])

                self.assertEqual(len(finished.headings), heading_count)
                self.assertEqual(len(finished.links), link_count)

    def test_headings_are_the_flat_list_of_every_level_in_file_order(self):
        path = self._write(self._make_repo(self.repo) / "a.md", "# One\n\n#### Four\n\n## `Code` two\n")

        entry = self._fields_of(self._entry(path))

        self.assertEqual([heading.to_json() for heading in entry.headings],
                         [{"level": 1, "text": "One", "line": 1}, {"level": 4, "text": "Four", "line": 3},
                          {"level": 2, "text": "Code two", "line": 5}])


if __name__ == "__main__":
    unittest.main()
