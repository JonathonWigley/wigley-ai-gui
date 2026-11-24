"""Reads one Claude Code session's transcript and records which entries it
shows loaded: the first instructions attachment holds the launch files, later
instructions and nested_memory attachments the files loaded on demand, and the
skill and agent listings the names listed. The same pass collects the
plugin versions the transcript names, from every plugin cache path in its text.
The transcript is found in the first configured Claude config folder that holds
it, and is read one row at a time, since a single row can be megabytes long.
"""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator

from environment import Environment
from listing import listing_name
from markdown import heading_title
from model import UNLOADED_KINDS, Context, Entry, State

HARNESS = "claude"
LAUNCH_REASON = "loaded at session start"
ON_DEMAND_REASON = "loaded during the session"
SKILL_LISTED_REASON = "in the session's skill listing"
AGENT_LISTED_REASON = "in the session's agent listing"
NOT_LOADED_REASON = "not in this session's transcript"
PATH_SEPARATOR = r"(?:\\{1,2}|/)"
CACHE_NAME = r"[A-Za-z0-9._-]+"
CACHE_VERSION = r"[A-Za-z0-9._+-]*[A-Za-z0-9]"


class SessionNotFound(Exception):
    """No transcript for the session id, or a transcript with no cwd."""


class _TranscriptLoads:
    """What one pass over a transcript collected: real path to State for each
    loaded file, in load order, and the skill and agent names listed."""

    def __init__(self) -> None:
        self.paths: dict[str, State] = {}
        self.skill_names: set[str] = set()
        self.agent_names: set[str] = set()
        self.seen_instructions = False

    def add(self, attachment: dict) -> None:
        kind = attachment.get("type")
        if kind == "instructions":
            state = State("on-demand", ON_DEMAND_REASON) if self.seen_instructions else State("launch", LAUNCH_REASON)
            self.seen_instructions = True
            for file in attachment.get("files") or []:
                if isinstance(file, dict):
                    self._load(file.get("path"), state)
        elif kind == "nested_memory":
            self._load(attachment.get("path"), State("on-demand", ON_DEMAND_REASON))
        elif kind == "skill_listing":
            self.skill_names.update(attachment.get("names") or [])
        elif kind == "agent_listing_delta":
            self.agent_names.update(attachment.get("addedTypes") or [])

    def _load(self, path: str | None, state: State) -> None:
        if not path:
            return
        real = os.path.realpath(path)
        is_already_launch = real in self.paths and self.paths[real].state == "launch"
        if not is_already_launch:
            self.paths[real] = state


@dataclass
class SessionTranscript:
    """One session's transcript as read in one pass: folder is the real path
    of its cwd, config_dir the configured Claude config folder holding the
    transcript, transcript the transcript file, loads what its attachments
    loaded, loaded_plugins each <plugin>@<marketplace> whose cache path the
    transcript names, mapped to the version of the last such path."""
    session_id: str
    folder: Path
    config_dir: Path
    transcript: Path
    loads: _TranscriptLoads
    loaded_plugins: dict[str, str]


def read_session(env: Environment, session_id: str) -> SessionTranscript:
    """The session's transcript, found once and read in one pass: the real
    path of the first cwd a row holds, every attachment's loads, and the
    plugin versions named by the cache paths in every line's text, a line that
    is not JSON included."""
    config_dir, transcript = _transcript_path(env, session_id)
    cache_path = _cache_path_pattern(env)
    cwd = None
    loads = _TranscriptLoads()
    loaded_plugins: dict[str, str] = {}
    for line, row in _rows(transcript):
        for match in cache_path.finditer(line):
            loaded_plugins[f"{match['plugin']}@{match['marketplace']}"] = match["version"]
        if row is None:
            continue
        cwd = cwd or row.get("cwd")
        attachment = row.get("attachment")
        if row.get("type") == "attachment" and isinstance(attachment, dict):
            loads.add(attachment)
    if not cwd:
        raise _no_cwd(transcript, session_id)
    return SessionTranscript(session_id=session_id, folder=Path(os.path.realpath(cwd)),
                             config_dir=config_dir, transcript=transcript, loads=loads,
                             loaded_plugins=loaded_plugins)


def session_context(env: Environment, session: SessionTranscript, entries: list[Entry],
                    reaching: list[Entry]) -> tuple[Context, list[Entry]]:
    """The session's Context over reaching, the entries that reach the
    session's folder, plus each entry the transcript shows loaded, claude
    harness only, and a new instructions Entry for each loaded file that no
    entry in entries covers."""
    loads = session.loads

    entry_ids = {entry.id for entry in entries}
    new_entries = [_loaded_file_entry(path, entries) for path in loads.paths if path not in entry_ids]
    reaching_ids = {entry.id for entry in reaching}
    loaded_out_of_reach = [entry for entry in entries
                           if entry.id in loads.paths and entry.id not in reaching_ids]
    states: dict[str, dict[str, State]] = {}
    for entry in [*reaching, *loaded_out_of_reach, *new_entries]:
        if entry.kind in UNLOADED_KINDS:
            continue
        states[entry.id] = {HARNESS: _entry_state(env, entry, loads)}
    context = Context(folder=str(session.folder), session_id=session.session_id, states=states,
                      loaded_plugins=session.loaded_plugins)
    return context, new_entries


def _entry_state(env: Environment, entry: Entry, loads: _TranscriptLoads) -> State:
    if entry.id in loads.paths:
        return loads.paths[entry.id]
    is_skill_or_command = entry.kind in ("skill", "command")
    names = {listing_name(env, entry, location) for location in entry.locations}
    if is_skill_or_command and not names.isdisjoint(loads.skill_names):
        return State("listed", SKILL_LISTED_REASON)
    if entry.kind == "subagent" and not names.isdisjoint(loads.agent_names):
        return State("listed", AGENT_LISTED_REASON)
    return State("not-loaded", NOT_LOADED_REASON)


def _loaded_file_entry(path: str, entries: list[Entry]) -> Entry:
    """An instructions Entry for a file the transcript loaded and the scan did
    not find, owned by the repo entry with the deepest root holding it."""
    owners = [entry for entry in entries
              if entry.source == "repo" and entry.root and Path(path).is_relative_to(entry.root)]
    owner = max(owners, key=lambda entry: len(entry.root), default=None)
    return Entry(
        id=path,
        kind="instructions",
        source="repo" if owner else "global",
        repo=owner.repo if owner else None,
        root=owner.root if owner else None,
        plugin=None,
        path=path,
        line=None,
        title=_file_title(Path(path)),
        meta={"imports": []},
    )


def _file_title(path: Path) -> str:
    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return path.name
    return heading_title(text) or path.name


def _no_cwd(transcript: Path, session_id: str) -> SessionNotFound:
    return SessionNotFound(f"transcript {transcript} of session {session_id} has no row with a cwd")


def _transcript_path(env: Environment, session_id: str) -> tuple[Path, Path]:
    """(config folder, transcript) for the first <project>/<session_id>.jsonl
    directly under a config folder's projects, the folders in configured
    order and each one's projects in sorted order."""
    for config_dir in env.claude_config_dirs:
        projects = config_dir / "projects"
        if not projects.is_dir():
            continue
        for project in sorted(child for child in projects.iterdir() if child.is_dir()):
            candidate = project / f"{session_id}.jsonl"
            if candidate.is_file():
                return config_dir, candidate
    searched = ", ".join(str(config_dir / "projects") for config_dir in env.claude_config_dirs)
    raise SessionNotFound(f"no transcript for session {session_id} under {searched}")


def _cache_path_pattern(env: Environment) -> re.Pattern[str]:
    """Matches <config folder>/plugins/cache/<marketplace>/<plugin>/<version>
    for each configured Claude config folder, in its written and real forms,
    each separator a slash, a backslash or a JSON-escaped double backslash."""
    forms = dict.fromkeys(form for config_dir in env.claude_config_dirs
                          for form in (str(config_dir), os.path.realpath(config_dir)))
    folders = "|".join(PATH_SEPARATOR.join(re.escape(part) for part in re.split(r"[\\/]", form))
                       for form in forms)
    return re.compile(f"(?:{folders}){PATH_SEPARATOR}plugins{PATH_SEPARATOR}cache"
                      f"{PATH_SEPARATOR}(?P<marketplace>{CACHE_NAME}){PATH_SEPARATOR}(?P<plugin>{CACHE_NAME})"
                      f"{PATH_SEPARATOR}(?P<version>{CACHE_VERSION})")


def _rows(transcript: Path) -> Iterator[tuple[str, dict | None]]:
    """Each line of the transcript with the JSON object it parses as, None
    for a line that is not a JSON object."""
    with transcript.open(encoding="utf-8", errors="replace") as file:
        for line in file:
            try:
                row = json.loads(line)
            except ValueError:
                row = None
            yield line, row if isinstance(row, dict) else None
