"""The docs index's machine-local config: ~/.agents/wigley-docs/config.json.

The first run writes the defaults when the file is absent, through a temp
file and os.replace. Paths in the file may start with "~", expanded against
Environment.home so a test's temp home stands in for the real one; every
other "~" path the index reads goes through expand_home too, and
home_relative writes a path back with its home folder as "~".
"""

from __future__ import annotations

import json
import sys
from dataclasses import dataclass
from pathlib import Path

from atomic_write import write_through_temp
from environment import Environment, string_list_setting

DEFAULT_CONFIG = {
    "roots": [],
    "ignore": [],
    "claudeConfigDirs": ["~/.claude"],
}


@dataclass(frozen=True)
class Config:
    roots: list[Path]
    ignore: list[str]
    claude_config_dirs: tuple[Path, ...]


def load_config(env: Environment) -> Config:
    """Read the config, writing the defaults first when the file is absent.
    A key the file leaves out takes its default, and so does a key of the
    wrong shape or an empty claudeConfigDirs, after one stderr line naming it;
    a key the index no longer reads is ignored without one.
    Roots default to none, since where repos are cloned differs per machine;
    an empty roots list prints one stderr line naming the file to add them to."""
    path = env.home / ".agents" / "wigley-docs" / "config.json"
    if not path.exists():
        _write_defaults(path)
    raw = _read_config(path)
    roots = string_list_setting(raw, "roots", DEFAULT_CONFIG["roots"], path)
    if not roots:
        print(f"docs index: no repos are indexed: add the folders that hold them to roots in {path}",
              file=sys.stderr)
    ignore = string_list_setting(raw, "ignore", DEFAULT_CONFIG["ignore"], path)
    claude_config_dirs = string_list_setting(raw, "claudeConfigDirs", DEFAULT_CONFIG["claudeConfigDirs"], path)
    if not claude_config_dirs:
        print(f"docs index: ignoring claudeConfigDirs in {path}: an empty list", file=sys.stderr)
        claude_config_dirs = DEFAULT_CONFIG["claudeConfigDirs"]
    return Config(
        roots=[Path(expand_home(root, env.home)) for root in roots],
        ignore=[expand_home(pattern, env.home) for pattern in ignore],
        claude_config_dirs=tuple(dict.fromkeys(Path(expand_home(item, env.home)) for item in claude_config_dirs)),
    )


def _read_config(path: Path) -> dict:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        print(f"docs index: using default config, {path} is unreadable: {exc}", file=sys.stderr)
        return {}
    if not isinstance(data, dict):
        print(f"docs index: using default config, {path} is not a JSON object", file=sys.stderr)
        return {}
    return data


def _write_defaults(path: Path) -> None:
    write_through_temp(path, path.with_suffix(".json.tmp"), json.dumps(DEFAULT_CONFIG, indent=2) + "\n")


def expand_home(text: str, home: Path) -> str:
    """text with a leading "~" or "~/" replaced by home; the rest, glob
    characters included, is kept as written, and "~user/..." is left as is."""
    if text == "~" or text.startswith("~/"):
        return str(home) + text[1:]
    return text


def home_relative(path: Path, home: Path) -> str:
    """path as a string with a leading home written as "~", the inverse of
    expand_home; both are compared as written, neither resolved."""
    if path.is_relative_to(home):
        return str(Path("~") / path.relative_to(home))
    return str(path)
