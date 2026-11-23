"""The machine the index runs on: the only module that reads Claude Code and
Codex settings, plugin install records and marketplace URLs, or runs git.

Every path hangs off Environment.home, so a test builds a temp home and a
fixed clock and the real machine is never read. Claude Code's user settings
and plugin install records come from the configured Claude config folders,
Environment.claude_config_dirs: the first is the judged folder, whose
settings decide the session's user settings, plugin enablement and AGENTS.md
mode, and each folder's install records are read when asked for by folder. A settings file that is
absent reads as empty; one that is malformed prints one stderr line naming
the file and reads as empty too, since another tool owns it. A value of the
wrong shape inside a readable file prints one stderr line naming its key and
file and reads as its default, by setting_of_type and string_list_setting.
Home's .claude is a Claude config folder whether or not it is configured: a
path under it is located in it, after the configured folders.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tomllib
from dataclasses import dataclass, replace
from datetime import datetime
from functools import cached_property
from pathlib import Path
from typing import Callable

DEFAULT_INSTRUCTION_FILES_MODE = "claude-md-or-agents-md"
AGENTS_MD_PLUGIN = "cc-plugin-agents-md@builtin"


@dataclass(frozen=True)
class PluginInstall:
    """One installed copy of a plugin. key is "<plugin>@<marketplace>".
    scope and project_path come from Claude's install record and are None for
    Codex; enabled is None for Claude, whose enablement depends on the folder."""

    key: str
    harness: str
    version: str
    install_path: Path
    scope: str | None
    project_path: Path | None
    enabled: bool | None


@dataclass(frozen=True)
class Environment:
    """home and now, plus the Claude config folders in configured order, the
    first the judged folder; left empty, they are home's .claude alone."""

    home: Path
    now: Callable[[], datetime]
    claude_config_dirs: tuple[Path, ...] = ()

    def __post_init__(self) -> None:
        if not self.claude_config_dirs:
            object.__setattr__(self, "claude_config_dirs", (self.home / ".claude",))

    def judged_by(self, config_dir: Path) -> Environment:
        """This Environment with config_dir first and the other folders after
        it, in their order."""
        rest = (folder for folder in self.claude_config_dirs if folder != config_dir)
        return replace(self, claude_config_dirs=(config_dir, *rest))

    def locate_in_claude_config_dirs(self, path: Path | str) -> tuple[Path, Path] | None:
        """(folder, path relative to it) for the first Claude config folder
        that holds path as written, as a walk sees it, or by its real path:
        the configured folders in order, then home's .claude when none of them
        is it. None when none holds it. path itself is never resolved."""
        path = Path(path)
        for folder, forms in self._claude_config_dir_forms:
            for form in forms:
                if path.is_relative_to(form):
                    return folder, path.relative_to(form)
        return None

    @cached_property
    def _claude_config_dir_forms(self) -> tuple[tuple[Path, tuple[Path, ...]], ...]:
        """Each folder locate_in_claude_config_dirs searches, with its written,
        walked and real forms, resolved once per Environment."""
        home_claude = self.home / ".claude"
        folders = self.claude_config_dirs
        if home_claude not in folders:
            folders = (*folders, home_claude)
        return tuple((folder, (folder, walked_path(folder), Path(os.path.realpath(folder)))) for folder in folders)

    def claude_settings_files(self, project: Path | None) -> list[Path]:
        """The existing Claude settings files, the judged config folder's
        first, then the project's shared and local files."""
        candidates = [self.claude_config_dirs[0] / "settings.json"]
        if project is not None:
            candidates.append(project / ".claude" / "settings.json")
            candidates.append(project / ".claude" / "settings.local.json")
        return [path for path in candidates if path.is_file()]

    def claude_settings(self, path: Path) -> dict:
        return _read_json_object(path)

    def enabled_claude_plugins(self, project: Path | None) -> set[str]:
        """Plugin keys left true once every settings file's enabledPlugins has
        overridden the files before it."""
        enabled: dict[str, bool] = {}
        for path in self.claude_settings_files(project):
            plugins = self.claude_settings(path).get("enabledPlugins")
            if isinstance(plugins, dict):
                enabled.update(plugins)
        return {key for key, value in enabled.items() if value is True}

    def instruction_files_mode(self) -> str:
        path = self.claude_config_dirs[0] / "settings.json"
        settings = self.claude_settings(path)
        plugin_configs = setting_of_type(settings, "pluginConfigs", dict, {}, path)
        plugin_config = setting_of_type(plugin_configs, AGENTS_MD_PLUGIN, dict, {}, path)
        options = setting_of_type(plugin_config, "options", dict, {}, path)
        return setting_of_type(options, "instructionFiles", str, DEFAULT_INSTRUCTION_FILES_MODE, path)

    def claude_plugin_installs(self, config_dir: Path) -> list[PluginInstall]:
        """One install per record in config_dir's installed_plugins.json whose
        installPath still exists. A record that is no object, or holds no
        installPath string, is skipped with one stderr line."""
        path = config_dir / "plugins" / "installed_plugins.json"
        plugins = setting_of_type(_read_json_object(path), "plugins", dict, {}, path)
        installs = []
        for key in plugins:
            for element in setting_of_type(plugins, key, list, [], path):
                install = _claude_install(key, element, path)
                if install is not None and install.install_path.is_dir():
                    installs.append(install)
        return installs

    def codex_config(self) -> dict:
        path = self.home / ".codex" / "config.toml"
        try:
            with path.open("rb") as file:
                return tomllib.load(file)
        except FileNotFoundError:
            return {}
        except (OSError, tomllib.TOMLDecodeError) as exc:
            print(f"docs index: ignoring unreadable {path}: {exc}", file=sys.stderr)
            return {}

    def codex_plugin_installs(self) -> list[PluginInstall]:
        """The highest version folder of each plugin in Codex's plugin cache,
        laid out as cache/<marketplace>/<plugin>/<version>/."""
        cache = self.home / ".codex" / "plugins" / "cache"
        if not cache.is_dir():
            return []
        config_path = self.home / ".codex" / "config.toml"
        plugin_settings = setting_of_type(self.codex_config(), "plugins", dict, {}, config_path)
        installs = []
        for marketplace in sorted(p for p in cache.iterdir() if p.is_dir()):
            for plugin in sorted(p for p in marketplace.iterdir() if p.is_dir()):
                versions = [p for p in plugin.iterdir() if p.is_dir()]
                if not versions:
                    continue
                latest = max(versions, key=lambda p: _version_order(p.name))
                key = f"{plugin.name}@{marketplace.name}"
                plugin_setting = setting_of_type(plugin_settings, key, dict, {}, config_path)
                installs.append(PluginInstall(
                    key=key,
                    harness="codex",
                    version=latest.name,
                    install_path=latest,
                    scope=None,
                    project_path=None,
                    enabled=setting_of_type(plugin_setting, "enabled", bool, False, config_path),
                ))
        return installs

    def claude_marketplace_urls(self, config_dir: Path) -> dict[str, str]:
        """Marketplace name → git URL from config_dir's known_marketplaces.json:
        a github source's repo, else the source's url; a source with neither,
        such as a directory, is left out."""
        path = config_dir / "plugins" / "known_marketplaces.json"
        marketplaces = _read_json_object(path)
        urls = {}
        for name in marketplaces:
            source = setting_of_type(setting_of_type(marketplaces, name, dict, {}, path), "source", dict, {}, path)
            is_github_repo = source.get("source") == "github" and isinstance(source.get("repo"), str)
            if is_github_repo:
                urls[name] = source["repo"]
            elif isinstance(source.get("url"), str):
                urls[name] = source["url"]
        return urls

    def codex_marketplace_urls(self) -> dict[str, str]:
        """Marketplace name → the source string of its [marketplaces.<name>]
        table in Codex's config.toml."""
        path = self.home / ".codex" / "config.toml"
        marketplaces = setting_of_type(self.codex_config(), "marketplaces", dict, {}, path)
        urls = {}
        for name in marketplaces:
            source = setting_of_type(setting_of_type(marketplaces, name, dict, {}, path), "source", str, None, path)
            if source is not None:
                urls[name] = source
        return urls

    def origin_url(self, repo_root: Path) -> str | None:
        """The repo's origin remote URL, or None when it has none or git fails."""
        try:
            result = subprocess.run(
                ["git", "-C", str(repo_root), "remote", "get-url", "origin"],
                capture_output=True, text=True, timeout=10,
            )
        except (OSError, subprocess.TimeoutExpired):
            return None
        url = result.stdout.strip()
        if result.returncode != 0 or not url:
            return None
        return url

    def origin_name(self, repo_root: Path) -> str:
        """The repo's name as its origin remote spells it, or the folder name
        when it has no origin."""
        url = self.origin_url(repo_root)
        if url is None:
            return repo_root.name
        last_part = url.rstrip("/").replace(":", "/").rsplit("/", 1)[-1]
        return last_part.removesuffix(".git") or repo_root.name


def repo_slug(url: str) -> str | None:
    """The lower-case <owner>/<repo> a git URL names, .git dropped, so an SSH
    host alias, an ssh:// URL, an https URL and a bare owner/repo agree; None
    for a URL of fewer than two parts."""
    parts = [part for part in url.strip().rstrip("/").replace(":", "/").split("/") if part]
    if len(parts) < 2:
        return None
    owner, repo = parts[-2], parts[-1].removesuffix(".git")
    return f"{owner}/{repo}".lower()


def walked_path(folder: Path) -> Path:
    """folder as a walk reaches it: its parent's real path, with a link at
    folder itself kept."""
    return Path(os.path.realpath(folder.parent)) / folder.name


def setting_of_type(settings: dict, key: str, expected: type, default, source: Path):
    """settings[key] when it is an expected; default when the key is absent,
    and default after one stderr line naming key and source when the value
    has another shape. A bool is never taken for an int."""
    if key not in settings:
        return default
    value = settings[key]
    is_bool_for_int = isinstance(value, bool) and expected is not bool
    if isinstance(value, expected) and not is_bool_for_int:
        return value
    print(f"docs index: ignoring {key} in {source}: not a {expected.__name__}", file=sys.stderr)
    return default


def string_list_setting(settings: dict, key: str, default: list[str], source: Path) -> list[str]:
    """settings[key] when it is a list of strings, else as setting_of_type
    treats a value of another shape."""
    value = setting_of_type(settings, key, list, default, source)
    if all(isinstance(item, str) for item in value):
        return value
    print(f"docs index: ignoring {key} in {source}: not a list of strings", file=sys.stderr)
    return default


def _claude_install(key: str, element: object, source: Path) -> PluginInstall | None:
    """The install one installed_plugins.json record describes, or None after
    one stderr line when the record has no object shape or no installPath."""
    has_install_path = isinstance(element, dict) and isinstance(element.get("installPath"), str)
    if not has_install_path:
        print(f"docs index: ignoring a {key} install record in {source}: no installPath string", file=sys.stderr)
        return None
    install_path = Path(element["installPath"])
    project_path = setting_of_type(element, "projectPath", str, None, source)
    return PluginInstall(
        key=key,
        harness="claude",
        version=setting_of_type(element, "version", str, install_path.name, source),
        install_path=install_path,
        scope=setting_of_type(element, "scope", str, None, source),
        project_path=Path(project_path) if project_path else None,
        enabled=None,
    )


def _read_json_object(path: Path) -> dict:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {}
    except (OSError, ValueError) as exc:
        print(f"docs index: ignoring unreadable {path}: {exc}", file=sys.stderr)
        return {}
    if not isinstance(data, dict):
        print(f"docs index: ignoring {path}: top level is not a JSON object", file=sys.stderr)
        return {}
    return data


def _version_order(name: str) -> tuple:
    """Sort key for a version folder name: numeric parts compare as numbers,
    and a named part such as "local" outranks any number."""
    return tuple((0, int(part)) if part.isdigit() else (1, part) for part in name.split("."))
