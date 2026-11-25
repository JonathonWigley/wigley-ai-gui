"""Reads load events from Claude Code transcripts: each row that loads a file,
a subagent or a command, at the row's timestamp (README § Last loaded).

machine_load_times reads every transcript in the Claude config folders and
keeps the loads cache, ~/.agents/wigley-docs/loads.json: each transcript's
offset read up to and the times found so far, so a run parses only rows
appended since the last one. A cache of another shape reads as empty and is
rebuilt. session_load_times reads one session's transcript and its subagents'
alone, with no cache. Both skip a transcript that cannot be read. last_loaded
matches an entry's locations against those times: by real path, and by
listing name for a subagent or a command; a hook or a plugin has no time.
"""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Iterator

from atomic_write import write_through_temp
from environment import Environment
from listing import listing_name
from model import UNLOADED_KINDS, Entry

FILE_ATTACHMENT_TYPES = ("file", "compact_file_reference")
LOAD_ATTACHMENT_TYPES = frozenset(kind.encode() for kind in
                                  ("instructions", "nested_memory", *FILE_ATTACHMENT_TYPES, "invoked_skills"))
# Claude Code writes compact JSON with an attachment row's own type first in its attachment object.
ATTACHMENT_TYPE_KEY = b'"attachment":{"type":"'
# Bytes every other load row holds; a line with none is never parsed.
LOAD_MARKERS = (b'"name":"Read"', b'"name":"Agent"', b'"name":"Task"',
                b"Base directory for this skill", b"<command-name>")
SKILL_BASE_PREFIX = "Base directory for this skill: "
COMMAND_NAME = re.compile(r"<command-name>/([^<]+)</command-name>")
SUBAGENT_KEY_PREFIX = "subagent:"
COMMAND_KEY_PREFIX = "command:"
NAME_KEY_PREFIXES = {"subagent": SUBAGENT_KEY_PREFIX, "command": COMMAND_KEY_PREFIX}
LOADS_PATH_PARTS = (".agents", "wigley-docs", "loads.json")
CACHE_VERSION = 1
JOURNAL_NAME = "journal.jsonl"
SUBAGENT_TOOL_NAMES = ("Agent", "Task")


@dataclass
class LoadTimes:
    """The latest load time of each loaded real path, and of each
    subagent:<name> and command:<name> key, as the loading row's timestamp."""

    paths: dict[str, str] = field(default_factory=dict)
    names: dict[str, str] = field(default_factory=dict)

    def merge(self, other: LoadTimes) -> None:
        """Keep, per key, the later of this time and other's."""
        for path, time in other.paths.items():
            _keep_later(self.paths, path, time)
        for name, time in other.names.items():
            _keep_later(self.names, name, time)


def read_loads(transcript: Path, offset: int = 0) -> tuple[LoadTimes, int]:
    """The loads in the transcript's complete lines from offset on, and the
    offset of the end of the last complete line."""
    loads = LoadTimes()
    real_paths: dict[str, str] = {}
    with transcript.open("rb") as file:
        file.seek(offset)
        for line in file:
            if not line.endswith(b"\n"):
                break
            offset += len(line)
            if _may_hold_loads(line):
                _add_row_loads(loads, line, real_paths)
    return loads, offset


def _may_hold_loads(line: bytes) -> bool:
    """Whether the line can be a load row: an attachment row of a load type,
    or another row holding a load marker."""
    type_start = line.find(ATTACHMENT_TYPE_KEY)
    if type_start < 0:
        return any(marker in line for marker in LOAD_MARKERS)
    type_start += len(ATTACHMENT_TYPE_KEY)
    return line[type_start:line.find(b'"', type_start)] in LOAD_ATTACHMENT_TYPES


def machine_load_times(env: Environment) -> LoadTimes:
    """The load times of every transcript in env's Claude config folders,
    each read from its cached offset, merged onto the cached times; writes
    the cache back with each transcript found and its new offset."""
    times, offsets = _read_cache(env.home.joinpath(*LOADS_PATH_PARTS))
    read_offsets: dict[str, int] = {}
    for transcript in _machine_transcripts(env):
        key = str(transcript)
        offset = offsets.get(key, 0)
        try:
            size = transcript.stat().st_size
            if size != offset:
                loads, offset = read_loads(transcript, offset if size > offset else 0)
                times.merge(loads)
        except OSError:
            continue
        read_offsets[key] = offset
    _write_cache(env.home.joinpath(*LOADS_PATH_PARTS),
                 {"version": CACHE_VERSION, "transcripts": read_offsets, "paths": times.paths, "names": times.names})
    return times


def session_load_times(transcript: Path) -> LoadTimes:
    """The load times of one session: its transcript and every subagent
    transcript beside it, each read whole; a transcript that cannot be read,
    gone since the glob or refused, is skipped as the machine scan skips it."""
    times = LoadTimes()
    for file in [transcript, *subagent_transcripts(transcript)]:
        try:
            times.merge(read_loads(file, 0)[0])
        except OSError:
            continue
    return times


def subagent_transcripts(transcript: Path) -> list[Path]:
    """The subagent and workflow agent transcripts beside a main transcript,
    <id>/subagents/**/*.jsonl, in sorted path order, journal.jsonl left out."""
    return [path for path in sorted(transcript.with_suffix("").glob("subagents/**/*.jsonl"))
            if path.name != JOURNAL_NAME]


def last_loaded(env: Environment, entry: Entry, times: LoadTimes) -> str | None:
    """The latest time among the entry's locations: each location's real
    path, and for a subagent or command its listing name there. None when no
    location has a time, and for a hook or plugin, which no row loads."""
    if entry.kind in UNLOADED_KINDS:
        return None
    name_prefix = NAME_KEY_PREFIXES.get(entry.kind)
    candidates: list[str | None] = []
    for location in entry.locations:
        candidates.append(times.paths.get(os.path.realpath(location.path)))
        if name_prefix is not None:
            candidates.append(times.names.get(name_prefix + listing_name(env, entry, location)))
    found = [time for time in candidates if time is not None]
    return max(found, key=datetime.fromisoformat, default=None)


def _machine_transcripts(env: Environment) -> Iterator[Path]:
    """Each main-session and subagent transcript in env's Claude config
    folders, in folder order, journal.jsonl left out."""
    for folder in env.claude_config_dirs:
        for pattern in ("projects/*/*.jsonl", "projects/*/*/subagents/**/*.jsonl"):
            yield from (path for path in sorted(folder.glob(pattern)) if path.name != JOURNAL_NAME)


def _read_cache(path: Path) -> tuple[LoadTimes, dict[str, int]]:
    """The cached times and transcript offsets; empty when the cache is
    absent, unreadable or of another shape."""
    try:
        cache = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return LoadTimes(), {}
    if not _is_valid_cache(cache):
        return LoadTimes(), {}
    return LoadTimes(paths=cache["paths"], names=cache["names"]), cache["transcripts"]


def _is_valid_cache(cache: object) -> bool:
    if not isinstance(cache, dict):
        return False
    version = cache.get("version")
    is_this_version = type(version) is int and version == CACHE_VERSION
    transcripts, paths, names = cache.get("transcripts"), cache.get("paths"), cache.get("names")
    has_valid_offsets = isinstance(transcripts, dict) and all(
        type(offset) is int and offset >= 0 for offset in transcripts.values())
    has_valid_times = all(isinstance(times, dict) and all(_is_offset_time(time) for time in times.values())
                          for times in (paths, names))
    return is_this_version and has_valid_offsets and has_valid_times


def _write_cache(path: Path, cache: dict) -> None:
    """Write through a temp file named for this process, so two runs at once never share one."""
    write_through_temp(path, path.with_name(f"{path.name}.{os.getpid()}.tmp"), json.dumps(cache))


def _add_row_loads(loads: LoadTimes, line: bytes, real_paths: dict[str, str]) -> None:
    """Add the row's loads to loads; real_paths caches each path's real path across one read."""
    try:
        row = json.loads(line)
    except ValueError:
        return
    if not isinstance(row, dict):
        return
    time = _row_time(row)
    if time is None:
        return
    for path in _row_paths(row):
        if isinstance(path, str) and path and os.path.isabs(path):
            _keep_later(loads.paths, _real_path(real_paths, path), time)
    for prefix, name in _row_names(row):
        if isinstance(name, str) and name:
            _keep_later(loads.names, prefix + name, time)


def _real_path(real_paths: dict[str, str], path: str) -> str:
    """os.path.realpath(path), resolved once per path held in real_paths."""
    real = real_paths.get(path)
    if real is None:
        real = real_paths[path] = os.path.realpath(path)
    return real


def _row_time(row: dict) -> str | None:
    """The row's timestamp when it parses with a UTC offset, else None."""
    time = row.get("timestamp")
    return time if _is_offset_time(time) else None


def _is_offset_time(value: object) -> bool:
    """Whether value is a string datetime.fromisoformat parses with a UTC offset."""
    if not isinstance(value, str):
        return False
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return False
    return parsed.tzinfo is not None


def _row_paths(row: dict) -> Iterator[object]:
    kind = row.get("type")
    if kind == "attachment":
        yield from _attachment_paths(_as_dict(row.get("attachment")))
    elif kind == "user":
        content = _as_dict(row.get("message")).get("content")
        if isinstance(content, list):
            for item in _dicts(content):
                if item.get("type") == "text":
                    yield from _skill_file(item.get("text"))
    elif kind == "assistant":
        for tool_input in _tool_inputs(row, ("Read",)):
            yield tool_input.get("file_path")


def _row_names(row: dict) -> Iterator[tuple[str, object]]:
    kind = row.get("type")
    if kind == "user":
        content = _as_dict(row.get("message")).get("content")
        if isinstance(content, str):
            for match in COMMAND_NAME.finditer(content):
                yield COMMAND_KEY_PREFIX, match.group(1).strip()
    elif kind == "assistant":
        for tool_input in _tool_inputs(row, SUBAGENT_TOOL_NAMES):
            yield SUBAGENT_KEY_PREFIX, tool_input.get("subagent_type")


def _attachment_paths(attachment: dict) -> Iterator[object]:
    kind = attachment.get("type")
    if kind == "instructions":
        for file in _dicts(attachment.get("files")):
            yield file.get("path")
    elif kind == "nested_memory":
        yield attachment.get("path")
    elif kind in FILE_ATTACHMENT_TYPES:
        yield attachment.get("filename")
    elif kind == "invoked_skills":
        for skill in _dicts(attachment.get("skills")):
            yield from _skill_file(skill.get("content"))


def _skill_file(text: object) -> Iterator[str]:
    """<dir>/SKILL.md when text starts with the skill base-directory line."""
    if isinstance(text, str) and text.startswith(SKILL_BASE_PREFIX):
        skill_dir = text[len(SKILL_BASE_PREFIX):].split("\n", 1)[0]
        yield os.path.join(skill_dir, "SKILL.md")


def _tool_inputs(row: dict, tool_names: tuple[str, ...]) -> Iterator[dict]:
    """The input of each tool_use in the row's message named one of tool_names."""
    for item in _dicts(_as_dict(row.get("message")).get("content")):
        if item.get("type") == "tool_use" and item.get("name") in tool_names:
            yield _as_dict(item.get("input"))


def _keep_later(times: dict[str, str], key: str, time: str) -> None:
    held = times.get(key)
    if held is None or datetime.fromisoformat(time) > datetime.fromisoformat(held):
        times[key] = time


def _as_dict(value: object) -> dict:
    return value if isinstance(value, dict) else {}


def _dicts(value: object) -> Iterator[dict]:
    if isinstance(value, list):
        yield from (item for item in value if isinstance(item, dict))
