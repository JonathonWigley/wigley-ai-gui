"""Codex's load rules: which discovered entries a Codex session opened in a
folder reads. Codex has no imports, reads its global AGENTS file from
~/.codex, walks the project docs from the git root down to the folder, lists
the skills in .agents/skills and its enabled plugins, and reads nothing that
is Claude Code's own (CLAUDE.md, anything under .claude or in a configured
Claude config folder, a Claude plugin) unless a project_doc_fallback_filenames entry names it.
A skill-file is not-loaded wherever it sits, since agents read it on a pointer.

Entries carry real paths; every path compared against them is resolved first.
An entry is judged at each of its locations (its real path, each path a
symlink reached it by, and each plugin install's copy of a marketplace
clone's file), each by that location's own owner (a Claude or Codex plugin's
file only where a plugin owns the location), and the best state kept. The AGENTS file choice follows codex-rs: in ~/.codex the
first candidate whose text is not blank wins; in a project folder the first
candidate that exists wins, and a blank winner loads nothing. A config.toml
value of the wrong shape prints one stderr line naming its key and reads as
its default.
"""

from __future__ import annotations

import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from config import expand_home
from environment import Environment, PluginInstall, setting_of_type, string_list_setting
from model import Entry, Location, Owner, State, best_state
from rules import nearest_repo_root

DEFAULT_PROJECT_DOC_MAX_BYTES = 32768
GLOBAL_DOC_NAMES = ("AGENTS.override.md", "AGENTS.md")
CLAUDE_FILE_NAMES = ("CLAUDE.md", "CLAUDE.local.md")

NO_RULE = State("not-loaded", "no load rule reaches this file")
CLAUDE_FILE = State("not-loaded", "Claude Code file")
BLANK_FILE = State("not-loaded", "blank file")
SKILL_FILE = State("not-loaded", "agents read skill files on a pointer")


@dataclass(frozen=True)
class _Scan:
    """What every entry's state is judged against, computed once per folder."""

    home: Path
    locate_config_file: Callable[[Path], tuple[Path, Path] | None]
    doc_states: dict[Path, State]
    candidate_names: tuple[str, ...]
    skill_bases: frozenset[Path]
    codex_installs: tuple[PluginInstall, ...]
    disabled_skill_paths: frozenset[Path]


class CodexRules:
    harness = "codex"

    def __init__(self, env: Environment):
        self._env = env

    def states(self, folder: Path, entries: list[Entry]) -> dict[str, State]:
        folder = folder.resolve()
        home = self._env.home.resolve()
        config = self._env.codex_config()
        config_path = self._env.home / ".codex" / "config.toml"
        fallback_names = string_list_setting(config, "project_doc_fallback_filenames", [], config_path)
        candidate_names = _candidate_names(fallback_names)
        max_bytes = setting_of_type(config, "project_doc_max_bytes", int, DEFAULT_PROJECT_DOC_MAX_BYTES, config_path)
        walk = _project_walk(folder)
        doc_states = _global_doc_states(home / ".codex")
        doc_states.update(_project_doc_states(walk, candidate_names, max_bytes))
        scan = _Scan(
            home=home,
            locate_config_file=self._env.locate_in_claude_config_dirs,
            doc_states=doc_states,
            candidate_names=candidate_names,
            skill_bases=frozenset((*walk, home)),
            codex_installs=tuple(self._env.codex_plugin_installs()),
            disabled_skill_paths=_disabled_skill_paths(config, config_path, self._env.home),
        )
        return {entry.id: _entry_state(entry, scan) for entry in entries}


def _candidate_names(fallback_names: list[str]) -> tuple[str, ...]:
    """The project doc names in the order Codex tries them: the AGENTS files,
    then each fallback name once, less one that is empty, "." or "..", or
    holds a "/" or a NUL."""
    names = list(GLOBAL_DOC_NAMES)
    for name in fallback_names:
        is_usable = name not in ("", ".", "..") and "/" not in name and "\0" not in name
        if is_usable and name not in names:
            names.append(name)
    return tuple(names)


def _project_walk(folder: Path) -> list[Path]:
    """The folders Codex reads project docs and skills from, git root first;
    folder alone when it is in no repo."""
    repo_root = nearest_repo_root(folder)
    if repo_root is None:
        return [folder]
    walk = [repo_root]
    for part in folder.relative_to(repo_root).parts:
        walk.append(walk[-1] / part)
    return walk


def _global_doc_states(codex_home: Path) -> dict[Path, State]:
    states: dict[Path, State] = {}
    candidates = [codex_home / name for name in GLOBAL_DOC_NAMES if (codex_home / name).is_file()]
    winner = next((candidate for candidate in candidates if not _is_blank(candidate)), None)
    for candidate in candidates:
        if candidate == winner:
            state = State("launch", "first non-blank AGENTS file in ~/.codex")
        elif _is_blank(candidate):
            state = BLANK_FILE
        else:
            state = State("not-loaded", f"{winner.name} wins in ~/.codex")
        states.setdefault(candidate.resolve(), state)
    return states


def _project_doc_states(walk: list[Path], candidate_names: tuple[str, ...], max_bytes: int) -> dict[Path, State]:
    """One winner per walked folder, the first candidate that exists; a blank
    winner loads nothing, a winner past the byte cap of the winners before it
    is not loaded, and the winner that crosses the cap still is."""
    states: dict[Path, State] = {}
    loaded_bytes = 0
    for walked in walk:
        candidates = [walked / name for name in candidate_names if (walked / name).is_file()]
        for candidate in candidates:
            if candidate != candidates[0]:
                state = State("not-loaded", f"{candidates[0].name} wins in this folder")
            elif _is_blank(candidate):
                state = BLANK_FILE
            elif loaded_bytes >= max_bytes:
                state = State("not-loaded", "past project_doc_max_bytes")
            else:
                state = State("launch", f"first project doc in {walked}")
                loaded_bytes += candidate.stat().st_size
            states.setdefault(candidate.resolve(), state)
    return states


def _is_blank(path: Path) -> bool:
    return not path.read_text(encoding="utf-8", errors="replace").strip()


def _disabled_skill_paths(config: dict, config_path: Path, home: Path) -> frozenset[Path]:
    """The SKILL.md paths or skill folders a [[skills.config]] table turns
    off, "~" read against home."""
    skills = setting_of_type(config, "skills", dict, {}, config_path)
    tables = setting_of_type(skills, "config", list, [], config_path)
    disabled = set()
    for table in tables:
        if not isinstance(table, dict):
            print(f"docs index: ignoring a skills.config entry in {config_path}: not a table", file=sys.stderr)
            continue
        path = setting_of_type(table, "path", str, None, config_path)
        if path is not None and table.get("enabled") is False:
            disabled.add(Path(expand_home(path, home)).resolve())
    return frozenset(disabled)


def _entry_state(entry: Entry, scan: _Scan) -> State:
    if entry.kind == "skill-file":
        return SKILL_FILE
    return best_state(_location_state(entry, location, scan) for location in entry.locations)


def _location_state(entry: Entry, location: Location, scan: _Scan) -> State:
    """The state of entry judged at one of its locations, by that location's
    path and owner."""
    path = Path(location.path)
    owner = location.owner
    doc_state = scan.doc_states.get(path)
    if doc_state is not None:
        return doc_state
    if entry.kind == "plugin":
        return _plugin_state(entry)
    if owner.source == "plugin":
        codex_install = _install_of(owner, scan.codex_installs)
        return CLAUDE_FILE if codex_install is None else _codex_plugin_file_state(entry, path, codex_install, scan)
    if _is_claude_file(path, scan):
        return CLAUDE_FILE
    if entry.kind == "prompt":
        return State("on-demand", "prompt in ~/.codex/prompts")
    if entry.kind == "skill":
        return _agents_skill_state(entry, path, scan)
    is_project_doc = entry.kind == "instructions" and owner.source == "repo" and path.name in scan.candidate_names
    if is_project_doc:
        return State("not-loaded", "outside git root → folder")
    return NO_RULE


def _plugin_state(entry: Entry) -> State:
    if entry.meta.get("harness") != "codex":
        return CLAUDE_FILE
    if entry.meta.get("enabled"):
        return State("launch", "enabled in ~/.codex/config.toml")
    return State("not-loaded", "not enabled in ~/.codex/config.toml")


def _install_of(plugin: Owner, installs: tuple[PluginInstall, ...]) -> PluginInstall | None:
    """The Codex install whose folder is the plugin owner's root, or None for a Claude plugin."""
    return next((install for install in installs if str(install.install_path.resolve()) == plugin.root), None)


def _codex_plugin_file_state(entry: Entry, path: Path, install: PluginInstall, scan: _Scan) -> State:
    if entry.kind != "skill":
        return NO_RULE
    if not install.enabled:
        return State("not-loaded", f"plugin {install.key} not enabled")
    return _skill_state(entry, path, scan, State("listed", f"skill of enabled plugin {install.key}"))


def _is_claude_file(path: Path, scan: _Scan) -> bool:
    is_in_config_dir = scan.locate_config_file(path) is not None
    return path.name in CLAUDE_FILE_NAMES or ".claude" in path.parts or is_in_config_dir


def _agents_skill_state(entry: Entry, path: Path, scan: _Scan) -> State:
    base = _agents_skills_base(path)
    if base is None:
        return NO_RULE
    if base not in scan.skill_bases:
        return State("not-loaded", ".agents/skills outside folder → git root and ~")
    return _skill_state(entry, path, scan, State("listed", f"skill in {path.parent}"))


def _agents_skills_base(path: Path) -> Path | None:
    """The folder holding the .agents/skills a skill sits under, or None."""
    parts = path.parts
    for index in range(len(parts) - 2, -1, -1):
        if parts[index] == ".agents" and parts[index + 1] == "skills":
            return Path(*parts[:index])
    return None


def _skill_state(entry: Entry, path: Path, scan: _Scan, listed: State) -> State:
    """listed, unless [[skills.config]] disables the skill at its real path or
    at the location path judged, or its openai.yaml turns implicit invocation
    off."""
    real_path = Path(entry.path)
    is_disabled = any(candidate in scan.disabled_skill_paths
                      for candidate in (real_path, real_path.parent, path, path.parent))
    if is_disabled:
        return State("not-loaded", "disabled by [[skills.config]] in ~/.codex/config.toml")
    if entry.meta.get("implicitInvocation") is False:
        return State("on-demand", "agents/openai.yaml sets allow_implicit_invocation false")
    return listed
