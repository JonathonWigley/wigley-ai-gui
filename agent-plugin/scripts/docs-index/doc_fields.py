"""Each entry's headings and outgoing links, read from the entry's file and
resolved against the listed entries. README's Headings and links section holds
the rules. A file that cannot be read gives an entry no fields and a reference
no link, never an error.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass, replace
from pathlib import Path
from urllib.parse import unquote

from config import expand_home
from markdown import read_exact_text
from model import UNLOADED_KINDS, DocHeading, DocLink, Entry
from rules import nearest_repo_root
from section_refs import (BARE_BLOCKER, EMPHASIS, MARKDOWN_LINK, PARAGRAPH_BREAK, Heading, ProseText, body_lines,
                          parse_headings, section_pointer, source_length, walk_headings)

BARE_SIGN = re.compile(r"§ ")
BARE_BLOCKER_WINDOW = 40
HREF_SCHEME = re.compile(r"^[A-Za-z][A-Za-z0-9+.-]*:")


class _Bodies:
    """Each file's body lines and headings, read once."""

    def __init__(self) -> None:
        self._lines: dict[str, list[str] | None] = {}
        self._headings: dict[str, list[Heading] | None] = {}

    def lines(self, path: str) -> list[str] | None:
        """path's body lines, or None when it cannot be read."""
        if path not in self._lines:
            self._lines[path] = _read_body_lines(path)
        return self._lines[path]

    def headings(self, path: str) -> list[Heading] | None:
        """path's headings at every level, or None when it cannot be read."""
        if path not in self._headings:
            lines = self.lines(path)
            self._headings[path] = None if lines is None else parse_headings(lines)
        return self._headings[path]


@dataclass(frozen=True)
class _Listing:
    """What a reference can resolve to, by real path: every listed path, the
    paths of mine entries by base name, the skills of each linked plugin key
    by name, and the clone roots of each repo; with the skill link prefixes,
    each mapped to its plugin key, and the § pointer pattern for them."""

    home: Path
    paths: frozenset[str]
    mine_by_name: dict[str, set[str]]
    skills: dict[str, dict[str, str]]
    clone_roots: dict[str, set[str]]
    link_prefixes: dict[str, str]
    pointer: re.Pattern[str]

    def listed(self, candidate: str) -> str | None:
        try:
            real = os.path.realpath(candidate)
        except ValueError:  # A path holding a NUL, as a decoded %00 gives.
            return None
        return real if real in self.paths else None

    def skill(self, prefix: str, name: str) -> str | None:
        """The SKILL.md a skill link <prefix><name> names, or None."""
        return self.skills.get(self.link_prefixes[prefix], {}).get(name)


@dataclass(frozen=True)
class _Source:
    """The doc a reference sits in. repo_root is None for a file in no repo."""

    entry: Entry
    path: str
    folder: str
    repo_root: str | None


def with_doc_fields(entries: list[Entry], home: Path, link_prefixes: dict[str, str]) -> list[Entry]:
    """Each entry, in order, with its headings and links. A skill link
    <prefix><name> resolves to the skill name of the plugin key
    link_prefixes[prefix]."""
    bodies = _Bodies()
    listing = _listing_of(entries, home, link_prefixes)
    return [_with_fields(entry, bodies, listing) for entry in entries]


def _read_body_lines(path: str) -> list[str] | None:
    try:
        return body_lines(read_exact_text(Path(path), errors="replace"))
    except OSError:
        return None


def _listing_of(entries: list[Entry], home: Path, link_prefixes: dict[str, str]) -> _Listing:
    paths: set[str] = set()
    mine_by_name: dict[str, set[str]] = {}
    clone_roots: dict[str, set[str]] = {}
    for entry in entries:
        if entry.source == "repo" and entry.repo and entry.root:
            clone_roots.setdefault(entry.repo, set()).add(entry.root)
        if entry.kind in UNLOADED_KINDS:
            continue
        real = os.path.realpath(entry.path)
        paths.add(real)
        if entry.ownership == "mine":
            mine_by_name.setdefault(os.path.basename(real), set()).add(real)
    skills = _plugin_skills(entries, set(link_prefixes.values()))
    return _Listing(home, frozenset(paths), mine_by_name, skills, clone_roots, dict(link_prefixes),
                    section_pointer(link_prefixes))


def _plugin_skills(entries: list[Entry], plugin_keys: set[str]) -> dict[str, dict[str, str]]:
    """Plugin key, then skill name, then the real path of its SKILL.md, for
    each of plugin_keys: the first by path in a clone, else the first by path
    in an install."""
    in_clones: dict[str, dict[str, str]] = {key: {} for key in plugin_keys}
    in_installs: dict[str, dict[str, str]] = {key: {} for key in plugin_keys}
    for entry in sorted(entries, key=lambda entry: entry.path):
        is_linked_skill = entry.kind == "skill" and entry.plugin in plugin_keys
        if not is_linked_skill:
            continue
        name = Path(entry.path).parent.name
        if entry.source == "repo":
            in_clones[entry.plugin].setdefault(name, os.path.realpath(entry.path))
        elif entry.source == "plugin":
            in_installs[entry.plugin].setdefault(name, os.path.realpath(entry.path))
    return {key: {**in_installs[key], **in_clones[key]} for key in plugin_keys}


def _with_fields(entry: Entry, bodies: _Bodies, listing: _Listing) -> Entry:
    has_body = entry.line is None and entry.kind not in UNLOADED_KINDS and entry.path.endswith(".md")
    if not has_body:
        return entry
    path = os.path.realpath(entry.path)
    headings = bodies.headings(path)
    if headings is None:
        return entry
    doc_headings = tuple(DocHeading(heading.level, heading.text, heading.line) for heading in headings)
    if entry.ownership != "mine":
        return replace(entry, headings=doc_headings)
    return replace(entry, headings=doc_headings, links=_links_of(entry, path, bodies, listing))


def _links_of(entry: Entry, path: str, bodies: _Bodies, listing: _Listing) -> tuple[DocLink, ...]:
    """The doc's links in source order. Form 1 closes its spans to forms 2 and
    3, and a file or skill pointer that resolves to nothing closes its § to form 3."""
    prose = ProseText(bodies.lines(path))
    folder = os.path.dirname(path)
    repo_root = nearest_repo_root(Path(folder))
    source = _Source(entry, path, folder, str(repo_root) if repo_root else None)
    found: list[tuple[int, DocLink]] = []
    markdown_spans: list[tuple[int, int]] = []
    for match in MARKDOWN_LINK.finditer(prose.text):
        if prose.in_code_span(match.start()):
            continue
        markdown_spans.append(match.span())
        _add_link(found, match.start(), _markdown_link(match, prose, source, bodies, listing))
    pointer_signs: set[int] = set()
    for match in listing.pointer.finditer(prose.text):
        sign = match.end() - len("§ ")
        pointer_signs.add(sign)
        if _is_closed(sign, prose, markdown_spans):
            continue
        target = _pointer_target(match, source, listing)
        if target is not None:
            _add_link(found, match.start(), _section_link(prose, match.start(), match.end(), target, bodies))
    for match in BARE_SIGN.finditer(prose.text):
        sign = match.start()
        before = prose.text[max(0, sign - BARE_BLOCKER_WINDOW):sign]
        if sign in pointer_signs or _is_closed(sign, prose, markdown_spans) or BARE_BLOCKER.search(before):
            continue
        _add_link(found, sign, _section_link(prose, sign, match.end(), path, bodies))
    return tuple(link for _, link in sorted(found, key=lambda item: item[0]))


def _add_link(found: list[tuple[int, DocLink]], start: int, link: DocLink | None) -> None:
    if link is not None:
        found.append((start, link))


def _is_closed(sign: int, prose: ProseText, markdown_spans: list[tuple[int, int]]) -> bool:
    return prose.in_code_span(sign) or any(start <= sign < end for start, end in markdown_spans)


def _section_link(prose: ProseText, start: int, remainder_start: int, target: str, bodies: _Bodies) -> DocLink | None:
    """The section link from start, whose heading text opens at remainder_start,
    or None when the target's headings hold no match."""
    headings = bodies.headings(target) if target.endswith(".md") else None
    if headings is None:
        return None
    paragraph_end = prose.text.find(PARAGRAPH_BREAK, remainder_start)
    remainder = prose.text[remainder_start:paragraph_end if paragraph_end >= 0 else len(prose.text)]
    walk = walk_headings(remainder.translate(EMPHASIS), headings)
    if walk.heading is None:
        return None
    end = remainder_start + source_length(remainder, walk.length)
    return DocLink("section", prose.source(start, end), target, prose.line_of(start), walk.heading.line)


def _pointer_target(match: re.Match[str], source: _Source, listing: _Listing) -> str | None:
    if match["skill"]:
        return listing.skill(match["prefix"], match["skill"])
    return _file_target(match["file"], source, listing)


def _file_target(token: str, source: _Source, listing: _Listing) -> str | None:
    """The target of a pointer's file token, first hit wins: the source's real
    folder, the repo root, then for a bare name.md the one mine entry so named."""
    if token.startswith("~/"):
        return listing.listed(expand_home(token, listing.home))
    if token.startswith("/"):
        return listing.listed(token)
    is_readme = token == "README"
    name = "README.md" if is_readme else token
    near = listing.listed(os.path.join(source.folder, name)) or _under_repo_root(name, source, listing)
    if near is not None or is_readme or "/" in name:
        return near
    named = listing.mine_by_name.get(name, set())
    return next(iter(named)) if len(named) == 1 else None


def _under_repo_root(name: str, source: _Source, listing: _Listing) -> str | None:
    """name under the source's repo root. A feature-home file in no repo tries
    each clone of its repo, and resolves only on exactly one listed hit."""
    if source.repo_root is not None:
        return listing.listed(os.path.join(source.repo_root, name))
    if source.entry.source != "features":
        return None
    roots = listing.clone_roots.get(source.entry.repo or "", set())
    hits = {listing.listed(os.path.join(root, name)) for root in roots} - {None}
    return next(iter(hits)) if len(hits) == 1 else None


def _markdown_link(
    match: re.Match[str], prose: ProseText, source: _Source, bodies: _Bodies, listing: _Listing
) -> DocLink | None:
    href = match.group(1) if match.group(1) is not None else match.group(2)
    place = _href_place(href, source, bodies, listing)
    if place is None:
        return None
    target, target_line = place
    return DocLink("markdown", prose.source(*match.span()), target, prose.line_of(match.start()), target_line)


def _href_place(href: str, source: _Source, bodies: _Bodies, listing: _Listing) -> tuple[str, int | None] | None:
    """The target and target line an href names, or None when it gives no link."""
    prefix = max((prefix for prefix in listing.link_prefixes if href.startswith(prefix)), key=len, default=None)
    if prefix is not None:
        skill = listing.skill(prefix, href.removeprefix(prefix).partition("#")[0])
        return None if skill is None else (skill, None)
    if HREF_SCHEME.match(href):
        return None
    path_part, _, fragment = href.partition("#")
    if not path_part:
        target_line = _fragment_line(fragment, source.path, bodies)
        return None if target_line is None else (source.path, target_line)
    path = unquote(path_part)
    if path.startswith("~/"):
        target = listing.listed(expand_home(path, listing.home))
    elif path.startswith("/"):
        target = listing.listed(path)
    else:
        target = listing.listed(os.path.join(source.folder, path))
    if target is None:
        return None
    target_line = _fragment_line(fragment, target, bodies) if target.endswith(".md") else None
    return target, target_line


def _fragment_line(fragment: str, target: str, bodies: _Bodies) -> int | None:
    """The line of target's first heading whose slug is fragment, or None."""
    if not fragment:
        return None
    for heading in bodies.headings(target) or []:
        if _heading_slug(heading.text) == fragment:
            return heading.line
    return None


def _heading_slug(text: str) -> str:
    """GitHub's anchor for a heading: lowercase, alphanumerics, spaces, - and _
    kept, each space then a -."""
    kept = "".join(char for char in text.lower() if char.isalnum() or char in " -_")
    return kept.replace(" ", "-")
