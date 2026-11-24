"""The seam between discovery and the per-harness load rules: each harness's
rules module implements LoadRules, turning a folder and the discovered
entries into one State per entry. Imports nothing from discovery.
"""

from __future__ import annotations

from pathlib import Path
from typing import Protocol

from model import Entry, State


class LoadRules(Protocol):
    harness: str

    def states(self, folder: Path, entries: list[Entry]) -> dict[str, State]:
        """Entry id to the State this harness gives it in a session opened in folder."""
        ...


def is_repo_root(folder: Path) -> bool:
    """Whether folder holds .git, as a folder or as the file a submodule or
    worktree uses; a dangling .git link holds neither."""
    return (folder / ".git").exists()


def nearest_repo_root(folder: Path) -> Path | None:
    """folder or its nearest ancestor that is_repo_root holds for; None when
    no ancestor is one."""
    for candidate in (folder, *folder.parents):
        if is_repo_root(candidate):
            return candidate
    return None


def repo_roots_holding(folder: Path) -> list[Path]:
    """folder's nearest repo root and every enclosing repo's root, innermost
    first; empty when folder is in no repo."""
    roots = []
    root = nearest_repo_root(folder)
    while root is not None:
        roots.append(root)
        root = nearest_repo_root(root.parent) if root.parent != root else None
    return roots
