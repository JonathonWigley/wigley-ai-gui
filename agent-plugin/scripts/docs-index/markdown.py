"""Reads the parts of an agent doc the index records: front matter, the first
heading, @imports, checkbox counts, the Status line and follow-up items.

Every parser takes the file's text and returns plain data. Skill and plugin
files are third-party data, so a line no parser recognises is skipped, never
raised on.

Lines split on a line feed alone, with one trailing carriage return dropped,
so a line number here names the same line as the wigley-ai-gui docs browser.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator

IMPORT = re.compile(r"(?<![\w`])@(~?[\w./-]+)")
CODE_SPAN = re.compile(r"(`+).*?\1")
FENCE = re.compile(r"(`{3,}|~{3,})(.*)")
FRONT_MATTER_FENCE = "---"
HEADING = re.compile(r"^(#{1,6})\s+(.+?)(?:\s+#+)?\s*$")
CHECKBOX = re.compile(r"^\s*[-*] \[( |x|X)\]")
STATUS = re.compile(r"^(\*\*)?Status:(\*\*)?\s*(.+)$")
STATUS_SEARCH_LINES = 15
TOP_LEVEL_ITEM = re.compile(r"^(?:- |\d+\. )(.*)$")
TAG_SPAN = re.compile(r"^(?:\*([^*]+)\*|_([^_]+)_):\s*")
GIST_LIMIT = 200


@dataclass(frozen=True)
class FollowupItem:
    """One follow-up. line is the 1-based line it starts on; status is "open"
    or "done"; section is the ## heading above a list item, else None; tags
    are the words of the item's tag span in written order."""

    title: str
    line: int
    gist: str
    status: str
    section: str | None
    tags: list[str]


def read_exact_text(path: Path, errors: str = "strict") -> str:
    """path's text with its line endings untouched: Path.read_text turns a lone
    carriage return into a line feed, and takes newline= only from Python 3.13."""
    return path.read_bytes().decode("utf-8", errors)


def split_lines(text: str) -> list[str]:
    return [line.removesuffix("\r") for line in text.split("\n")]


def is_front_matter_fence(line: str) -> bool:
    return line.rstrip(" \r") == FRONT_MATTER_FENCE


def front_matter(text: str) -> dict:
    """The --- block that opens the file, as a dict: `key: value` with
    matching quotes stripped, `key: [a, b]` and `key:` over `  - item` lines
    as lists, true and false as bools. A multi-line value reads as a string:
    a folded block (`key: >`, `>-`, `>+`) joins its lines with spaces and
    turns a blank line into a newline; a literal block (`key: |`, `|-`)
    keeps its lines, common indent removed; both end in a newline unless the
    header holds `-`. A plain value over more-indented lines folds like `>-`.
    {} when the file opens with no block."""
    lines = split_lines(text)
    end = front_matter_end(lines)
    if end is None:
        return {}
    result: dict = {}
    index = 1
    while index < end:
        line = lines[index]
        index += 1
        if line[:1].isspace() or ":" not in line:
            continue
        key, _, value = line.partition(":")
        key = key.strip()
        value = value.strip()
        if not key:
            continue
        if not value:
            items, index = _list_run(lines, index, end)
            if items:
                result[key] = items
            continue
        continuation, index = _indented_run(lines, index, end)
        if value.startswith("[") and value.endswith("]"):
            inner = value[1:-1].strip()
            result[key] = [_scalar(item) for item in inner.split(",")] if inner else []
        elif value[0] in ">|":
            result[key] = _block_scalar(value, continuation)
        else:
            result[key] = _scalar(_fold([value] + [part.strip() for part in continuation]))
    return result


def heading_title(text: str) -> str | None:
    """The text of the first `# ` heading outside the front matter and fenced code."""
    lines = split_lines(text)
    start = (front_matter_end(lines) or -1) + 1
    for _, line in lines_outside_fences(lines, start):
        if line.startswith("# "):
            return _heading_text(line)
    return None


def imports(text: str) -> list[str]:
    """The path text of each @import outside fenced code and code spans, in
    order, duplicates dropped. A trailing sentence period is not part of it."""
    found: list[str] = []
    for _, line in lines_outside_fences(split_lines(text), 0):
        prose = CODE_SPAN.sub(lambda match: " " * len(match.group(0)), line)
        for match in IMPORT.finditer(prose):
            path = match.group(1).rstrip(".")
            if path and path not in found:
                found.append(path)
    return found


def checkbox_counts(text: str) -> tuple[int, int]:
    """(checked, total) over the file's `- [ ]` and `- [x]` lines outside
    fenced code."""
    checked = 0
    total = 0
    for _, line in lines_outside_fences(split_lines(text), 0):
        match = CHECKBOX.match(line)
        if match:
            total += 1
            if match.group(1) != " ":
                checked += 1
    return checked, total


def status_line(text: str) -> str | None:
    """The value of the first `Status:` line outside fenced code among the
    file's first lines."""
    for _, line in lines_outside_fences(split_lines(text)[:STATUS_SEARCH_LINES], 0):
        match = STATUS.match(line)
        if match:
            return match.group(3).strip()
    return None


def followup_items(text: str) -> list[FollowupItem]:
    """The items of a sectioned follow-ups file (a **Contents** line, any
    ### heading, or a ## section with body text and no top-level list item:
    one item per ## heading) or of a list file (one item per top-level list
    item)."""
    lines = split_lines(text)
    outside = list(lines_outside_fences(lines, 0))
    has_section_mark = any(line.strip() == "**Contents**" or line.startswith("### ") for _, line in outside)
    has_list_item = any(TOP_LEVEL_ITEM.match(line) for _, line in outside)
    if has_section_mark or (_has_section_with_body(lines, outside) and not has_list_item):
        return _section_items(lines, outside)
    return _list_items(lines, outside)


def _has_section_with_body(lines: list[str], outside: list[tuple[int, str]]) -> bool:
    """Whether a non-blank line sits between some ## heading and the next."""
    heading_indexes = [index for index, line in outside if line.startswith("## ")]
    bounds = heading_indexes[1:] + [len(lines)]
    return any(any(line.strip() for line in lines[start + 1:bound]) for start, bound in zip(heading_indexes, bounds))


def _section_items(lines: list[str], outside: list[tuple[int, str]]) -> list[FollowupItem]:
    heading_indexes = [index for index, line in outside if line.startswith("## ")]
    tags_by_title = _contents_tags(lines, outside, heading_indexes[0] if heading_indexes else len(lines))
    items: list[FollowupItem] = []
    for position, index in enumerate(heading_indexes):
        body_end = heading_indexes[position + 1] if position + 1 < len(heading_indexes) else len(lines)
        body = [line.strip() for line in lines[index + 1:body_end]]
        gist = next((line for line in body if line and not line.startswith("#")), "")
        title, struck = _unstrike(_heading_text(lines[index]))
        items.append(FollowupItem(
            title=title,
            line=index + 1,
            gist=gist[:GIST_LIMIT],
            status=_status(gist, struck),
            section=None,
            tags=tags_by_title.get(_title_key(title), []),
        ))
    return items


def _contents_tags(lines: list[str], outside: list[tuple[int, str]], end: int) -> dict[str, list[str]]:
    """Title key -> tags for each top-level list item after the **Contents**
    line and before end, its indented continuation read as part of its line."""
    tags_by_title: dict[str, list[str]] = {}
    in_contents = False
    for index, line in outside:
        if index >= end:
            break
        if line.strip() == "**Contents**":
            in_contents = True
            continue
        item_match = TOP_LEVEL_ITEM.match(line)
        if in_contents and item_match:
            wrapped = [line.strip() for line in _indented_lines_after(lines, index)]
            text, _ = _unstrike(" ".join([item_match.group(1).strip(), *wrapped]).strip())
            title, tags, _ = _title_tags_gist(text)
            tags_by_title.setdefault(_title_key(title), tags)
    return tags_by_title


def _title_key(title: str) -> str:
    """A title as a Contents line and its ## heading are matched: strike-through
    and backticks removed."""
    return _unstrike(title)[0].replace("`", "").strip()


def _indented_lines_after(lines: list[str], index: int) -> list[str]:
    """The non-blank indented lines right after lines[index]."""
    end = index + 1
    while end < len(lines) and lines[end].strip() and lines[end][:1].isspace():
        end += 1
    return lines[index + 1:end]


def _list_items(lines: list[str], outside: list[tuple[int, str]]) -> list[FollowupItem]:
    items: list[FollowupItem] = []
    section: str | None = None
    for index, line in outside:
        if line.startswith("## "):
            section = _heading_text(line)
        item_match = TOP_LEVEL_ITEM.match(line)
        if item_match:
            lead = _lead_text(item_match.group(1), _indented_lines_after(lines, index))
            items.append(_list_item(index, lead, section))
    return items


def _lead_text(first_line: str, continuation: list[str]) -> str:
    """A list item's first line, joined with single spaces to its continuation
    lines up to the one that closes a bold title the first line opens and
    leaves open."""
    lead = first_line.strip()
    opens_unclosed_bold = lead.removeprefix("~~").startswith("**") and "**" not in lead.removeprefix("~~")[2:]
    if not opens_unclosed_bold:
        return lead
    for position, line in enumerate(continuation):
        if "**" in line:
            return " ".join([lead, *(part.strip() for part in continuation[:position + 1])])
    return lead


def _list_item(index: int, first_line: str, section: str | None) -> FollowupItem:
    text, struck = _unstrike(first_line)
    title, tags, gist = _title_tags_gist(text)
    return FollowupItem(
        title=title,
        line=index + 1,
        gist=gist[:GIST_LIMIT],
        status=_status(gist, struck),
        section=section,
        tags=tags,
    )


def _title_tags_gist(text: str) -> tuple[str, list[str], str]:
    """The title, tags and gist of a list item's or Contents line's text: the
    bold lead or the first sentence (a trailing . dropped) as title, then an
    italic span closed by a colon as tags, then the gist."""
    if text.startswith("**") and "**" in text[2:]:
        bold_end = text.index("**", 2)
        title = text[2:bold_end].strip().rstrip(":").strip()
        rest = text[bold_end + 2:]
    else:
        sentence_end = text.find(". ")
        title = text.removesuffix(".") if sentence_end < 0 else text[:sentence_end]
        rest = "" if sentence_end < 0 else text[sentence_end + 2:]
    rest = rest.lstrip(":—– ")
    tags: list[str] = []
    span = TAG_SPAN.match(rest)
    if span:
        words = span.group(1) or span.group(2)
        tags = [tag.strip() for tag in words.split(",") if tag.strip()]
        rest = rest[span.end():]
    return title, tags, rest.strip()


def _unstrike(text: str) -> tuple[str, bool]:
    """text with a leading ~~…~~ strike-through removed, and whether it had one."""
    if text.startswith("~~") and "~~" in text[2:]:
        close = text.index("~~", 2)
        return text[2:close] + text[close + 2:], True
    return text, False


def _status(after_title: str, struck: bool) -> str:
    is_shipped = after_title.lower().startswith("shipped")
    return "done" if struck or is_shipped else "open"


def _heading_text(line: str) -> str:
    """A heading line's text, without its marks and closing # run; "" when it holds none."""
    match = HEADING.match(line)
    return match.group(2).strip() if match else ""


def front_matter_end(lines: list[str]) -> int | None:
    """Index of the line closing the front matter, or None when there is none."""
    if not is_front_matter_fence(lines[0]):
        return None
    for index in range(1, len(lines)):
        if is_front_matter_fence(lines[index]):
            return index
    return None


def lines_outside_fences(lines: list[str], start: int) -> Iterator[tuple[int, str]]:
    """(index, line) for each line from start that sits outside a fenced
    block; the fence lines themselves are left out. A fence opens on a run of
    3+ backticks or 3+ tildes and closes only on a run of the same character
    at least as long with nothing but whitespace after it, as CommonMark has it."""
    fence: str | None = None
    for index in range(start, len(lines)):
        line = lines[index]
        match = FENCE.match(line.lstrip())
        if fence is None:
            if match and not _is_inline_code(match):
                fence = match.group(1)
                continue
            yield index, line
        elif match and _closes(match, fence):
            fence = None


def _is_inline_code(match: re.Match) -> bool:
    """Whether a backtick run is a code span rather than a fence: a backtick
    fence's info string holds no backtick."""
    return match.group(1)[0] == "`" and "`" in match.group(2)


def _closes(match: re.Match, fence: str) -> bool:
    run = match.group(1)
    return run[0] == fence[0] and len(run) >= len(fence) and not match.group(2).strip()


def _list_run(lines: list[str], start: int, end: int) -> tuple[list, int]:
    """The `- item` values on the lines from start, and the index after them."""
    items: list = []
    index = start
    while index < end and lines[index].strip().startswith("- "):
        items.append(_scalar(lines[index].strip()[2:]))
        index += 1
    return items, index


def _indented_run(lines: list[str], start: int, end: int) -> tuple[list[str], int]:
    """The indented and blank lines from start up to the next top-level line,
    trailing blanks dropped, and the index of that next line."""
    index = start
    while index < end and (not lines[index].strip() or lines[index][:1].isspace()):
        index += 1
    run = lines[start:index]
    while run and not run[-1].strip():
        run.pop()
    return run, index


def _block_scalar(header: str, body: list[str]) -> str:
    """The value of a `>` or `|` block scalar from its header and body lines."""
    indents = [len(line) - len(line.lstrip()) for line in body if line.strip()]
    indent = min(indents, default=0)
    dedented = [line[indent:] if line.strip() else "" for line in body]
    value = "\n".join(dedented) if header[0] == "|" else _fold([line.strip() for line in dedented])
    return value if "-" in header or not value else value + "\n"


def _fold(lines: list[str]) -> str:
    """lines joined with single spaces, each blank line becoming a newline."""
    folded = ""
    for line in lines:
        if not line:
            folded += "\n"
        elif folded and not folded.endswith("\n"):
            folded += " " + line
        else:
            folded += line
    return folded


def _scalar(value: str) -> str | bool:
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"":
        return value[1:-1]
    if value in ("true", "false"):
        return value == "true"
    return value
