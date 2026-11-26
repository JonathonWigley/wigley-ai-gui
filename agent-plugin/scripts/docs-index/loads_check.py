"""Checks one Claude Code session's instructions loads against the files its
folder is predicted to load at launch (README § Loads check). A check point is
one instructions attachment row that lists the session's launch files: the
main transcript's first, the first after each compact_boundary, and each
non-Explore subagent transcript's first. missing_loads names each predicted
launch file a point leaves out.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator

from loads import ATTACHMENT_TYPE_KEY, subagent_transcripts
from model import UNLOADED_KINDS, Entry

MAIN = "main"
COMPACT_PREFIX = "compact:"
SUBAGENT_PREFIX = "subagent:"
SUBAGENT_FILE_PREFIX = "agent-"
META_SUFFIX = ".meta.json"
EXPLORE_TYPE = "Explore"
INSTRUCTIONS_KEY = ATTACHMENT_TYPE_KEY + b'instructions"'
BOUNDARY_MARKER = b"compact_boundary"


@dataclass(frozen=True)
class CheckPoint:
    """One instructions row a check reads: where names it (main,
    compact:<n> or subagent:<agent id>), paths holds the real path of each
    file the row lists."""

    where: str
    paths: frozenset[str]


def check_points(transcript: Path) -> list[CheckPoint]:
    """The session's check points, in order: the main transcript's first
    instructions row, the first row after each of its compact boundaries,
    then each non-Explore subagent transcript's first row, in sorted path
    order. A transcript or boundary with no instructions row gives none."""
    points = _main_points(transcript)
    for subagent in subagent_transcripts(transcript):
        if _is_explore(subagent):
            continue
        first = next((row for row in _rows(subagent) if _is_instructions(row)), None)
        if first is not None:
            points.append(CheckPoint(SUBAGENT_PREFIX + _agent_id(subagent), _listed_paths(first)))
    return points


def missing_loads(points: list[CheckPoint], launch: list[Entry]) -> list[dict]:
    """One item per check point and launch entry the point leaves out: an
    entry is present when the real path of any of its locations is in the
    point's paths. hook and plugin entries, which no instructions row lists,
    are skipped. Items keep point order, then launch order."""
    checked = [(entry, {os.path.realpath(location.path) for location in entry.locations})
               for entry in launch if entry.kind not in UNLOADED_KINDS]
    return [{"id": entry.id, "path": entry.path, "where": point.where}
            for point in points
            for entry, real_paths in checked
            if real_paths.isdisjoint(point.paths)]


def _main_points(transcript: Path) -> list[CheckPoint]:
    """The main transcript's first instructions row, as main, and the first
    row after the n-th compact boundary and before the next, as compact:<n>."""
    points: list[CheckPoint] = []
    has_main = False
    boundaries = 0
    awaiting_boundary_row = False
    for row in _rows(transcript):
        if _is_boundary(row):
            boundaries += 1
            awaiting_boundary_row = True
            continue
        if not has_main:
            points.append(CheckPoint(MAIN, _listed_paths(row)))
            has_main = True
        if awaiting_boundary_row:
            points.append(CheckPoint(f"{COMPACT_PREFIX}{boundaries}", _listed_paths(row)))
            awaiting_boundary_row = False
    return points


def _rows(transcript: Path) -> Iterator[dict]:
    """Each instructions attachment row and compact boundary row of the
    transcript, in order; a line holding neither marker is never parsed."""
    with transcript.open("rb") as file:
        for line in file:
            if INSTRUCTIONS_KEY not in line and BOUNDARY_MARKER not in line:
                continue
            try:
                row = json.loads(line)
            except ValueError:
                continue
            if isinstance(row, dict) and (_is_instructions(row) or _is_boundary(row)):
                yield row


def _is_instructions(row: dict) -> bool:
    attachment = row.get("attachment")
    is_attachment_row = row.get("type") == "attachment" and isinstance(attachment, dict)
    return is_attachment_row and attachment.get("type") == "instructions"


def _is_boundary(row: dict) -> bool:
    return row.get("type") == "system" and row.get("subtype") == "compact_boundary"


def _listed_paths(row: dict) -> frozenset[str]:
    files = row["attachment"].get("files")
    return frozenset(os.path.realpath(file["path"]) for file in files or []
                     if isinstance(file, dict) and isinstance(file.get("path"), str) and file["path"])


def _agent_id(subagent: Path) -> str:
    return subagent.stem.removeprefix(SUBAGENT_FILE_PREFIX)


def _is_explore(subagent: Path) -> bool:
    """Whether the subagent's meta file beside it names the Explore type;
    a missing or unreadable meta file reads as not Explore."""
    meta_path = subagent.with_name(subagent.stem + META_SUFFIX)
    try:
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return False
    return isinstance(meta, dict) and meta.get("agentType") == EXPLORE_TYPE
