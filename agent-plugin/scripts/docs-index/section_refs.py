"""The one parser of § references and of the headings they name, for
doc_fields.py. Imports the standard library and markdown.py only.

Lines split on a line feed alone, with one trailing carriage return dropped,
so a line number here names the same line as the wigley-ai-gui docs browser.
"""

from __future__ import annotations

import bisect
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

from markdown import CODE_SPAN, HEADING, front_matter_end, lines_outside_fences, read_exact_text, split_lines

POINTER_LEVELS = (2, 3)
ALL_LEVELS = (1, 2, 3, 4, 5, 6)
NESTED_SEPARATOR = " › "
EMPHASIS = str.maketrans("", "", "`*")
CONTINUATION_LEAD = re.compile(r"^[\s>]*")
EMPHASIS_RUN = re.compile(r"`+|\*+")
PARAGRAPH_BREAK = "\n"
# Each pattern runs on ProseText.text, where [^\S\n] is whitespace within one paragraph.
SECTION_POINTER_TEMPLATE = (
    r"(?<![\w./~:-])`?(?:(?P<prefix>{prefixes})(?P<skill>[a-z0-9][a-z0-9-]*)"
    r"|(?P<file>[\w./~-]*[\w-]\.md|README))`?[^\S\n]+§ ")
NO_PREFIX = "(?!)"
MARKDOWN_LINK = re.compile(
    r"(?<!!)\[(?:[^\[\]\n]|\[[^\[\]\n]*\])*\]\([^\S\n]*(?:<([^<>\n]*)>|([^()\s]*(?:\([^()\s]*\)[^()\s]*)*))"
    r"(?:[^\S\n]+(?:\"[^\"\n]*\"|'[^'\n]*'))?[^\S\n]*\)")
BARE_BLOCKER = re.compile(r"(?:(?<![\w.])\d\d|(?<![\w-])[A-Z][a-z]+[A-Z]\w*)`?[^\S\n]+$")


class Heading:
    """A heading and the headings nested under it in the same file. line is
    1-based; text has its closing hashes, backticks and * removed."""

    def __init__(self, level: int, text: str, line: int):
        self.level = level
        self.text = text
        self.line = line
        self.children: list[Heading] = []


@dataclass(frozen=True)
class HeadingWalk:
    """The result of walking a reference down the heading tree. On a match,
    heading is the first of the deepest tied headings and length the matched
    length in the emphasis-free remainder; on no match, heading is None and
    problem names the step that failed."""

    heading: Heading | None
    length: int
    problem: str | None


def section_pointer(prefixes: Iterable[str]) -> re.Pattern[str]:
    """The § pointer pattern: a skill pointer <prefix><skill> for each of
    prefixes, longest first, or a file pointer. The groups prefix, skill and
    file exist in every pattern; with no prefixes no skill pointer matches."""
    ordered = sorted(set(prefixes), key=lambda prefix: (-len(prefix), prefix))
    alternation = "|".join(re.escape(prefix) for prefix in ordered) or NO_PREFIX
    return re.compile(SECTION_POINTER_TEMPLATE.replace("{prefixes}", alternation))


def prose_lines(text: str) -> list[str]:
    """text's lines with every line of a fenced code block, fences included,
    blanked. The line count is kept."""
    return _lines_kept_from(split_lines(text), 0)


def body_lines(text: str) -> list[str]:
    """prose_lines, with the front matter blanked as well. Front matter opens
    on a first line that is --- with only spaces or carriage returns after it,
    and ends at the next such line; with no such next line, the file has none."""
    lines = split_lines(text)
    return _lines_kept_from(lines, _front_matter_line_count(lines))


def _front_matter_line_count(lines: list[str]) -> int:
    end = front_matter_end(lines)
    return 0 if end is None else end + 1


def _lines_kept_from(lines: list[str], start: int) -> list[str]:
    """lines with each line before start, or inside a fenced block, blanked."""
    kept = [""] * len(lines)
    for index, line in lines_outside_fences(lines, start):
        kept[index] = line
    return kept


def parse_headings(lines: list[str], levels: tuple[int, ...] = ALL_LEVELS) -> list[Heading]:
    """Every heading of lines at levels, in file order, each also listed as a
    child of the nearest earlier heading of a lower level among levels. A
    heading with no text left after its marks is dropped: it can name nothing."""
    headings: list[Heading] = []
    open_headings: list[Heading] = []
    for index, line in enumerate(lines):
        match = HEADING.match(line)
        if not match or len(match.group(1)) not in levels:
            continue
        text = match.group(2).translate(EMPHASIS).strip()
        if not text:
            continue
        heading = Heading(len(match.group(1)), text, index + 1)
        headings.append(heading)
        while open_headings and open_headings[-1].level >= heading.level:
            open_headings.pop()
        if open_headings:
            open_headings[-1].children.append(heading)
        open_headings.append(heading)
    return headings


def read_headings(path: Path) -> list[Heading]:
    """Every ## and ### heading in path outside fenced blocks."""
    return parse_headings(prose_lines(read_exact_text(path)), POINTER_LEVELS)


def longest_prefixes(remainder: str, headings: list[Heading]) -> list[Heading]:
    """Return every heading remainder starts with as a whole word that ties for the longest
    text, or an empty list."""
    best: list[Heading] = []
    for heading in headings:
        is_prefix = remainder.startswith(heading.text)
        ends_on_word = is_prefix and not remainder[len(heading.text):len(heading.text) + 1].isalnum()
        if not ends_on_word:
            continue
        if not best or len(heading.text) > len(best[0].text):
            best = [heading]
        elif len(heading.text) == len(best[0].text):
            best.append(heading)
    return best


def walk_headings(remainder: str, headings: list[Heading]) -> HeadingWalk:
    """Walk remainder down the heading tree: the longest headings it starts with, then for
    each " › " the longest headings nested under any of the last matches."""
    matched = longest_prefixes(remainder, headings)
    if not matched:
        return HeadingWalk(None, 0, f"names no heading at '{snippet(remainder)}'")
    length = 0
    while True:
        text = matched[0].text
        length += len(text)
        rest = remainder[len(text):]
        if not rest.startswith(NESTED_SEPARATOR):
            return HeadingWalk(matched[0], length, None)
        length += len(NESTED_SEPARATOR)
        remainder = rest[len(NESTED_SEPARATOR):]
        children = [child for heading in matched for child in heading.children]
        matched = longest_prefixes(remainder, children)
        if not matched:
            return HeadingWalk(None, 0, f"names no heading nested under '{text}' at '{snippet(remainder)}'")


def resolve(remainder: str, headings: list[Heading]) -> str | None:
    """None when every step of remainder matches a heading, or a message naming
    the step that does not."""
    return walk_headings(remainder, headings).problem


def snippet(remainder: str) -> str:
    return remainder.partition(PARAGRAPH_BREAK)[0][:40].rstrip()


def source_length(remainder: str, plain_length: int) -> int:
    """The length in remainder of its first plain_length characters that are
    not a backtick or *, plus a closing run of either that the text taken
    left open."""
    taken = 0
    plain = 0
    while plain < plain_length:
        if ord(remainder[taken]) not in EMPHASIS:
            plain += 1
        taken += 1
    while taken < len(remainder) and ord(remainder[taken]) in EMPHASIS:
        mark = remainder[taken]
        runs_taken = len([run for run in EMPHASIS_RUN.findall(remainder[:taken]) if run[0] == mark])
        if runs_taken % 2 == 0:
            break
        taken = EMPHASIS_RUN.match(remainder, taken).end()
    return taken


def collapse(lines: list[str]) -> tuple[str, list[int], list[int]]:
    """Join lines with each break, the line's trailing whitespace and the next line's leading
    whitespace and blockquote > markers as one space, and a blank line as PARAGRAPH_BREAK.
    Return the text, the offset each line starts at, for mapping offsets to lines, and the
    length of the lead each line lost."""
    parts: list[str] = []
    starts: list[int] = []
    leads: list[int] = []
    offset = 0
    for index, line in enumerate(lines):
        line = line.rstrip()
        lead = 0 if index == 0 else CONTINUATION_LEAD.match(line).end()
        content = line[lead:]
        if index == 0:
            piece = line
        else:
            piece = " " + content if content else PARAGRAPH_BREAK
        starts.append(offset if index == 0 else offset + 1)
        leads.append(lead)
        parts.append(piece)
        offset += len(piece)
    return "".join(parts), starts, leads


class ProseText:
    """Lines collapsed to one text, so a reference that wraps reads as one line, in a
    blockquote too, and a blank line reads as PARAGRAPH_BREAK, so no reference or heading
    match crosses a paragraph; line_of and source map an offset back to the lines."""

    def __init__(self, lines: list[str]):
        self.text, self._line_starts, self._leads = collapse(lines)
        self._lines = lines

    def line_of(self, offset: int) -> int:
        return bisect.bisect_right(self._line_starts, offset)

    def source(self, start: int, end: int) -> str:
        """The source text of the range, with its leads and each line break read as a line feed."""
        first_index, first_column = self._position_of(start)
        last_index, last_column = self._position_of(end)
        if first_index == last_index:
            return self._lines[first_index][first_column:last_column]
        return "\n".join([self._lines[first_index][first_column:],
                          *self._lines[first_index + 1:last_index],
                          self._lines[last_index][:last_column]])

    def in_code_span(self, offset: int) -> bool:
        """Whether offset sits in a code span that opens and closes on its source line."""
        index, column = self._position_of(offset)
        return any(span.start() <= column < span.end() for span in CODE_SPAN.finditer(self._lines[index]))

    def _position_of(self, offset: int) -> tuple[int, int]:
        """The index of offset's line and offset's column in the source line."""
        index = self.line_of(offset) - 1
        return index, self._leads[index] + offset - self._line_starts[index]
