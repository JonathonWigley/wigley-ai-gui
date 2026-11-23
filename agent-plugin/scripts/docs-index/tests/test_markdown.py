"""The markdown parsers, each run on text the test writes."""

import unittest

from markdown import checkbox_counts, followup_items, front_matter, heading_title, imports, status_line


class FollowupItemsTests(unittest.TestCase):
    def test_sectioned_file_gives_one_item_per_section_heading(self):
        text = "\n".join([
            "# Follow-ups",                           # 1
            "",                                       # 2
            "**Contents**",                           # 3
            "",                                       # 4
            "- **Splitter** — the command splitter",  # 5
            "- **Hooks** — hook order",               # 6
            "",                                       # 7
            "## Splitter redesign",                   # 8
            "",                                       # 9
            "- **Parens**: paren gaps",               # 10
            "- **Redirects**: redirect gaps",         # 11
            "",                                       # 12
            "## Hook order",                          # 13
            "- **Order**: hooks run out of order",    # 14
        ])

        items = followup_items(text)

        self.assertEqual(
            [(item.title, item.line, item.gist, item.status, item.section) for item in items],
            [
                ("Splitter redesign", 8, "- **Parens**: paren gaps", "open", None),
                ("Hook order", 13, "- **Order**: hooks run out of order", "open", None),
            ],
        )

    def test_harness_area_file_gives_numbered_items_with_sections_and_shipped_status(self):
        text = "\n".join([
            "**Status:** three settings gaps and two design issues.",
            "",
            "1. **Hooks**: hooks run twice.",
            "2. **`/config`**: shipped ([settings](x.md)).",
            "3. **Model picker**: picker drops the effort.",
            "",
            "## Design issues",
            "",
            "1. **Panel layout**: the panel overlaps.",
            "2. **Toasts**: toasts stack.",
        ])

        items = followup_items(text)

        self.assertEqual(
            [(item.title, item.status, item.section) for item in items],
            [
                ("Hooks", "open", None),
                ("`/config`", "done", None),
                ("Model picker", "open", None),
                ("Panel layout", "open", "Design issues"),
                ("Toasts", "open", "Design issues"),
            ],
        )

    def test_plain_bullet_file_titles_each_item_by_its_first_sentence(self):
        text = "\n".join([
            "# GUI follow-ups",
            "",
            "- Forms lose focus on reload. Seen twice on the review round.",
            "- Dark mode tokens are off",
            "  in the sidebar.",
        ])

        items = followup_items(text)

        self.assertEqual(
            [(item.title, item.line, item.gist, item.section) for item in items],
            [
                ("Forms lose focus on reload", 3, "Seen twice on the review round.", None),
                ("Dark mode tokens are off", 4, "", None),
            ],
        )

    def test_list_item_reads_its_first_line_only(self):
        text = "\n".join([
            "- Command palette.",
            "  More text. Here.",
        ])

        items = followup_items(text)

        self.assertEqual([(item.title, item.gist) for item in items], [("Command palette", "")])

    def test_list_item_tag_span_gives_tags_and_leaves_the_gist(self):
        text = "- **Fruit Blast coins** — *needs a feature plan*: replace the sink"

        items = followup_items(text)

        self.assertEqual(
            [(item.title, item.tags, item.gist) for item in items],
            [("Fruit Blast coins", ["needs a feature plan"], "replace the sink")],
        )

    def test_underscore_tag_span_splits_on_commas(self):
        text = "- **Queue** — _agent-ready,  needs review_: a queue"

        items = followup_items(text)

        self.assertEqual(
            [(item.tags, item.gist) for item in items],
            [(["agent-ready", "needs review"], "a queue")],
        )

    def test_item_with_no_tag_span_has_no_tags_and_its_gist_unchanged(self):
        text = "- **Hooks** — *hooks* run twice"

        items = followup_items(text)

        self.assertEqual([(item.tags, item.gist) for item in items], [([], "*hooks* run twice")])

    def test_shipped_item_behind_a_tag_span_is_done(self):
        text = "- **Coins** — *agent-ready*: shipped in 1.2"

        items = followup_items(text)

        self.assertEqual([(item.status, item.gist) for item in items], [("done", "shipped in 1.2")])

    def test_section_item_takes_tags_from_its_contents_line(self):
        text = "\n".join([
            "**Contents**",
            "",
            "- **Pluggable queue** — *agent-ready, needs review*: a queue",
            "- ~~**Old work**~~ — *agent-ready*: gone",
            "- **Plain** — no tags",
            "",
            "## Pluggable queue",
            "The queue body.",
            "",
            "## ~~Old work~~",
            "Done body.",
            "",
            "## Plain",
            "Plain body.",
        ])

        items = followup_items(text)

        self.assertEqual(
            [(item.title, item.tags, item.gist, item.status) for item in items],
            [
                ("Pluggable queue", ["agent-ready", "needs review"], "The queue body.", "open"),
                ("Old work", ["agent-ready"], "Done body.", "done"),
                ("Plain", [], "Plain body.", "open"),
            ],
        )

    def test_contents_line_and_heading_holding_backticks_match(self):
        text = "\n".join([
            "**Contents**",
            "",
            "- **The `docs` index** — *agent-ready*: index",
            "",
            "## The `docs` index",
            "Body.",
        ])

        items = followup_items(text)

        self.assertEqual([(item.title, item.tags) for item in items], [("The `docs` index", ["agent-ready"])])

    def test_bold_title_wrapped_onto_its_continuation_reads_whole_and_uncut(self):
        text = "\n".join([
            "1. **The read-only trait as an optional interface is a runtime type test, and `ITool` freezes once",
            "   plugins compile against it** — *agent-ready*: callers find it by a type test.",
            "   Fix: a required member.",
            "2. **Next** — b",
        ])

        items = followup_items(text)

        self.assertEqual(
            [(item.title, item.tags, item.gist, item.line) for item in items],
            [
                (
                    "The read-only trait as an optional interface is a runtime type test, and `ITool` freezes once"
                    " plugins compile against it",
                    ["agent-ready"],
                    "callers find it by a type test.",
                    1,
                ),
                ("Next", [], "b", 4),
            ],
        )

    def test_unclosed_bold_with_no_close_below_keeps_its_first_sentence_title(self):
        text = "\n".join([
            "- **Open bold. Rest",
            "  no close here",
        ])

        self.assertEqual([item.title for item in followup_items(text)], ["**Open bold"])

    def test_section_headings_with_no_list_item_are_sectioned(self):
        text = "\n".join([
            "# Follow-ups",
            "",
            "## One",
            "",
            "Body one.",
            "",
            "## Two",
            "",
            "Body two.",
        ])

        items = followup_items(text)

        self.assertEqual([(item.title, item.gist) for item in items], [("One", "Body one."), ("Two", "Body two.")])

    def test_grouped_list_file_stays_list_shaped(self):
        text = "\n".join([
            "## Group",
            "",
            "- **A** — a",
            "",
            "## Other",
            "",
            "- **B** — b",
        ])

        items = followup_items(text)

        self.assertEqual([(item.title, item.section) for item in items], [("A", "Group"), ("B", "Other")])

    def test_section_headings_with_empty_bodies_stay_list_shaped(self):
        text = "\n".join([
            "# Follow-ups",
            "",
            "Intro.",
            "",
            "## Group",
            "",
            "## Other",
        ])

        self.assertEqual(followup_items(text), [])

    def test_wrapped_contents_line_reads_tags_and_title_from_its_continuation(self):
        text = "\n".join([
            "**Contents**",
            "",
            "- **One** —",
            "  *agent-ready*: starts here",
            "  and wraps on.",
            "- **A long",
            "  title** — *art*: wraps",
            "",
            "## One",
            "",
            "Body.",
            "",
            "## A long title",
            "",
            "Body two.",
        ])

        items = followup_items(text)

        self.assertEqual([(item.title, item.tags) for item in items], [("One", ["agent-ready"]), ("A long title", ["art"])])

    def test_dash_with_nothing_after_it_reads_an_empty_gist(self):
        text = "- **Fresh** — \n- **Next** — b\n"

        items = followup_items(text)

        self.assertEqual([(item.title, item.gist, item.tags) for item in items], [("Fresh", "", []), ("Next", "b", [])])

    def test_item_lines_count_line_feeds_alone(self):
        rows = ["\r", "\x0b", "\x0c", "\x1c", "\x85", " "]
        for separator in rows:
            with self.subTest(separator=separator):
                text = f"- One{separator}more\n- Two\n"

                self.assertEqual([item.line for item in followup_items(text)], [1, 2])

    def test_a_crlf_file_numbers_its_items_as_a_line_feed_file_does(self):
        text = "- One\r\n\r\n- Two\r\n"

        self.assertEqual([(item.title, item.line) for item in followup_items(text)], [("One", 1), ("Two", 3)])

    def test_section_and_list_titles_drop_only_a_closing_hash_run(self):
        sectioned = "**Contents**\n\n## C#\nBody.\n\n## Done ##\nBody.\n\n## F# #\nBody.\n"
        listed = "## C# ##\n\n- **A** — a\n\n## C#\n\n- **B** — b\n"

        self.assertEqual([item.title for item in followup_items(sectioned)], ["C#", "Done", "F#"])
        self.assertEqual([item.section for item in followup_items(listed)], ["C#", "C#"])


class HeadingTitleTests(unittest.TestCase):
    def test_heading_title_drops_only_a_closing_hash_run(self):
        rows = [
            ("# C#", "C#"),
            ("# C##", "C##"),
            ("# C# ##", "C#"),
            ("# Title #  ", "Title"),
            ("# #", "#"),
        ]
        for text, expected in rows:
            with self.subTest(text=text):
                self.assertEqual(heading_title(text), expected)


class ImportsTests(unittest.TestCase):
    def test_imports_skip_fenced_code_and_code_spans(self):
        text = "\n".join([
            "@~/wigley-agents/AGENTS.md",
            "```",
            "@x.md",
            "```",
            "Write `@y.md` to import a file; mail a@b.c.",
        ])

        self.assertEqual(imports(text), ["~/wigley-agents/AGENTS.md"])


class FencedCodeTests(unittest.TestCase):
    def test_longer_fence_wrapping_a_shorter_one_hides_its_whole_example(self):
        text = "\n".join([
            "Intro line.",
            "````markdown",
            "```",
            "# Example heading",
            "@example.md",
            "- example item",
            "```",
            "````",
            "# Real heading",
            "- Real item",
        ])

        self.assertEqual(heading_title(text), "Real heading")
        self.assertEqual(imports(text), [])
        self.assertEqual([item.title for item in followup_items(text)], ["Real item"])

    def test_backtick_run_with_a_backtick_after_it_is_a_code_span_not_a_fence(self):
        text = "\n".join([
            "```inline``` code",
            "# Real heading",
        ])

        self.assertEqual(heading_title(text), "Real heading")


class FrontMatterTests(unittest.TestCase):
    def test_a_fence_is_three_dashes_with_only_spaces_or_a_carriage_return_after(self):
        rows = [
            ("---\nname: a\n---\n# Body", {"name": "a"}, "Body"),
            ("--- \nname: a\n---\n# Body", {"name": "a"}, "Body"),
            ("---\nname: a\n---  \n# Body", {"name": "a"}, "Body"),
            ("--- \r\nname: a\r\n--- \r\n# Body", {"name": "a"}, "Body"),
            (" ---\nname: a\n---\n# Body", {}, "Body"),
            ("---\t\nname: a\n---\n# Body", {}, "Body"),
            ("---\nname: a\n---\t\n# Body", {}, "Body"),
            ("---\n# Inside\n ---\n# Body", {}, "Inside"),
        ]
        for text, matter, title in rows:
            with self.subTest(text=text):
                self.assertEqual(front_matter(text), matter)
                self.assertEqual(heading_title(text), title)

    def test_skill_front_matter_reads_bools_and_lists(self):
        text = "\n".join([
            "---",
            "name: deploy",
            'description: "Deploys the app"',
            "disable-model-invocation: true",
            "paths:",
            "  - src/**/*.ts",
            "  - 'docs/*.md'",
            "---",
            "# Deploy",
        ])

        matter = front_matter(text)

        self.assertIs(matter["disable-model-invocation"], True)
        self.assertEqual(matter["paths"], ["src/**/*.ts", "docs/*.md"])
        self.assertEqual(matter["description"], "Deploys the app")

    def test_folded_block_joins_lines_and_keeps_paragraph_breaks(self):
        text = "\n".join([
            "---",
            "description: >-",
            "  Compresses prose",
            "  into fewer tokens.",
            "",
            "  Keeps code.",
            "name: compress",
            "---",
        ])

        matter = front_matter(text)

        self.assertEqual(matter["description"], "Compresses prose into fewer tokens.\nKeeps code.")
        self.assertEqual(matter["name"], "compress")

    def test_folded_block_without_strip_chomp_ends_in_a_newline(self):
        for header in (">", ">+"):
            text = "\n".join(["---", f"description: {header}", "  Reviews food.", "  Harshly.", "---"])

            self.assertEqual(front_matter(text)["description"], "Reviews food. Harshly.\n", header)

    def test_literal_block_keeps_lines_and_removes_common_indent(self):
        text = "\n".join([
            "---",
            "usage: |",
            "    run it",
            "      --fast",
            "notes: |-",
            "  one",
            "  two",
            "---",
        ])

        matter = front_matter(text)

        self.assertEqual(matter["usage"], "run it\n  --fast\n")
        self.assertEqual(matter["notes"], "one\ntwo")

    def test_plain_value_over_indented_lines_joins_them_with_spaces(self):
        text = "\n".join([
            "---",
            "description: Deploys the app",
            "  to staging",
            "  then prod.",
            "name: deploy",
            "---",
        ])

        matter = front_matter(text)

        self.assertEqual(matter["description"], "Deploys the app to staging then prod.")
        self.assertEqual(matter["name"], "deploy")


class CheckboxCountsTests(unittest.TestCase):
    def test_struck_checked_item_counts_as_checked(self):
        text = "- [x] done\n- [ ] open\n- [x] ~~struck~~\n"

        self.assertEqual(checkbox_counts(text), (2, 3))

    def test_checklist_items_inside_fenced_code_do_not_count(self):
        text = "\n".join([
            "- [x] real done",
            "```markdown",
            "- [ ] example open",
            "- [x] example done",
            "```",
            "- [ ] real open",
        ])

        self.assertEqual(checkbox_counts(text), (1, 2))


class StatusLineTests(unittest.TestCase):
    def test_status_inside_fenced_code_is_skipped(self):
        text = "\n".join([
            "# Task",
            "```",
            "Status: example",
            "```",
            "**Status:** in progress",
        ])

        self.assertEqual(status_line(text), "in progress")


if __name__ == "__main__":
    unittest.main()
