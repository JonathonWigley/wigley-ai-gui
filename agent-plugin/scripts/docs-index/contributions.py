"""The contributions file the app hands the index with --contributions: the
global folders, the skill link prefixes and the features homes, merged from
the installed plugins' auri.json. README's Contributions file section holds
its schema.

With no file the index has no global folder, no link prefix and no features
home. A missing, unreadable or malformed file reads as no file, after one
stderr line; a field of the wrong shape is dropped, after one stderr line
naming it. "~" paths are expanded against the Environment's home, so a test's
temp home stands in for the real one.
"""

from __future__ import annotations

import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

from config import expand_home

VERSION = 1
IN_REPO_PREFIX = "{repo}/"
OUT_OF_REPO_SUFFIX = "/{name}"
PLACEHOLDER = re.compile(r"\{[^}]*\}")
GLOBAL_FOLDER_LISTS = (("referenceFiles", "reference_files"), ("subfolders", "subfolders"), ("skip", "skip"))


@dataclass(frozen=True)
class GlobalFolder:
    """A folder in the global layer: its top-level .md files are
    instructions, but reference_files, which are reference; each of
    subfolders is walked in full; each of skip is left out."""

    path: Path
    reference_files: tuple[str, ...] = ()
    subfolders: tuple[str, ...] = ()
    skip: tuple[str, ...] = ()


@dataclass(frozen=True)
class FeaturesHomes:
    """Where feature homes sit: in_repo_parts, each a folder below a repo's
    root; out_of_repo_folders, each a folder holding one home per repo
    name. file is a home's follow-ups file, area_folder its folder of
    per-area follow-up files."""

    in_repo_parts: tuple[tuple[str, ...], ...]
    out_of_repo_folders: tuple[Path, ...]
    file: str
    area_folder: str | None


@dataclass(frozen=True)
class Contributions:
    global_folders: list[GlobalFolder] = field(default_factory=list)
    link_prefixes: dict[str, str] = field(default_factory=dict)
    features: FeaturesHomes | None = None


def load_contributions(path: Path | None, home: Path) -> Contributions:
    """The contributions in the file at path, the empty Contributions when
    path is None."""
    if path is None:
        return Contributions()
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        return _ignored(path, str(exc))
    if not isinstance(data, dict):
        return _ignored(path, "not a JSON object")
    if data.get("version") != VERSION:
        return _ignored(path, f"version is not {VERSION}")
    return Contributions(
        global_folders=_global_folders(data.get("globalFolders", []), path, home),
        link_prefixes=_link_prefixes(data.get("linkPrefixes", {}), path),
        features=_features(data.get("features"), path, home),
    )


def in_repo_parts(template: str) -> tuple[str, ...] | None:
    """The folder parts below a repo's root that an in-repo template
    {repo}/<relative path> names, or None for any other template."""
    if not template.startswith(IN_REPO_PREFIX):
        return None
    folder = template[len(IN_REPO_PREFIX):]
    parts = tuple(part for part in folder.split("/") if part not in ("", "."))
    is_relative = not folder.startswith("/") and bool(parts) and ".." not in parts
    return parts if is_relative and not PLACEHOLDER.search(folder) else None


def out_of_repo_folder(template: str) -> str | None:
    """The ~ or absolute folder an out-of-repo template <folder>/{name}
    names, "~" kept, or None for any other template."""
    if not template.endswith(OUT_OF_REPO_SUFFIX):
        return None
    folder = template[:-len(OUT_OF_REPO_SUFFIX)]
    is_rooted = folder.startswith("~/") or folder.startswith("/")
    return folder if is_rooted and not PLACEHOLDER.search(folder) else None


def _ignored(path: Path, reason: str) -> Contributions:
    print(f"docs index: ignoring contributions file {path}: {reason}", file=sys.stderr)
    return Contributions()


def _dropped(path: Path, field_name: str, reason: str) -> None:
    print(f"docs index: ignoring {field_name} in {path}: {reason}", file=sys.stderr)


def _global_folders(raw: object, path: Path, home: Path) -> list[GlobalFolder]:
    if not isinstance(raw, list):
        _dropped(path, "globalFolders", "not a list")
        return []
    folders: list[GlobalFolder] = []
    for index, item in enumerate(raw):
        folder = _global_folder(item, f"globalFolders[{index}]", path, home)
        if folder is not None:
            folders.append(folder)
    return folders


def _global_folder(item: object, name: str, path: Path, home: Path) -> GlobalFolder | None:
    folder_path = item.get("path") if isinstance(item, dict) else None
    is_rooted = isinstance(folder_path, str) and (folder_path.startswith("~/") or folder_path.startswith("/"))
    if not is_rooted:
        _dropped(path, name, "not an object whose path is a ~ or absolute path")
        return None
    lists: dict[str, tuple[str, ...]] = {}
    for key, attribute in GLOBAL_FOLDER_LISTS:
        value = item.get(key, [])
        if _is_relative_path_list(value):
            lists[attribute] = tuple(value)
        else:
            _dropped(path, f"{name}.{key}", "not a list of relative paths")
            lists[attribute] = ()
    return GlobalFolder(path=Path(expand_home(folder_path, home)), **lists)


def _is_relative_path_list(value: object) -> bool:
    return isinstance(value, list) and all(
        isinstance(item, str) and item and not item.startswith("/") and ".." not in item.split("/")
        for item in value)


def _link_prefixes(raw: object, path: Path) -> dict[str, str]:
    is_prefix_map = isinstance(raw, dict) and all(
        prefix.endswith(":") and isinstance(key, str) and "@" in key for prefix, key in raw.items())
    if not is_prefix_map:
        _dropped(path, "linkPrefixes", 'not { "<prefix>:": "<plugin key>" }')
        return {}
    return dict(raw)


def _features(raw: object, path: Path, home: Path) -> FeaturesHomes | None:
    if raw is None:
        return None
    homes = raw.get("homes") if isinstance(raw, dict) else None
    file = raw.get("file") if isinstance(raw, dict) else None
    area_folder = raw.get("areaFolder") if isinstance(raw, dict) else None
    is_homes = isinstance(homes, list) and all(isinstance(template, str) for template in homes)
    is_file = isinstance(file, str) and file.endswith(".md") and "/" not in file
    is_area_folder = area_folder is None or (isinstance(area_folder, str) and area_folder and "/" not in area_folder)
    if not (is_homes and is_file and is_area_folder):
        _dropped(path, "features", "not { homes, file, areaFolder }")
        return None
    parts: list[tuple[str, ...]] = []
    folders: list[Path] = []
    for index, template in enumerate(homes):
        in_repo = in_repo_parts(template)
        out_of_repo = out_of_repo_folder(template)
        if in_repo is not None:
            parts.append(in_repo)
        elif out_of_repo is not None:
            folders.append(Path(expand_home(out_of_repo, home)))
        else:
            _dropped(path, f"features.homes[{index}]",
                     f'"{template}" is neither {{repo}}/<folder> nor <folder>/{{name}}')
    return FeaturesHomes(tuple(parts), tuple(folders), file, area_folder)
