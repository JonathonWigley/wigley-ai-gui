"""The § parser, run on text the test writes."""

import tempfile
import unittest
from pathlib import Path

from section_refs import (ProseText, body_lines, parse_headings, read_headings, section_pointer, source_length,
                          walk_headings)


def _headings_of(text):
    return parse_headings(body_lines(text))


class ParseHeadingsTests(unittest.TestCase):
    def test_parse_headings_reads_each_level_outside_fences_and_front_matter(self):
        rows = [
            ("---\n# no\n---\n# Title\n##### Deep", [(1, "Title", 4), (5, "Deep", 5)]),
            ("```\n## no\n```\n## Yes", [(2, "Yes", 4)]),
            ("## `Code` **name** ##", [(2, "Code name", 1)]),
            ("```x```\n## After", [(2, "After", 2)]),
            ("#nospace\n####### seven", []),
            ("# A\r\n## B", [(1, "A", 1), (2, "B", 2)]),
            ("## A\x0c\n## B", [(2, "A", 1), (2, "B", 2)]),
            (" ---\n# no\n---\n# Title", [(1, "no", 2), (1, "Title", 4)]),
            ("---\n# open front matter, never closed", [(1, "open front matter, never closed", 2)]),
            ("---\n```\n---\n## After a fence in front matter", [(2, "After a fence in front matter", 4)]),
            ("## C#\n### C# ##\n#### C##  \n# Hash #", [(2, "C#", 1), (3, "C#", 2), (4, "C##", 3), (1, "Hash", 4)]),
            ("--- \n# no\n---\n# Title", [(1, "Title", 4)]),
            ("---\n# no\n---  \n# Title", [(1, "Title", 4)]),
            ("--- \r\n# no\r\n--- \r\n# Title", [(1, "Title", 4)]),
            ("---\t\n# no\n---\n# Title", [(1, "no", 2), (1, "Title", 4)]),
            ("---\n# no\n---\t\n# Title", [(1, "no", 2), (1, "Title", 4)]),
            ("## A\rB\n## C", [(2, "A\rB", 1), (2, "C", 2)]),
        ]
        for text, expected in rows:
            with self.subTest(text=text):
                self.assertEqual([(h.level, h.text, h.line) for h in _headings_of(text)], expected)

    def test_read_headings_counts_line_feeds_alone(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "doc.md"
            path.write_bytes(b"one\rstill one\n## A\r\n### B\n")

            self.assertEqual([(h.text, h.line) for h in read_headings(path)], [("A", 2), ("B", 3)])

    def test_a_heading_nests_under_the_nearest_earlier_lower_level(self):
        headings = _headings_of("# Top\n### Skips a level\n## Second\n#### Deep\n### Third\n")
        by_text = {heading.text: [child.text for child in heading.children] for heading in headings}

        self.assertEqual(by_text, {"Top": ["Skips a level", "Second"], "Skips a level": [],
                                   "Second": ["Deep", "Third"], "Deep": [], "Third": []})


class WalkHeadingsTests(unittest.TestCase):
    def test_walk_headings_takes_the_longest_prefix_and_nests(self):
        headings = _headings_of("## Asking\n\n### The agent decides\n\n## Asking twice\n\n### Other\n")
        rows = [
            ("Asking twice over", (5, 12)),
            ("Asking › The agent decides; when", (3, 26)),
            ("Asking › Other", None),
            ("Askings", None),
            ("Asking: why", (1, 6)),
        ]
        for remainder, expected in rows:
            with self.subTest(remainder=remainder):
                walk = walk_headings(remainder, headings)
                if expected is None:
                    self.assertIsNone(walk.heading)
                    self.assertIsNotNone(walk.problem)
                else:
                    self.assertEqual((walk.heading.line, walk.length), expected)
                    self.assertIsNone(walk.problem)


class SectionPointerTests(unittest.TestCase):
    def test_a_prefixed_pointer_gives_its_prefix_skill_and_file_groups(self):
        rows = [
            (["wigley:"], "see `wigley:writing-tests` § One", ("wigley:", "writing-tests", None)),
            (["wigley:"], "see wigley:make § Two", ("wigley:", "make", None)),
            (["wigley:"], "see `decisions.md` § Asking", (None, None, "decisions.md")),
            (["wigley:"], "see ~/wigley-agents/decisions.md § Asking", (None, None, "~/wigley-agents/decisions.md")),
            (["wigley:"], "README § Hooks", (None, None, "README")),
            (["wigley:"], "other:make § Two", None),
            ([], "see `decisions.md` § Asking", (None, None, "decisions.md")),
            ([], "see wigley:make § Two", None),
            (["a:", "b:"], "b:x § Part", ("b:", "x", None)),
            (["a:", "ab:"], "ab:x § Part", ("ab:", "x", None)),
        ]
        for prefixes, text, expected in rows:
            with self.subTest(prefixes=prefixes, text=text):
                match = section_pointer(prefixes).search(text)

                found = None if match is None else (match["prefix"], match["skill"], match["file"])
                self.assertEqual(found, expected)


class SourceLengthTests(unittest.TestCase):
    def test_source_length_counts_only_plain_characters_and_keeps_a_closing_mark(self):
        rows = [
            ("`Code` name now", 9, 11),
            ("`Code` now", 4, 6),
            ("**Bold** now", 4, 8),
            ("Plain now", 5, 5),
            ("`**Both**` now", 4, 10),
        ]
        for remainder, plain_length, expected in rows:
            with self.subTest(remainder=remainder):
                self.assertEqual(source_length(remainder, plain_length), expected)


class ProseTextTests(unittest.TestCase):
    def test_prose_text_source_returns_the_real_text_of_a_wrapped_range(self):
        rows = [
            (["a §", "  b"], "a § b", "a", "a §\n  b", 1),
            (["> a §", "> b"], "> a § b", "a", "a §\n> b", 1),
            (["x", "one line here"], "x one line here", "line", "line", 2),
        ]
        for lines, text, opening, expected_source, expected_line in rows:
            with self.subTest(lines=lines):
                prose = ProseText(lines)
                start = prose.text.index(opening)
                end = start + len(expected_source.replace("\n> ", " ").replace("\n  ", " "))

                self.assertEqual(prose.text, text)
                self.assertEqual(prose.source(start, end), expected_source)
                self.assertEqual(prose.line_of(start), expected_line)

    def test_a_code_span_is_seen_one_source_line_at_a_time(self):
        prose = ProseText(["`in` out `wraps", "away` end"])
        rows = [("in", True), ("out", False), ("wraps", False), ("end", False)]

        for word, expected in rows:
            with self.subTest(word=word):
                self.assertEqual(prose.in_code_span(prose.text.index(word)), expected)


if __name__ == "__main__":
    unittest.main()
