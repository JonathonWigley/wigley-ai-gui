"""The names a session's listings and load rows use for an entry, shared by
session.py and loads.py."""

from __future__ import annotations

from pathlib import Path

from environment import Environment
from model import Entry, Location

SYNCED_SKILLS_PREFIX = "anthropic-skills"


def listing_name(env: Environment, entry: Entry, location: Location) -> str:
    """The entry's name as the session's skill or agent listing writes it for
    one of its locations, by that location's owner: <plugin>:<name> where a
    plugin owns it, anthropic-skills:<name> for a synced skill. A command's
    name is its file name at that location without .md."""
    name = Path(location.path).stem if entry.kind == "command" else entry.meta.get("name") or entry.title
    plugin = location.owner.plugin
    if plugin:
        return f"{plugin.split('@', 1)[0]}:{name}"
    if entry.kind == "skill" and is_synced_skill(env, location.path):
        return f"{SYNCED_SKILLS_PREFIX}:{name}"
    return name


def is_synced_skill(env: Environment, path: str) -> bool:
    """Whether path sits under skills/synced in the judged config folder."""
    located = env.locate_in_claude_config_dirs(path)
    if located is None:
        return False
    config_dir, relative = located
    return config_dir == env.claude_config_dirs[0] and relative.parts[:2] == ("skills", "synced")
